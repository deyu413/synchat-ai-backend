// src/services/embeddingService.js
const OpenAI = require('openai');

let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
    console.error("¡Error Fatal! OPENAI_API_KEY no definida para Embedding Service.");
    // El servicio no funcionará sin la key
}

// Modelo de embedding recomendado
const EMBEDDING_MODEL = "text-embedding-3-small";
// Dimensión esperada para este modelo (verificar en doc OpenAI)
const EMBEDDING_DIMENSION = 1536;

/**
 * Obtiene el vector (embedding) para un texto dado.
 * @param {string} text - El texto a convertir en vector.
 * @returns {Promise<Array<number>|null>} - El vector o null si hay error.
 */
const getEmbedding = async (text) => {
    if (!openai) {
        console.error("(Embedding Service) OpenAI client no inicializado.");
        return null;
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        console.warn("(Embedding Service) Texto inválido o vacío proporcionado para embedding.");
        return null;
    }


    // Reemplazar saltos de línea y normalizar espacios (mejora calidad embedding)
    const inputText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    // Evitar enviar texto vacío a la API
     if (inputText.length === 0) {
         return null;
     }

    console.log(`(Embedding Service) Obteniendo embedding para texto: "${inputText.substring(0, 50)}..."`);

    try {
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: inputText,
            // dimensions: EMBEDDING_DIMENSION // Descomentar si el modelo lo soporta y quieres forzar dimensión
        });

        const embedding = response?.data?.[0]?.embedding;

        if (embedding) {
             // Validación opcional de dimensión
             if(embedding.length !== EMBEDDING_DIMENSION){
                  console.warn(`(Embedding Service) Warning: La dimensión del embedding (${embedding.length}) no coincide con la esperada (${EMBEDDING_DIMENSION})`);
             }
             console.log("(Embedding Service) Embedding obtenido con éxito.");
            return embedding;
        } else {
            console.error("(Embedding Service) Respuesta inesperada de la API de Embeddings:", response);
            return null;
        }
    } catch (error) {
        console.error(`(Embedding Service) Error al obtener embedding:`, error.message || error);
        return null;
    }
};

module.exports = {
    getEmbedding,
    EMBEDDING_DIMENSION
};