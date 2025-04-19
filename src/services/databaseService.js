// src/services/databaseService.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Inicializar cliente Supabase
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL falta en .env');
if (!process.env.SUPABASE_KEY) throw new Error('SUPABASE_KEY (Service Role) falta en .env');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
console.log("LOG (DB): Supabase client initialized in databaseService.");

const KNOWLEDGE_TABLE = 'knowledge_base';
const MESSAGES_TABLE = 'Messages'; // Asume que tu tabla de mensajes se llama así
const CONVERSATIONS_TABLE = 'Conversations'; // Asume que tu tabla de conversaciones se llama así
const MIN_CHUNK_WORDS_FOR_STORAGE = parseInt(process.env.MIN_CHUNK_WORDS || '30');

// ----- Funciones de Búsqueda Híbrida y Caché -----

// !!!!! UMBRAL DE SIMILITUD - ¡AJUSTAR DESPUÉS DE PROBAR! !!!!!
// Empezamos con 0.55 que es más razonable para OpenAI que 0.82.
const SIMILARITY_THRESHOLD = 0.55; // <-- ¡UMBRAL CORREGIDO Y RAZONABLE!

const MATCH_COUNT = 5; // Max resultados RAG

const questionCache = new Map(); // Caché simple en memoria para resultados de búsqueda
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function getCache(key) {
    const entry = questionCache.get(key);
    if (entry && Date.now() < entry.expiry) {
        console.log(`LOG (Cache): Cache HIT para key: ${key.substring(0,50)}...`);
        return entry.value;
    }
     if (entry) { questionCache.delete(key); } // Limpiar expirada
    return null;
}

function setCache(key, value) {
    console.log(`LOG (Cache): Setting cache para key: ${key.substring(0,50)}...`);
    const expiry = Date.now() + CACHE_TTL_MS;
    questionCache.set(key, { value, expiry });
    // Limpiar caché si crece mucho
    if (questionCache.size > 500) { // Límite ejemplo
        const oldestKey = questionCache.keys().next().value;
        questionCache.delete(oldestKey);
        console.log("LOG (Cache): Cache pruned.");
    }
}

/**
 * Realiza búsqueda híbrida (Vector + FTS). Recibe embedding pre-calculado.
 * @param {string} clientId
 * @param {string} query - Texto original de la pregunta (para FTS).
 * @param {Array<number>|null} queryEmbedding - Embedding de la pregunta.
 * @returns {Promise<Array<object>>} - Resultados combinados y ordenados.
 */
