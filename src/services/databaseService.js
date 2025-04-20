// src/services/databaseService.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid'; // Necesario para getOrCreateConversation

// Inicializar cliente Supabase
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL falta en .env');
if (!process.env.SUPABASE_KEY) throw new Error('SUPABASE_KEY (Service Role) falta en .env');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
console.log("LOG (DB): Supabase client initialized in databaseService.");

// Nombres de tablas (centralizar)
const KNOWLEDGE_TABLE = 'knowledge_base';
const MESSAGES_TABLE = 'Messages';
const CONVERSATIONS_TABLE = 'Conversations';
const CLIENTS_TABLE = 'Clients'; // Asume que tu tabla de clientes se llama así

// Constantes
const MIN_CHUNK_WORDS_FOR_STORAGE = 30;
const SIMILARITY_THRESHOLD = 0.55; // <-- ¡Umbral Corregido y Razonable! ¡AJUSTAR CON PRUEBAS!
const MATCH_COUNT = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

// --- Caché en Memoria Simple ---
const questionCache = new Map();

export function getCache(key) {
    const entry = questionCache.get(key);
    if (entry && Date.now() < entry.expiry) {
        console.log(`LOG (Cache): Cache HIT para key: ${key.substring(0,50)}...`);
        return entry.value;
    }
     if (entry) { questionCache.delete(key); }
    return null;
}

export function setCache(key, value) {
    console.log(`LOG (Cache): Setting cache para key: ${key.substring(0,50)}...`);
    const expiry = Date.now() + CACHE_TTL_MS;
    questionCache.set(key, { value, expiry });
    if (questionCache.size > 500) { /* ... pruning ... */ }
}

// --- Búsqueda Híbrida ---
/**
 * Realiza búsqueda híbrida. Recibe embedding pre-calculado.
 */
export async function hybridSearch(clientId, query, queryEmbedding) {
    // (Pega aquí la LÓGICA COMPLETA de hybridSearch CORREGIDA de mi respuesta anterior)
    // Asegúrate de que usa SIMILARITY_THRESHOLD = 0.55 y llama a la función SQL 'vector_search'
    // --- INICIO CÓDIGO PEGADO hybridSearch ---
    const cacheKey = `hybridSearch:${clientId}:${query}`; const cachedResult = getCache(cacheKey); if (cachedResult) return cachedResult;
    console.log(`LOG (Search): Iniciando búsqueda híbrida para cliente ${clientId}. Query: "${query.substring(0,50)}..."`);
    if (!queryEmbedding) { console.warn("WARN (Search): queryEmbedding nulo. Realizando solo búsqueda FTS."); }
    let vectorResults = []; let fullTextResults = []; let combinedResults = [];
    try {
        if (queryEmbedding) {
            console.log(`LOG (Search): Ejecutando RPC vector_search umbral >= ${SIMILARITY_THRESHOLD}...`);
            const { data: rpcData, error: rpcError } = await supabase.rpc('vector_search', { client_id_input: clientId, query_embedding: queryEmbedding, similarity_threshold: SIMILARITY_THRESHOLD, match_count: MATCH_COUNT });
            if (rpcError) { console.error("ERROR (Search): RPC vector_search:", rpcError); }
            else { vectorResults = rpcData || []; vectorResults.forEach(r => r.score = r.similarity); console.log(`LOG (Search): Vectorial encontró ${vectorResults.length}.`); }
        }
        console.log("LOG (Search): Ejecutando búsqueda FTS...");
        const ftsQuery = query.split(/\s+/).filter(Boolean).join(' | ');
        if (ftsQuery) {
            const { data: ftsData, error: ftsError } = await supabase.from(KNOWLEDGE_TABLE).select('id, content, metadata, ts_rank(to_tsvector(\'spanish\', content), websearch_to_tsquery(\'spanish\', $1)) as score_fts').eq('client_id', clientId).textSearch('content', ftsQuery, { type: 'websearch', config: 'spanish' }).order('score_fts', { ascending: false }).limit(MATCH_COUNT);
            if (ftsError) { console.error("ERROR (Search): FTS:", ftsError); }
            else { fullTextResults = ftsData || []; fullTextResults.forEach(r => r.score = r.score_fts > 0 ? 0.1 + (r.score_fts * 0.4) : 0.1); console.log(`LOG (Search): FTS encontró ${fullTextResults.length}.`); }
        } else { console.log("LOG (Search): FTS omitida."); }
        console.log("LOG (Search): Combinando resultados...");
        const combined = new Map();
        vectorResults.forEach(r => { if (r?.id) combined.set(r.id, r); });
        fullTextResults.forEach(r => { if (r?.id && !combined.has(r.id)) combined.set(r.id, r); });
        combinedResults = Array.from(combined.values());
        combinedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); // TODO: Mejorar combinación
        const finalResults = combinedResults.slice(0, MATCH_COUNT);
        console.log(`LOG (Search): Devolviendo ${finalResults.length} resultados combinados.`);
        setCache(cacheKey, finalResults); return finalResults;
    } catch (error) { console.error(`ERROR FATAL durante hybridSearch:`, error); return []; }
    // --- FIN CÓDIGO PEGADO hybridSearch ---
}

