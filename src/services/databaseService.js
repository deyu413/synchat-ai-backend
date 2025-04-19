// src/services/databaseService.js

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Verificación inicial de la variable de entorno de la base de datos
if (!process.env.DATABASE_URL) {
    console.error("¡Error Fatal! La variable de entorno DATABASE_URL no está definida.");
    console.error("Asegúrate de tener un archivo .env en la raíz con DATABASE_URL='postgresql://...' o configúrala en tu entorno de despliegue.");
    process.exit(1); // Salir si no hay URL de DB
}
// Verificación opcional de la clave OpenAI (aunque no se usa directamente aquí, puede ser útil)
if (!process.env.OPENAI_API_KEY) {
    console.warn("Advertencia: OPENAI_API_KEY no está definida. Esto puede ser necesario en otros servicios.");
}

// Crear el pool de conexiones a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Configuración SSL puede ser necesaria dependiendo del proveedor (ej: Heroku, Render)
    // ssl: { rejectUnauthorized: false } // Descomentar si es necesario
});

// Manejador de errores para el pool
pool.on('error', (err, client) => {
    console.error('(DB Service) Error inesperado en el cliente inactivo del pool', err);
    process.exit(-1); // Salir en caso de error grave del pool
});

console.log("(DB Service) Pool de conexiones PostgreSQL inicializado.");

// --- Obtener Configuración del Cliente ---
/**
 * Obtiene la configuración base de un cliente desde la tabla Clients.
 * @param {string} clientId - El UUID del cliente.
 * @returns {Promise<object|null>} - El objeto de configuración del cliente o null si no se encuentra.
 */
const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId}`);
    const query = 'SELECT client_id, client_name, base_prompt, knowledge_config FROM Clients WHERE client_id = $1';
    try {
        const result = await pool.query(query, [clientId]);
        if (result.rows.length > 0) {
            console.log(`(DB Service) Configuración encontrada para cliente ${clientId}.`);
            return result.rows[0];
        }
        console.warn(`(DB Service) No se encontró configuración para el cliente ${clientId}.`);
        return null;
    } catch (error) {
        console.error(`(DB Service) Error al obtener config del cliente ${clientId}:`, error);
        throw error; // Re-lanzar para que el controlador maneje el error
    }
};

// --- Obtener Historial de Conversación ---
/**
 * Obtiene los últimos mensajes de una conversación, formateados para la API de OpenAI.
 * @param {string} conversationId - El UUID de la conversación.
 * @param {number} [messageLimit=10] - Número máximo de mensajes a recuperar.
 * @returns {Promise<Array<object>>} - Un array de objetos { role: 'user'|'assistant', content: '...' }.
 */
const getConversationHistory = async (conversationId, messageLimit = 10) => {
    console.log(`(DB Service) Buscando historial para conversación: ${conversationId}, límite: ${messageLimit}`);
    // Seleccionamos ordenando por timestamp DESC para obtener los últimos, luego invertimos para orden cronológico
    const query = `
        SELECT sender, content 
        FROM Messages 
        WHERE conversation_id = $1 
        ORDER BY timestamp DESC 
        LIMIT $2
    `;
    try {
        const result = await pool.query(query, [conversationId, messageLimit]);
        // Invertir el array para tener el orden cronológico correcto (más antiguo primero)
        const historyInChronologicalOrder = result.rows.reverse();
        // Formatear para la API de OpenAI
        const formattedHistory = historyInChronologicalOrder.map(row => ({
            role: row.sender === 'bot' ? 'assistant' : 'user',
            content: row.content
        }));
        console.log(`(DB Service) Historial formateado encontrado para ${conversationId}: ${formattedHistory.length} mensajes.`);
        return formattedHistory;
    } catch (error) {
        console.error(`(DB Service) Error al obtener historial de ${conversationId}:`, error);
        throw error; // Re-lanzar
    }
};

// --- Guardar Mensaje ---
/**
 * Guarda un mensaje en la base de datos y actualiza el timestamp de la conversación (usando transacción).
 * @param {string} conversationId - El UUID de la conversación.
 * @param {'user'|'bot'} sender - Quién envía el mensaje.
 * @param {string} textContent - El contenido del mensaje.
 */
const saveMessage = async (conversationId, sender, textContent) => {
    console.log(`(DB Service) Guardando mensaje para ${conversationId}: (${sender})`);
    const insertMsgQuery = `INSERT INTO Messages (conversation_id, sender, content) VALUES ($1, $2, $3)`;
    // Actualizar el timestamp de la última actividad en la conversación
    const updateConvQuery = `UPDATE Conversations SET last_message_at = timezone('utc'::text, now()) WHERE conversation_id = $1`;
    
    const client = await pool.connect(); // Obtener un cliente del pool para la transacción
    try {
        await client.query('BEGIN'); // Iniciar transacción
        await client.query(insertMsgQuery, [conversationId, sender, textContent]);
        await client.query(updateConvQuery, [conversationId]);
        await client.query('COMMIT'); // Confirmar transacción
        console.log(`(DB Service) Mensaje guardado y conversación ${conversationId} actualizada.`);
    } catch (error) {
        await client.query('ROLLBACK'); // Deshacer transacción en caso de error
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId} (ROLLBACK ejecutado):`, error);
        // No re-lanzamos el error necesariamente, depende de la lógica de negocio
    } finally {
        client.release(); // Devolver el cliente al pool
    }
};