export async function hybridSearch(clientId, query, queryEmbedding) {
    const cacheKey = `hybridSearch:${clientId}:${query}`;
    const cachedResult = getCache(cacheKey);
    if (cachedResult) return cachedResult;

    console.log(`LOG (Search): Iniciando búsqueda híbrida para cliente ${clientId}. Query: "${query.substring(0,50)}..."`);

    if (!queryEmbedding) {
        console.warn("WARN (Search): queryEmbedding nulo. Realizando solo búsqueda FTS.");
    }

    let vectorResults = [];
    let fullTextResults = [];
    let combinedResults = [];

    try {
        // --- 1. Búsqueda Vectorial ---
        if (queryEmbedding) {
            console.log(`LOG (Search): Ejecutando búsqueda vectorial (RPC vector_search) umbral >= ${SIMILARITY_THRESHOLD}...`);
            const { data: rpcData, error: rpcError } = await supabase.rpc('vector_search', {
                client_id_input: clientId,
                query_embedding: queryEmbedding,
                similarity_threshold: SIMILARITY_THRESHOLD, // Usar umbral ajustado
                match_count: MATCH_COUNT
            });
            if (rpcError) { console.error("ERROR (Search): Error en RPC vector_search:", rpcError); }
            else {
                vectorResults = rpcData || [];
                vectorResults.forEach(r => r.score = r.similarity); // Asignar score vectorial
                console.log(`LOG (Search): Búsqueda vectorial encontró ${vectorResults.length}.`);
            }
        }

        // --- 2. Búsqueda Full-Text (FTS) ---
        console.log("LOG (Search): Ejecutando búsqueda full-text...");
        const ftsQuery = query.split(/\s+/).filter(Boolean).join(' | '); // websearch format
        if (ftsQuery) {
            const { data: ftsData, error: ftsError } = await supabase
                .from(KNOWLEDGE_TABLE)
                .select('id, content, metadata, ts_rank(to_tsvector(\'spanish\', content), websearch_to_tsquery(\'spanish\', $1)) as score_fts')
                .eq('client_id', clientId)
                .textSearch('content', ftsQuery, { type: 'websearch', config: 'spanish' })
                .order('score_fts', { ascending: false })
                .limit(MATCH_COUNT);

            if (ftsError) { console.error("ERROR (Search): Error en búsqueda FTS:", ftsError); }
            else {
                fullTextResults = ftsData || [];
                // Asignar score normalizado heurísticamente para FTS
                fullTextResults.forEach(r => r.score = r.score_fts > 0 ? 0.1 + (r.score_fts * 0.4) : 0.1);
                console.log(`LOG (Search): Búsqueda FTS encontró ${fullTextResults.length}.`);
                 // TODO: Validar/mejorar esta normalización o usar RRF.
            }
        } else { console.log("LOG (Search): Búsqueda FTS omitida (query vacía)."); }

        // --- 3. Combinar y Ordenar ---
        console.log("LOG (Search): Combinando resultados...");
        const combined = new Map();
        // Prioridad a resultados vectoriales
        vectorResults.forEach(r => { if (r?.id) combined.set(r.id, r); });
        // Añadir FTS si no existe
        fullTextResults.forEach(r => { if (r?.id && !combined.has(r.id)) combined.set(r.id, r); });
        combinedResults = Array.from(combined.values());
        // Ordenar por score (descendente)
        combinedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const finalResults = combinedResults.slice(0, MATCH_COUNT);
        console.log(`LOG (Search): Devolviendo ${finalResults.length} resultados combinados y ordenados.`);

        // Guardar en caché
        setCache(cacheKey, finalResults);
        return finalResults;

    } catch (error) {
        console.error(`ERROR FATAL durante hybridSearch:`, error);
        return [];
    }
}

// ----- Funciones de Almacenamiento (Ingesta) -----

/**
 * Almacena chunks procesados en la tabla knowledge_base.
 * @param {string} clientId
 * @param {Array<object>} chunksWithEmbeddings - Chunks con {text, metadata, embedding}.
 * @returns {Promise<{insertedCount: number, errors: Array<string>}>} Resumen.
 */
export async function storeChunks(clientId, chunksWithEmbeddings) {
    // (Misma función robusta con validación y lotes que te di antes)
    console.log(`LOG (DB): Iniciando storeChunks para ${clientId}. Recibidos ${chunksWithEmbeddings?.length ?? 0} chunks.`);
     if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
         console.warn("WARN (DB): No hay chunks con embeddings para guardar.");
         return { insertedCount: 0, errors: ["No chunks received"] };
     }
    const validChunksData = chunksWithEmbeddings.filter(c => c.text && c.text.split(/\s+/).length >= MIN_CHUNK_WORDS_FOR_STORAGE && c.embedding && c.embedding.length === 1536 && c.metadata?.url).map(c => ({ client_id: clientId, content: c.text, embedding: c.embedding, metadata: c.metadata }));
    const discardedCount = chunksWithEmbeddings.length - validChunksData.length;
    if (discardedCount > 0) { console.warn(`WARN (DB): Se descartaron ${discardedCount} chunks por datos inválidos/cortos.`); }
    if (validChunksData.length === 0) { console.error("ERROR (DB): No quedaron chunks válidos para insertar."); return { insertedCount: 0, errors: ["No valid chunks to insert"] }; }
    console.log(`LOG (DB): Preparados ${validChunksData.length} registros válidos para insertar.`);
    const INSERT_BATCH_SIZE = 100;
    let successfulInserts = 0;
    const errors = [];
    for(let i = 0; i < validChunksData.length; i += INSERT_BATCH_SIZE) {
        const batchToInsert = validChunksData.slice(i, i + INSERT_BATCH_SIZE);
        console.log(`LOG (DB): Intentando insertar lote ${Math.floor(i/INSERT_BATCH_SIZE) + 1}/${Math.ceil(validChunksData.length/INSERT_BATCH_SIZE)} (${batchToInsert.length} registros)...`);
        try {
            const { error, count } = await supabase.from(KNOWLEDGE_TABLE).insert(batchToInsert, { count: 'exact' });
            if (error) { console.error(`ERROR (DB) insertando lote ${Math.floor(i/INSERT_BATCH_SIZE) + 1}:`, error); errors.push(`Batch ${Math.floor(i/INSERT_BATCH_SIZE) + 1}: ${error.message}`); }
            else { console.log(`LOG (DB): Lote ${Math.floor(i/INSERT_BATCH_SIZE) + 1} guardado exitosamente (Count: ${count}).`); successfulInserts += count || batchToInsert.length; }
        } catch (batchError) { console.error(`ERROR FATAL (DB) insertando lote ${Math.floor(i/INSERT_BATCH_SIZE) + 1}:`, batchError); errors.push(`Batch ${Math.floor(i/INSERT_BATCH_SIZE) + 1} (Fatal): ${batchError.message}`); }
    }
    console.log(`--- RESULTADO storeChunks: Insertados ${successfulInserts}/${validChunksData.length} registros válidos. Errores: ${errors.length}. ---`);
    return { insertedCount: successfulInserts, errors: errors };
}

