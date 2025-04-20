// src/controllers/chatController.js
import 'dotenv/config';
// Importar clientes y servicios necesarios
import openai from '../config/openaiClient.js';
import { getEmbeddingWithRetry } from '../services/embeddingService.js';
import { hybridSearch, getCache, setCache, getConversationHistory, saveMessage, getOrCreateConversation } from '../services/databaseService.js'; // Importar todo lo necesario

const MODEL_NAME = "gpt-3.5-turbo"; // ¡Modelo Corregido!
const MAX_HISTORY_MESSAGES = 8;

/**
 * Función interna para generar la respuesta RAG.
 */
async function generateRAGResponse(clientId, question, history = []) {
    console.log(`LOG (Controller): Generando respuesta RAG para ${clientId}. Pregunta: "${question.substring(0,50)}..."`);

    // 1. Generar Embedding para la Pregunta
    const queryEmbedding = await getEmbeddingWithRetry(question);

    // 2. Buscar Contexto Relevante (RAG Híbrido)
    let contextChunks = [];
    if (queryEmbedding) {
        // Llamar a hybridSearch (que ya maneja su propia caché interna)
        contextChunks = await hybridSearch(clientId, question, queryEmbedding);
        console.log(`LOG (Controller): hybridSearch devolvió ${contextChunks.length} chunks.`);
    } else {
         console.warn("WARN (Controller): No se pudo generar embedding. Sin búsqueda RAG.");
    }

    // 3. Construir Mensajes para OpenAI
    const messages = [];
    let systemContent = `Eres Zoe, asistente experto de SynChat AI para el cliente ${clientId}. Eres amable, profesional y respondes de forma concisa.`;
    if (contextChunks && contextChunks.length > 0) {
        const contextString = contextChunks.map(c => { /* ... (igual que antes) ... */ }).join('\n\n---\n\n');
        systemContent += `\n\nCRÍTICO: Basa tu respuesta PRIORITARIAMENTE en la siguiente información recuperada...\n=== CONTEXTO RECUPERADO ===\n${contextString}\n=== FIN CONTEXTO ===`;
    } else {
        systemContent += "\nNo se encontró información específica relevante...";
    }
     systemContent += `\n\nInstrucciones Adicionales:\n - Cita tus fuentes [Fuente: ...] EXACTAS...\n - Si el contexto no responde, INDÍCALO...\n - Sé breve...\n - Usa Markdown...`;
    messages.push({ role: "system", content: systemContent });

    // Añadir historial (si existe)
    if (history.length > 0) { messages.push(...history); }
    // Añadir pregunta actual
    messages.push({ role: "user", content: question });

    console.log(`LOG (Controller): Enviando ${messages.length} mensajes a OpenAI (${MODEL_NAME}).`);

    // 4. Llamar a OpenAI
    let reply = "Lo siento, no pude procesar tu solicitud en este momento.";
    try {
        const response = await openai.chat.completions.create({
            model: MODEL_NAME, messages: messages, temperature: 0.2, max_tokens: 350
        });
        const generatedReply = response.choices[0]?.message?.content?.trim();
        if (generatedReply) { reply = generatedReply; console.log(`LOG (Controller): Respuesta recibida de ${MODEL_NAME}.`); }
        else { console.error("ERROR (Controller): Respuesta inesperada de OpenAI:", response); }
    } catch(error) { console.error(`ERROR FATAL (Controller) al llamar a OpenAI ${MODEL_NAME}:`, error); }

    return reply; // Devolver solo la respuesta
}

// --- Manejadores para las Rutas API ---

/**
 * Manejador para POST /api/chat/start
 */
export const startConversation = async (req, res) => {
    const { clientId } = req.body;
    console.log(`LOG (Controller): Recibida petición /start para cliente ${clientId}`);
    if (!clientId) {
        return res.status(400).json({ error: "Falta clientId" });
    }
    try {
        // TODO: Verificar si el clientId existe en tu tabla Clients si es necesario
        // const clientConfig = await getClientConfig(clientId);
        // if (!clientConfig) return res.status(404).json({ error: 'Cliente no encontrado' });

        const conversationId = await getOrCreateConversation(clientId); // Crea una nueva
        if (!conversationId) {
             throw new Error("No se pudo crear la conversación en DB.");
        }
        console.log(`LOG (Controller): Nueva conversación iniciada: ${conversationId}`);
        res.status(201).json({ conversationId }); // Devolver el nuevo ID

    } catch (error) {
        console.error('Error en startConversation:', error);
        res.status(500).json({ error: 'Error interno al iniciar conversación' });
    }
};

/**
 * Manejador para POST /api/chat/message
 */
export const handleChatMessage = async (req, res) => {
    try {
        const { clientId, conversationId, message } = req.body;
        console.log(`LOG (Controller): Recibida petición /message para CV ${conversationId}`);

        if (!clientId || !message || !conversationId) { // Ahora conversationId es requerido aquí
            return res.status(400).json({ error: "Faltan clientId, conversationId o message" });
        }

        // Verificar caché de respuesta final (opcional pero rápido)
        const cacheKey = `response:${clientId}:${conversationId}:${message}`;
        const cachedReply = getCache(cacheKey);
        if (cachedReply) {
            console.log("LOG (Controller): Devolviendo respuesta desde caché.");
            // Quizás guardar los mensajes incluso si es de caché? O no? Decisión tuya.
            // await saveMessage(conversationId, 'user', message); // Si quieres guardar siempre
            // await saveMessage(conversationId, 'bot', cachedReply);
            return res.json({ reply: cachedReply, conversationId });
        }

        // Obtener historial REAL antes de generar respuesta
        const history = await getConversationHistory(conversationId, MAX_HISTORY_MESSAGES);

        // Generar la respuesta usando RAG y historial
        const reply = await generateRAGResponse(clientId, message, history); // Pasar historial

        // Guardar mensajes (usuario y bot) en la BD
        if (reply && reply !== "Lo siento, no pude procesar tu solicitud en este momento.") { // Evitar guardar errores genéricos
             await saveMessage(conversationId, 'user', message);
             await saveMessage(conversationId, 'bot', reply);
        } else {
            console.warn(`WARN (Controller): No se guardarán mensajes para CV ${conversationId} debido a respuesta vacía o de error.`);
        }

        // Actualizar caché con la nueva respuesta generada
        setCache(cacheKey, reply);

        res.json({
            reply: reply,
            conversationId: conversationId // Devolver el mismo ID
        });

    } catch (error) {
        console.error('Error en handleChatMessage:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Asegúrate de exportar ambas funciones si tu router las necesita así
export default { handleChatMessage, startConversation };