// --- Obtener o Crear Conversación ---
/**
 * Verifica si una conversationId existe para un cliente dado; si no, crea una nueva.
 * @param {string} clientId - El UUID del cliente.
 * @param {string|null} [conversationId=null] - Un ID de conversación existente para verificar.
 * @returns {Promise<string>} - El ID de la conversación válida (existente o nueva).
 */
const getOrCreateConversation = async (clientId, conversationId = null) => {
    console.log(`(DB Service) Obteniendo/Creando conversación para cliente ${clientId}, ID previo: ${conversationId}`);
    const client = await pool.connect();
    try {
        // Si se proporciona un ID, verificar que existe y pertenece al cliente
        if (conversationId) {
            const checkQuery = 'SELECT conversation_id FROM Conversations WHERE conversation_id = $1 AND client_id = $2';
            const result = await client.query(checkQuery, [conversationId, clientId]);
            if (result.rows.length > 0) {
                console.log(`(DB Service) Conversación existente ${conversationId} validada para cliente ${clientId}.`);
                return conversationId; // El ID es válido y pertenece al cliente
            }
            // Si no existe o no pertenece al cliente, se creará una nueva
            console.log(`(DB Service) ID ${conversationId} inválido o no pertenece a ${clientId}. Creando una nueva.`);
        }
        
        // Crear una nueva conversación si no se proporcionó ID o el ID era inválido
        const newConversationId = uuidv4();
        const insertQuery = `
            INSERT INTO Conversations (conversation_id, client_id, last_message_at) 
            VALUES ($1, $2, timezone('utc'::text, now())) 
            RETURNING conversation_id
        `;
        const insertResult = await client.query(insertQuery, [newConversationId, clientId]);
        const createdId = insertResult.rows[0].conversation_id;
        console.log(`(DB Service) Nueva conversación creada con ID: ${createdId} para cliente ${clientId}`);
        return createdId;
    } catch (error) {
        console.error(`(DB Service) Error en getOrCreateConversation para cliente ${clientId}:`, error);
        throw error; // Re-lanzar
    } finally {
        client.release();
    }
};

// --- Guardar Fragmento de Conocimiento (RAG) ---
/**
 * Guarda un fragmento de texto y su vector de embedding en la tabla KnowledgeChunks.
 * @param {string} clientId - El UUID del cliente.
 * @param {string} chunkText - El texto del fragmento.
 * @param {Array<number>} embeddingVector - El vector de embedding.
 * @param {string|null} [sourceInfo=null] - Información sobre el origen (ej: URL).
 */
const saveKnowledgeChunk = async (clientId, chunkText, embeddingVector, sourceInfo = null) => {
    // Convertir array a formato string de vector PostgreSQL: '[1.2,3.4,...]'
    const vectorString = '[' + embeddingVector.join(',') + ']'; 
    const query = `
        INSERT INTO KnowledgeChunks (client_id, content_text, content_vector, source_info) 
        VALUES ($1, $2, $3, $4) 
        ON CONFLICT (chunk_id) DO NOTHING; -- O podrías usar DO UPDATE si quisieras actualizar
    `;
    try {
        await pool.query(query, [clientId, chunkText, vectorString, sourceInfo]);
        // Loguear solo el inicio del texto para evitar logs enormes
        console.log(`(DB Service) Fragmento guardado para cliente ${clientId}. Origen: ${sourceInfo || 'N/A'}. Texto: "${chunkText.substring(0, 50)}..."`);
    } catch (error) {
        console.error(`(DB Service) Error al guardar fragmento para cliente ${clientId}:`, error);
        // Considera si quieres re-lanzar el error o solo loguearlo
    }
};