// ----- Funciones de Historial (¡IMPLEMENTAR!) -----

/**
 * Obtiene los últimos N mensajes de una conversación.
 * @param {string} conversationId
 * @param {number} [limit=10] - Límite MÁXIMO de mensajes a devolver
 * @returns {Promise<Array<{role: 'user'|'assistant', content: string}>>}
 */
export async function getConversationHistory(conversationId, limit = 10) {
   console.log(`LOG (DB): Buscando historial para conversación: ${conversationId}, límite ${limit}`);
   if (!conversationId) return [];
   try {
       // Asegúrate que tu tabla se llama 'Messages' y las columnas 'conversation_id', 'sender', 'content', 'timestamp'
       const { data, error } = await supabase
          .from(MESSAGES_TABLE)
          .select('sender, content')
          .eq('conversation_id', conversationId)
          .order('timestamp', { ascending: false }) // Obtener los más recientes primero
          .limit(limit);

       if (error) {
           console.error(`ERROR (DB) obteniendo historial para ${conversationId}:`, error);
           return [];
       }
       // Invertir para orden cronológico y mapear al formato de OpenAI
       const history = (data || []).reverse().map(row => ({
           role: row.sender === 'bot' ? 'assistant' : 'user',
           content: row.content
       }));
        console.log(`LOG (DB): Historial encontrado para ${conversationId}: ${history.length} mensajes.`);
        return history;

   } catch (error) {
       console.error(`ERROR FATAL (DB) obteniendo historial de ${conversationId}:`, error);
       return [];
   }
}

/**
 * Guarda un mensaje en la base de datos.
 * @param {string} conversationId
 * @param {'user'|'bot'} sender
 * @param {string} textContent
 * @returns {Promise<boolean>} - true si tuvo éxito, false si falló
 */
export async function saveMessage(conversationId, sender, textContent) {
    console.log(`LOG (DB): Guardando mensaje para ${conversationId} (${sender})`);
    if (!conversationId || !sender || !textContent) {
         console.error("ERROR (DB) saveMessage: Faltan parámetros.");
         return false;
    }
    try {
        // Asegúrate que tu tabla se llama 'Messages' y tiene estas columnas
        const { error } = await supabase
            .from(MESSAGES_TABLE)
            .insert([{ conversation_id: conversationId, sender, content: textContent }]);

        if (error) {
            console.error(`ERROR (DB) al guardar mensaje para ${conversationId}:`, error);
            return false;
        }
        console.log(`LOG (DB): Mensaje guardado OK para ${conversationId}.`);
        // TODO: Considerar actualizar Conversations.last_message_at (posiblemente en transacción)
        return true;
    } catch (error) {
         console.error(`ERROR FATAL (DB) al guardar mensaje para ${conversationId}:`, error);
         return false;
    }
}

// ... otras funciones como getClientConfig, getOrCreateConversation ...
//     (Asegúrate de implementarlas o importarlas si las necesitas)