// ----- Funciones de Almacenamiento (Ingesta) -----
export async function storeChunks(clientId, chunksWithEmbeddings) {
    // (Pega aquí la función storeChunks COMPLETA y robusta que te di antes)
     // --- INICIO CÓDIGO PEGADO storeChunks ---
     console.log(`LOG (DB): Iniciando storeChunks para ${clientId}. Recibidos ${chunksWithEmbeddings?.length ?? 0} chunks.`);
     if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) { console.warn("WARN (DB): No hay chunks con embeddings para guardar."); return { insertedCount: 0, errors: ["No chunks received"] }; }
     const validChunksData = chunksWithEmbeddings.filter(c => c.text && c.text.split(/\s+/).length >= MIN_CHUNK_WORDS_FOR_STORAGE && c.embedding && c.embedding.length === 1536 && c.metadata?.url).map(c => ({ client_id: clientId, content: c.text, embedding: c.embedding, metadata: c.metadata }));
     const discardedCount = chunksWithEmbeddings.length - validChunksData.length;
     if (discardedCount > 0) { console.warn(`WARN (DB): Se descartaron ${discardedCount} chunks por datos inválidos/cortos.`); }
     if (validChunksData.length === 0) { console.error("ERROR (DB): No quedaron chunks válidos para insertar."); return { insertedCount: 0, errors: ["No valid chunks to insert"] }; }
     console.log(`LOG (DB): Preparados ${validChunksData.length} registros válidos para insertar.`);
     const INSERT_BATCH_SIZE = 100; let successfulInserts = 0; const errors = [];
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
     // --- FIN CÓDIGO PEGADO storeChunks ---
}

// ----- Funciones de Historial (¡IMPLEMENTADAS!) -----
/**
 * Obtiene los últimos N mensajes de una conversación.
 */
export async function getConversationHistory(conversationId, limit = 10) {
   console.log(`LOG (DB): Buscando historial para CV: ${conversationId}, límite ${limit}`);
   if (!conversationId) return [];
   try {
       const { data, error } = await supabase
          .from(MESSAGES_TABLE) // Usa constante
          .select('sender, content')
          .eq('conversation_id', conversationId)
          .order('timestamp', { ascending: false })
          .limit(limit);
       if (error) throw error; // Lanza error para capturar abajo

       const history = (data || []).reverse().map(row => ({
           role: row.sender === 'bot' ? 'assistant' : 'user',
           content: row.content
       }));
        console.log(`LOG (DB): Historial encontrado para ${conversationId}: ${history.length} mensajes.`);
        return history;
   } catch (error) {
       console.error(`ERROR (DB) al obtener historial de ${conversationId}:`, error);
       return []; // Devolver vacío en caso de error
   }
}

/**
 * Guarda un mensaje en la base de datos.
 */
export async function saveMessage(conversationId, sender, textContent) {
    console.log(`LOG (DB): Guardando mensaje para ${conversationId} (${sender})`);
    if (!conversationId || !sender || !textContent) { /* ... error ... */ return false; }
    try {
        // TODO: Considerar transacción si actualizas Conversations.last_message_at
        const { error } = await supabase
            .from(MESSAGES_TABLE) // Usa constante
            .insert([{ conversation_id: conversationId, sender, content: textContent }]);
        if (error) throw error; // Lanza error
        console.log(`LOG (DB): Mensaje guardado OK para ${conversationId}.`);
        return true;
    } catch (error) {
         console.error(`ERROR (DB) al guardar mensaje para ${conversationId}:`, error);
         return false;
    }
}

/**
 * Obtiene o crea una conversación.
 * @param {string} clientId
 * @param {string|null} [conversationId=null]
 * @returns {Promise<string|null>} El ID de la conversación o null si hay error.
 */
export async function getOrCreateConversation(clientId, conversationId = null) {
    console.log(`LOG (DB): Obteniendo/Creando conversación para cliente ${clientId}, ID previo: ${conversationId}`);
     try {
        if (conversationId) {
            const { data, error } = await supabase
                .from(CONVERSATIONS_TABLE) // Usa constante
                .select('conversation_id')
                .eq('conversation_id', conversationId)
                .eq('client_id', clientId) // Asegurar que pertenece al cliente
                .maybeSingle(); // Devuelve uno o null, no array

             if (error) throw error;
             if (data) {
                 console.log(`LOG (DB): Conversación existente ${conversationId} validada.`);
                 return conversationId;
             }
             console.log(`LOG (DB): ID ${conversationId} inválido o no pertenece al cliente. Creando nueva.`);
        }

        // Crear nueva conversación
        const newConversationId = uuidv4();
        const { data: insertData, error: insertError } = await supabase
            .from(CONVERSATIONS_TABLE)
            .insert({ conversation_id: newConversationId, client_id: clientId }) // last_message_at se actualiza al guardar mensaje? O poner now() aquí?
            .select('conversation_id')
            .single(); // Esperamos una sola fila

        if (insertError) throw insertError;

        const createdId = insertData?.conversation_id;
         if (!createdId) throw new Error("No se pudo obtener el ID de la conversación creada.");

        console.log(`LOG (DB): Nueva conversación creada con ID: ${createdId}`);
        return createdId;
    } catch (error) {
        console.error(`ERROR (DB) en getOrCreateConversation para cliente ${clientId}:`, error);
        return null; // Indicar error
    }
}

// ... (Si necesitas getClientConfig, impleméntala aquí usando supabase)
// export async function getClientConfig(clientId) { ... }