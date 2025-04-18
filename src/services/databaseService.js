// src/services/databaseService.js

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

if (!process.env.DATABASE_URL) { /*...*/ process.exit(1); }
if (!process.env.OPENAI_API_KEY) { /*...*/ }

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => { /*...*/ });
console.log("(DB Service) Pool de conexiones PostgreSQL inicializado.");

// --- getClientConfig (igual que antes) ---
const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId}`);
    const query = 'SELECT client_id, client_name, base_prompt, knowledge_config FROM Clients WHERE client_id = $1';
    try {
        const result = await pool.query(query, [clientId]);
        if (result.rows.length > 0) { return result.rows[0]; }
        return null;
    } catch (error) { console.error(`(DB Service) Error al obtener config del cliente ${clientId}:`, error); throw error; }
};

// --- getConversationHistory (igual que antes) ---
const getConversationHistory = async (conversationId, messageLimit = 10) => {
    console.log(`(DB Service) Buscando historial para conversación: ${conversationId}, límite: ${messageLimit}`);
    const query = `SELECT sender, content FROM Messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT $2`;
    try {
        const result = await pool.query(query, [conversationId, messageLimit]);
        const historyInChronologicalOrder = result.rows.reverse();
        const formattedHistory = historyInChronologicalOrder.map(row => ({ role: row.sender === 'bot' ? 'assistant' : 'user', content: row.content }));
        console.log(`(DB Service) Historial formateado encontrado: ${formattedHistory.length} mensajes.`);
        return formattedHistory;
    } catch (error) { console.error(`(DB Service) Error al obtener historial de ${conversationId}:`, error); throw error; }
};

// --- saveMessage (igual que antes) ---
const saveMessage = async (conversationId, sender, textContent) => {
    console.log(`(DB Service) Guardando mensaje para ${conversationId}: (${sender})`);
    const insertMsgQuery = `INSERT INTO Messages (conversation_id, sender, content) VALUES ($1, $2, $3)`;
    const updateConvQuery = `UPDATE Conversations SET last_message_at = timezone('utc'::text, now()) WHERE conversation_id = $1`;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(insertMsgQuery, [conversationId, sender, textContent]);
        await client.query(updateConvQuery, [conversationId]);
        await client.query('COMMIT');
        console.log(`(DB Service) Mensaje guardado y conversación ${conversationId} actualizada.`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId} (ROLLBACK ejecutado):`, error);
    } finally {
        client.release();
    }
};

// --- getOrCreateConversation (igual que antes) ---
const getOrCreateConversation = async (clientId, conversationId = null) => {
    console.log(`(DB Service) Obteniendo/Creando conversación para cliente ${clientId}, ID previo: ${conversationId}`);
    const client = await pool.connect();
    try {
        if (conversationId) {
            const checkQuery = 'SELECT conversation_id FROM Conversations WHERE conversation_id = $1 AND client_id = $2';
            const result = await client.query(checkQuery, [conversationId, clientId]);
            if (result.rows.length > 0) { return conversationId; }
            console.log(`(DB Service) ID ${conversationId} inválido o no pertenece a ${clientId}. Creando una nueva.`);
        }
        const newConversationId = uuidv4();
        const insertQuery = `INSERT INTO Conversations (conversation_id, client_id, last_message_at) VALUES ($1, $2, timezone('utc'::text, now())) RETURNING conversation_id`;
        const insertResult = await client.query(insertQuery, [newConversationId, clientId]);
        const createdId = insertResult.rows[0].conversation_id;
        console.log(`(DB Service) Nueva conversación creada: ${createdId}`);
        return createdId;
    } catch (error) { console.error(`(DB Service) Error en getOrCreateConversation para cliente ${clientId}:`, error); throw error; }
    finally { client.release(); }
};

// --- saveKnowledgeChunk (igual que antes) ---
const saveKnowledgeChunk = async (clientId, chunkText, embeddingVector, sourceInfo = null) => {
    const vectorString = '[' + embeddingVector.join(',') + ']';
    const query = `INSERT INTO KnowledgeChunks (client_id, content_text, content_vector, source_info) VALUES ($1, $2, $3, $4) ON CONFLICT (chunk_id) DO NOTHING;`;
    try {
        await pool.query(query, [clientId, chunkText, vectorString, sourceInfo]);
        console.log(`(DB Service) Fragmento guardado para ${clientId}. Texto: "${chunkText.substring(0, 50)}..."`);
    } catch (error) { console.error(`(DB Service) Error al guardar fragmento para cliente ${clientId}:`, error); }
};

// --- findRelevantKnowledge (¡CON UMBRAL AJUSTADO!) ---
/**
 * Encuentra fragmentos de conocimiento relevantes...
 * @param {number} [similarityThreshold=0.65] - Umbral mínimo de similitud coseno. ¡AJUSTADO!
 */
const findRelevantKnowledge = async (clientId, questionVector, limit = 3, similarityThreshold = 0.65) => { // <-- UMBRAL CAMBIADO A 0.65
    console.log(`(DB Service) Buscando conocimiento relevante para cliente ${clientId} con umbral >= ${similarityThreshold}`);
    if (!questionVector || questionVector.length === 0) { return []; }
    const vectorString = '[' + questionVector.join(',') + ']';
    const distanceThreshold = 1 - similarityThreshold; // Ahora 1 - 0.65 = 0.35

    const query = `
        SELECT content_text
        FROM KnowledgeChunks
        WHERE client_id = $1
          AND content_vector <=> $2 < $3
        ORDER BY content_vector <=> $2
        LIMIT $4
    `;
    try {
        const result = await pool.query(query, [clientId, vectorString, distanceThreshold, limit]);
        const relevantTexts = result.rows.map(row => row.content_text);
        console.log(`(DB Service) Encontrados ${relevantTexts.length} fragmentos relevantes con umbral ${similarityThreshold}.`);
        return relevantTexts;
    } catch (error) {
         if (error.message.includes('type "vector" does not exist') || error.message.includes('relation "knowledgechunks" does not exist')) { console.warn('(DB Service) Tabla/Extensión RAG no encontrada.'); return []; }
         if (error.message.includes('operator does not exist: vector <=> vector')) { console.warn('(DB Service) Operador vectorial no encontrado (pgvector?).'); return []; }
        console.error(`(DB Service) Error en búsqueda vectorial para cliente ${clientId}:`, error);
        return [];
    }
};

// --- Exportaciones (Asegúrate de que estén todas) ---
module.exports = {
    getClientConfig,
    getConversationHistory,
    saveMessage,
    getOrCreateConversation,
    findRelevantKnowledge,
    saveKnowledgeChunk,
};