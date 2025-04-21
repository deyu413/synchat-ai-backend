// src/services/databaseService.js
import { supabase } from './supabaseClient.js';
import { getEmbedding } from './embeddingService.js';

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5;
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;
const HYBRID_SEARCH_LIMIT = 5;
const VECTOR_MATCH_THRESHOLD = 0.65;
const HISTORY_MESSAGE_LIMIT = 8;

// --- Cache (Simple en Memoria - Requiere mejora para producción) ---
const questionCache = new Map();
export function getCache(key) { /* ...código igual... */
    const cacheKey = key.toLowerCase().trim();
    const cached = questionCache.get(cacheKey);
    if (cached) {
        console.log(`(Cache) HIT para: "${cacheKey.substring(0, 50)}..."`);
        return cached;
    }
    console.log(`(Cache) MISS para: "${cacheKey.substring(0, 50)}..."`);
    return null;
}
export function setCache(key, value) { /* ...código igual... */
    const cacheKey = key.toLowerCase().trim();
    console.log(`(Cache) SET para: "${cacheKey.substring(0, 50)}..."`);
    questionCache.set(key, value);
}
// --------------------------------

/**
 * Obtiene la configuración específica necesaria del perfil de un usuario.
 * @param {string} userId - El ID del usuario (UUID de Supabase Auth).
 * @returns {Promise<object|null>} - Objeto con la config o null si no se encuentra/error.
 */
export const getProfileConfig = async (userId) => {
    if (!userId) return null;
    console.log(`(DB Service) Buscando config_url para User ID: ${userId}`);
    try {
        const { data, error, status } = await supabase
            .from('profiles')
            .select('config_url') // Solo lo que necesitamos por ahora
            .eq('id', userId)
            .maybeSingle(); // Usa maybeSingle para manejar el caso de que no exista

        if (error && status !== 406) { // 406 = No rows found
            console.error(`(DB Service) Error obteniendo config_url para ${userId}:`, error.message);
            return null;
        }
        if (data) {
            console.log(`(DB Service) config_url encontrada para ${userId}: ${data.config_url}`);
            return data;
        } else {
             console.warn(`(DB Service) No se encontró perfil/config para ${userId}.`);
            return null;
        }
    } catch (err) {
        console.error(`(DB Service) Excepción obteniendo config_url para ${userId}:`, err.message);
        return null;
    }
};


/**
 * Obtiene el historial de conversación formateado para OpenAI.
 */
export const getConversationHistory = async (conversationId) => { /* ...código igual... */
    console.log(`(DB Service) Buscando historial para conversación: ${conversationId}, límite: ${HISTORY_MESSAGE_LIMIT}`);
    try {
        const { data, error } = await supabase
            .from('messages') // Usar nombre en minúsculas
            .select('sender, content')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: true })
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
        return [];
    }
};

/**
 * Guarda un mensaje en la base de datos.
 */