// --- Encontrar Conocimiento Relevante (RAG) ---
// --- ¡¡¡ESTA ES LA FUNCIÓN MODIFICADA!!! ---
/**
 * Encuentra fragmentos de conocimiento relevantes para una pregunta dada,
 * basándose en la similitud coseno de los embeddings.
 * @param {string} clientId - El UUID del cliente.
 * @param {Array<number>} questionVector - El vector de embedding de la pregunta.
 * @param {number} [limit=3] - Número máximo de fragmentos a devolver.
 * @param {number} [similarityThreshold=0.5] - Umbral mínimo de similitud coseno. ¡BAJADO PARA PRUEBA!
 * @returns {Promise<Array<string>>} - Un array con los textos de los fragmentos relevantes.
 */
const findRelevantKnowledge = async (clientId, questionVector, limit = 3, similarityThreshold = 0.5) => { // <-- ¡UMBRAL BAJADO A 0.5!

    // Convertimos el umbral de similitud (0 a 1, mayor es mejor) a umbral de distancia coseno (0 a 2, menor es mejor)
    const distanceThreshold = 1 - similarityThreshold;
    
    // Log mejorado para depuración
    console.log(`(DB Service) Buscando conocimiento relevante para cliente ${clientId} con umbral SIMILARIDAD >= ${similarityThreshold} (DISTANCIA < ${distanceThreshold})`); 

    if (!questionVector || questionVector.length === 0) {
        console.warn("(DB Service) Vector de pregunta vacío o inválido recibido en findRelevantKnowledge.");
        return []; // Devuelve array vacío si no hay vector
    }
    
    // Convertir el array de JS a formato string de vector PostgreSQL
    const vectorString = '[' + questionVector.join(',') + ']'; 
    
    // Consulta SQL usando el operador de distancia coseno (<=>) de pgvector
    const query = `
        SELECT 
            content_text
            /* , 1 - (content_vector <=> $2) AS similarity */ -- Descomentar para ver la puntuación exacta
        FROM KnowledgeChunks
        WHERE 
            client_id = $1                   -- Filtra por cliente
          AND content_vector <=> $2 < $3     -- Filtra por distancia (vector <=> query_vector < distancia_maxima)
        ORDER BY 
            content_vector <=> $2            -- Ordena por distancia (los más cercanos primero)
        LIMIT $4                           -- Limita el número de resultados
    `;
    
    try {
        // Ejecutar la consulta pasando los parámetros correctos
        const result = await pool.query(query, [clientId, vectorString, distanceThreshold, limit]); 
        
        // Mapear los resultados para obtener solo el texto
        const relevantTexts = result.rows.map(row => row.content_text);
        
        // Loguear el resultado de la búsqueda
        console.log(`(DB Service) Encontrados ${relevantTexts.length} fragmentos relevantes con umbral ${similarityThreshold}.`);
        
        // Opcional: Loguear scores si se descomentó en el SELECT
        // if (result.rows.length > 0 && result.rows[0].similarity !== undefined) { 
        //     console.log(`(DB Service) Scores de similitud encontrados: ${result.rows.map(r => r.similarity.toFixed(4))}`); 
        // }

        return relevantTexts; // Devolver los textos encontrados

    } catch (error) {
        // Manejo de errores específicos de pgvector/tabla
         if (error.message.includes('type "vector" does not exist') || error.message.includes('relation "knowledgechunks" does not exist')) { 
            console.warn('(DB Service) Advertencia: Tabla KnowledgeChunks o extensión vector no encontrada. Asegúrate de que pgvector esté habilitado y la tabla exista.'); 
            return []; // Devolver vacío si la tabla/extensión falta
        }
         if (error.message.includes('operator does not exist: vector <=> vector')) { 
            console.warn('(DB Service) Advertencia: Operador <=> de pgvector no encontrado. Asegúrate de que la extensión pgvector esté correctamente instalada y habilitada en Supabase.'); 
            return []; // Devolver vacío si el operador falta
        }
        // Error genérico
        console.error(`(DB Service) Error durante la búsqueda vectorial para cliente ${clientId}:`, error);
        return []; // Devolver array vacío en caso de otros errores
    }
};
// --- FIN DE LA FUNCIÓN MODIFICADA ---


// --- Exportaciones (Asegúrate de que estén todas las funciones que usas) ---
module.exports = {
    getClientConfig,
    getConversationHistory,
    saveMessage,
    getOrCreateConversation,
    findRelevantKnowledge,
    saveKnowledgeChunk,
    // pool // Exportar el pool directamente es generalmente desaconsejado
};