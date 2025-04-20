// src/services/databaseService.js
import { supabase } from './supabaseClient.js'; // Importar cliente inicializado
import { getEmbedding } from './embeddingService.js'; // Necesario para búsqueda híbrida aquí

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.4; // Peso para la similitud vectorial
const HYBRID_SEARCH_FTS_WEIGHT = 0.6;    // Peso para el score de Full-Text Search
const HYBRID_SEARCH_LIMIT = 5;           // Límite de resultados combinados
const VECTOR_MATCH_THRESHOLD = 0.65; // Umbral de similitud coseno (0 a 1, más alto es más similar)
const HISTORY_MESSAGE_LIMIT = 8;       // Límite de mensajes de historial

// --- Cache (Simple en Memoria) ---
// Advertencia: Esta caché es volátil y no apta para entornos multi-instancia.
// Considerar Redis o similar para producción.
const questionCache = new Map();

export function getCache(key) {
    const cacheKey = key.toLowerCase().trim();
    const cached = questionCache.get(cacheKey);
    if (cached) {
        console.log(`(Cache) HIT para: "${cacheKey.substring(0, 50)}..."`);
        return cached;
    }
    console.log(`(Cache) MISS para: "${cacheKey.substring(0, 50)}..."`);
    return null;
}

export function setCache(key, value) {
    const cacheKey = key.toLowerCase().trim();
    console.log(`(Cache) SET para: "${cacheKey.substring(0, 50)}..."`);
    questionCache.set(cacheKey, value);
    // Opcional: Limitar tamaño de caché o añadir TTL
}
// --------------------------------

/**
 * Obtiene la configuración base de un cliente.
 */
export const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId}`);
    try {
        const { data, error } = await supabase
            .from('Clients') // Asegúrate que la tabla se llama así
            .select('client_id, client_name, base_prompt, knowledge_config') // Campos necesarios
            .eq('client_id', clientId)
            .maybeSingle(); // Devuelve un objeto o null

        if (error) throw error;

        if (data) {
            console.log(`(DB Service) Configuración encontrada para cliente ${clientId}.`);
        } else {
            console.warn(`(DB Service) No se encontró configuración para el cliente ${clientId}.`);
        }
        return data;
    } catch (error) {
        console.error(`(DB Service) Error al obtener config del cliente ${clientId}:`, error.message);
        // No relanzar necesariamente, el controlador puede manejar null
        return null;
    }
};

/**
 * Obtiene el historial de conversación formateado para OpenAI.
 */
export const getConversationHistory = async (conversationId) => {
    console.log(`(DB Service) Buscando historial para conversación: ${conversationId}, límite: ${HISTORY_MESSAGE_LIMIT}`);
    try {
        const { data, error } = await supabase
            .from('Messages') // Asegúrate que la tabla se llama así
            .select('sender, content')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: true }) // Orden cronológico directo
            .limit(HISTORY_MESSAGE_LIMIT);

        if (error) throw error;

        const formattedHistory = data.map(row => ({
            role: row.sender === 'bot' ? 'assistant' : 'user',
            content: row.content
        }));

        console.log(`(DB Service) Historial formateado encontrado para ${conversationId}: ${formattedHistory.length} mensajes.`);
        return formattedHistory;
    } catch (error) {
        console.error(`(DB Service) Error al obtener historial de ${conversationId}:`, error.message);
        return []; // Devolver array vacío en caso de error
    }
};

/**
 * Guarda un mensaje en la base de datos.
 * Nota: No actualiza 'last_message_at' en Conversations aquí por simplicidad,
 * podría hacerse con un trigger en Supabase o una llamada adicional.
 */
export const saveMessage = async (conversationId, sender, textContent) => {
    console.log(`(DB Service) Guardando mensaje para ${conversationId}: (${sender})`);
    try {
        const { error } = await supabase
            .from('Messages') // Asegúrate que la tabla se llama así
            .insert({
                conversation_id: conversationId,
                sender: sender,
                content: textContent
                // timestamp se debería añadir automáticamente por Supabase (default now())
            });

        if (error) throw error;
        console.log(`(DB Service) Mensaje guardado para ${conversationId}.`);
        // TODO (Opcional): Actualizar Conversations.last_message_at si es necesario
    } catch (error) {
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId}:`, error.message);
        // No relanzar, es un error no crítico para la respuesta al usuario
    }
};

/**
 * Obtiene o crea una conversación.
 */
export const getOrCreateConversation = async (clientId) => {
    console.log(`(DB Service) Obteniendo/Creando conversación para cliente ${clientId}`);
    try {
        // Intentar crear directamente. Si ya existe por (client_id, posible_id_unico),
        // Supabase podría dar un error de constraint si se configura así, o simplemente creamos una nueva.
        // La forma más simple es siempre crear una nueva al llamar a /start.
        const { data, error } = await supabase
            .from('Conversations') // Asegúrate que la tabla se llama así
            .insert({ client_id: clientId }) // Supabase genera conversation_id (UUID) por defecto
            .select('conversation_id') // Devolver el ID generado
            .single(); // Esperamos una sola fila

        if (error) throw error;

        const createdId = data.conversation_id;
        console.log(`(DB Service) Nueva conversación creada/obtenida con ID: ${createdId} para cliente ${clientId}`);
        return createdId;

    } catch (error) {
        console.error(`(DB Service) Error en getOrCreateConversation para cliente ${clientId}:`, error.message);
        throw error; // Re-lanzar para que el controlador maneje el error 500
    }
};