export const saveMessage = async (conversationId, sender, textContent) => { /* ...código igual... */
    console.log(`(DB Service) Guardando mensaje para ${conversationId}: (${sender})`);
    try {
        const { error } = await supabase
            .from('messages') // Usar nombre en minúsculas
            .insert({
                conversation_id: conversationId,
                sender: sender,
                content: textContent
                // client_id ya no sería necesario aquí si la conversación ya está vinculada
            });

        if (error) throw error;
        console.log(`(DB Service) Mensaje guardado para ${conversationId}.`);

    } catch (error) {
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId}:`, error.message);
    }
};

/**
 * Obtiene o crea una conversación. Devuelve el ID de la conversación.
 */
export const getOrCreateConversation = async (userId) => { // Recibe userId
    console.log(`(DB Service) Creando nueva conversación para userId ${userId}`);
    try {
        // Asumiendo que 'conversations' tiene una columna 'user_id' o similar
        // Si aún usa 'client_id', asegúrate de que esa columna referencia a 'profiles.id'
        const { data, error } = await supabase
            .from('conversations')
            .insert({ client_id: userId }) // Usar userId aquí
            .select('conversation_id')
            .single();

        if (error) throw error;

        const createdId = data.conversation_id;
        console.log(`(DB Service) Nueva conversación creada con ID: ${createdId} para userId ${userId}`);
        return createdId;

    } catch (error) {
        console.error(`(DB Service) Error en getOrCreateConversation para userId ${userId}:`, error.message);
        throw error;
    }
};

/**
 * Realiza una búsqueda híbrida (vectorial + FTS) usando funciones RPC de Supabase.
 */
export const hybridSearch = async (userId, query) => { // Renombrado a userId
    console.log(`(DB Service) Iniciando búsqueda híbrida RPC para userId ${userId}, query: "${query.substring(0, 50)}..."`);

    try {
        const queryEmbedding = await getEmbedding(query);
        if (!queryEmbedding) {
            console.warn("(DB Service) No se pudo generar embedding para la consulta. Saltando búsqueda vectorial.");
            return [];
        }

        console.log("(DB Service) Ejecutando RPCs vector_search y fts_search_with_rank en paralelo...");
        const [vectorResponse, ftsResponse] = await Promise.all([
            supabase.rpc('vector_search', {
                client_id_param: userId, // Pasar userId
                query_embedding: queryEmbedding,
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: HYBRID_SEARCH_LIMIT * 2
            }),
            supabase.rpc('fts_search_with_rank', {
                client_id_param: userId, // Pasar userId
                query_param: query,
                match_count: HYBRID_SEARCH_LIMIT * 2
            })
        ]);

        // Manejo de errores RPC (igual que antes)
        if (vectorResponse.error) { /* ... */ console.error("(DB Service) Error en RPC vector_search:", vectorResponse.error.message); return []; }
        const vectorResults = vectorResponse.data || [];
        console.log(`(DB Service) Vector search (RPC) encontró ${vectorResults.length} resultados.`);

        if (ftsResponse.error) { /* ... */ console.error("(DB Service) Error en RPC fts_search_with_rank:", ftsResponse.error.message); console.warn("(DB Service) FTS RPC falló, continuando solo con resultados vectoriales."); }
        const textResults = ftsResponse.data || [];
        console.log(`(DB Service) FTS search (RPC) encontró ${textResults.length} resultados.`);


        // Combinar y Re-rankear (igual que antes)
        const combinedResults = {};
        vectorResults.forEach(row => { /* ... */ const id = row.id; if (!id) return; if (!combinedResults[id]) { combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 }; } else { combinedResults[id].vector_similarity = Math.max(combinedResults[id].vector_similarity, row.similarity || 0); } });
        textResults.forEach(row => { /* ... */ const id = row.id; if (!id) return; const ftsScore = row.score || 0; if (!combinedResults[id]) { combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore }; } else { combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score, ftsScore); if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content; if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata; } });

        const rankedResults = Object.values(combinedResults)
            .filter(item => item.id && item.content)
            .map(item => ({
                ...item,
                hybrid_score: ((item.vector_similarity || 0) * HYBRID_SEARCH_VECTOR_WEIGHT) + ((item.fts_score || 0) * HYBRID_SEARCH_FTS_WEIGHT)
            }))
            .sort((a, b) => b.hybrid_score - a.hybrid_score)
            .slice(0, HYBRID_SEARCH_LIMIT);

        console.log(`(DB Service) Búsqueda híbrida completada. Resultados finales: ${rankedResults.length}`);

        return rankedResults.map(r => ({
             id: r.id,
             content: r.content,
             metadata: r.metadata
            }));

    } catch (error) {
        console.error(`(DB Service) Error general durante la búsqueda híbrida para userId ${userId}:`, error.message);
        return [];
    }
};

/**
 * Obtiene el ID del perfil (que usamos como identificador interno del cliente)
 * basado en la API Key proporcionada por el widget.
 * @param {string} apiKey - La API Key del widget (UUID).
 * @returns {Promise<string|null>} - El ID del usuario/perfil (UUID) o null si no se encuentra/error.
 */
export const getUserIdByApiKey = async (apiKey) => {
    if (!apiKey) {
        console.warn("(DB Service) Se llamó a getUserIdByApiKey sin API Key.");
        return null;
    }
    console.log(`(DB Service) Buscando perfil para API Key: ...${String(apiKey).slice(-6)}`);
    try {
        const { data, error, status } = await supabase
            .from('profiles')
            .select('id')
            .eq('widget_api_key', apiKey)
            .single();

        if (error && status !== 406) {
             console.error('(DB Service) Error buscando perfil por API Key:', error.message);
             return null;
        }
        if (data) {
            console.log(`(DB Service) API Key válida. User ID encontrado: ${data.id}`);
            return data.id;
        } else {
             console.log("(DB Service) API Key no encontrada o inválida.");
             return null;
        }
    } catch (err) {
        console.error("(DB Service) Excepción buscando perfil por API Key:", err.message);
        return null;
    }
};

// Eliminar la función getClientConfig si ya no se usa la tabla 'clients'
// export { getClientConfig } // <- Comentar o eliminar si es obsoleta