// src/services/openaiService.js
const OpenAI = require('openai');

// Reintentar obtener la key aquí también por si acaso
if (!process.env.OPENAI_API_KEY) {
    console.error("¡Error Fatal! La variable de entorno OPENAI_API_KEY no está definida.");
    // Podríamos lanzar un error para que no se inicie el servicio si falta
    throw new Error("OPENAI_API_KEY no definida.");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Obtiene una respuesta del modelo de chat de OpenAI.
 * @param {Array<object>} messages - Array de mensajes en formato OpenAI.
 * @returns {Promise<string|null>} - La respuesta del bot o null si hay error.
 */
const getChatCompletion = async (messages) => {
    console.log(`(OpenAI Service) Enviando ${messages.length} mensajes a la API...`);
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Modelo económico para empezar
            messages: messages,
            temperature: 0.7, // Un equilibrio entre creatividad y determinación
            // max_tokens: 500, // Limitar longitud de respuesta si es necesario
        });

        const reply = completion.choices?.[0]?.message?.content?.trim();

        if (reply) {
             console.log("(OpenAI Service) Respuesta recibida.");
            return reply;
        } else {
            console.error("(OpenAI Service) Respuesta inesperada de la API:", completion);
            return null;
        }

    } catch (error) {
        console.error("(OpenAI Service) Error al llamar a la API de OpenAI:", error.message || error);
        // Podríamos intentar identificar tipos de error (rate limit, auth, etc.)
        // if (error.status === 429) { /* Rate limit */}
        // if (error.status === 401) { /* Auth error */ }
        return null;
    }
};

module.exports = {
    getChatCompletion,
};