/**
 * Realiza una búsqueda híbrida (vectorial + FTS) en la base de conocimiento.
 */
export const hybridSearch = async (clientId, query) => {
    console.log(`(DB Service) Iniciando búsqueda híbrida para cliente ${clientId}, query: "${query.substring(0, 50)}..."`);

    try {
        // 1. Generar Embedding para la consulta
        const queryEmbedding = await getEmbedding(query);
        if (!queryEmbedding) {
            console.warn("(DB Service) No se pudo generar embedding para la consulta. Realizando solo FTS.");
            // Podríamos optar por solo hacer FTS si falla el embedding
            // return await fullTextSearchOnly(clientId, query); // Función auxiliar (no implementada aquí)
            return []; // O devolver vacío
        }

        // 2. Búsqueda Vectorial (usando RPC)
        console.log(`(DB Service) Ejecutando RPC vector_search (threshold: ${VECTOR_MATCH_THRESHOLD})`);
        const { data: vectorResults, error: rpcError } = await supabase.rpc('vector_search', {
            client_id_param: clientId, // Renombrado para evitar colisión con nombres de columna
            query_embedding: queryEmbedding,
            match_threshold: VECTOR_MATCH_THRESHOLD,
            match_count: HYBRID_SEARCH_LIMIT // Pedir límite inicial
        });

        if (rpcError) {
            console.error("(DB Service) Error en RPC vector_search:", rpcError.message);
            // Considerar si continuar solo con FTS o fallar
            return []; // Fallar por ahora si RPC falla
        }
        console.log(`(DB Service) Vector search encontró ${vectorResults?.length || 0} resultados.`);

        // 3. Búsqueda Full-Text
        console.log("(DB Service) Ejecutando Full-Text Search");
        const { data: textResults, error: ftsError } = await supabase
            .from('knowledge_base') // Asegúrate que la tabla se llama así
            .select('content, metadata, ts_rank(fts, websearch_to_tsquery(\'spanish\', $1)) as score') // Seleccionar contenido, metadata y score
            .textSearch('fts', query, { // 'fts' debe ser la columna tsvector
                type: 'websearch',
                config: 'spanish'
            })
            .eq('client_id', clientId) // Filtrar por cliente también en FTS
            .limit(HYBRID_SEARCH_LIMIT); // Limitar resultados FTS

        if (ftsError) {
            console.error("(DB Service) Error en Full-Text Search:", ftsError.message);
            // Considerar si continuar solo con Vector o fallar
            return vectorResults || []; // Devolver resultados vectoriales si FTS falla
        }
        console.log(`(DB Service) Full-Text search encontró ${textResults?.length || 0} resultados.`);

        // 4. Combinar y Re-rankear Resultados
        const combinedResults = {};

        // Añadir resultados vectoriales (dar prioridad a similitud)
        (vectorResults || []).forEach(row => {
            // Asumir que RPC devuelve 'id', 'content', 'metadata', 'similarity'
            const id = row.id; // Necesitas un ID único por chunk
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 };
            } else {
                combinedResults[id].vector_similarity = Math.max(combinedResults[id].vector_similarity, row.similarity || 0);
            }
        });

        // Añadir resultados FTS (dar prioridad a score)
        (textResults || []).forEach(row => {
             // Asumir que FTS devuelve 'id', 'content', 'metadata', 'score'
            const id = row.id; // Necesitas un ID único por chunk
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: row.score || 0 };
            } else {
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score, row.score || 0);
                 // Si ya existía, copiar content/metadata si no los tenía de la búsqueda vectorial
                 if (!combinedResults[id].content) combinedResults[id].content = row.content;
                 if (!combinedResults[id].metadata) combinedResults[id].metadata = row.metadata;
            }
        });

        // Calcular score híbrido y ordenar
        const rankedResults = Object.values(combinedResults)
            .map(item => ({
                ...item,
                hybrid_score: (item.vector_similarity * HYBRID_SEARCH_VECTOR_WEIGHT) + (item.fts_score * HYBRID_SEARCH_FTS_WEIGHT)
            }))
            .sort((a, b) => b.hybrid_score - a.hybrid_score)
            .slice(0, HYBRID_SEARCH_LIMIT); // Aplicar límite final

        console.log(`(DB Service) Búsqueda híbrida completada. Resultados finales: ${rankedResults.length}`);
        // console.log("Resultados Híbridos:", rankedResults.map(r => ({id: r.id, score: r.hybrid_score.toFixed(4)}))); // Log para debug

        return rankedResults; // Devolver objetos completos { content, metadata, scores... }

    } catch (error) {
        console.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, error.message);
        return []; // Devolver array vacío en caso de error grave
    }
};

// NO exportamos saveKnowledgeChunk desde aquí, se maneja en el script de ingesta.