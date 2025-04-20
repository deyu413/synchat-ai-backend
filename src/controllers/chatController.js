// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';

// Modelo de IA a usar y Temperatura (más baja reduce creatividad/alucinación)
const CHAT_MODEL = "gpt-3.5-turbo";
const CHAT_TEMPERATURE = 0.3; // <-- Reducir la temperatura puede ayudar

/**
 * Maneja la recepción de un nuevo mensaje de chat.
 */
export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId, clientId } = req.body;

    if (!message || !conversationId || !clientId) {
        console.warn('Petición inválida a /message:', req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    console.log(`(Controller) Mensaje recibido C:${clientId}, CV:${conversationId}: "${message.substring(0, 100)}..."`);

    try {
        // --- Cache ---
        const cacheKey = `${clientId}:${conversationId}:${message}`;
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', cachedReply)
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));
             return res.status(200).json({ reply: cachedReply });
        }

        console.log("(Controller) No encontrado en caché. Procesando...");

        // --- Obtener Historial (Configuración no se usa para el prompt ahora) ---
        // const [conversationHistory, clientConfig] = await Promise.all([ // Ya no necesitamos clientConfig para el prompt
        //     db.getConversationHistory(conversationId),
        //     db.getClientConfig(clientId) // Lo mantenemos por si se usa para otras cosas
        // ]);
        // Simplificado si solo necesitamos historial por ahora:
        const conversationHistory = await db.getConversationHistory(conversationId);
        // const clientConfig = await db.getClientConfig(clientId); // Podrías necesitarlo si reactivas base_prompt

        console.log(`(Controller) Historial recuperado: ${conversationHistory.length} mensajes.`);
        // console.log(`(Controller) Config cliente recuperada: ${clientConfig ? 'OK' : 'No encontrada'}`); // Log opcional

        // --- Búsqueda Híbrida (RAG) ---
        const relevantKnowledge = await db.hybridSearch(clientId, message);
        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             console.log(`(Controller) ${relevantKnowledge.length} fragmentos RAG encontrados.`);
             ragContext = relevantKnowledge
                .map(chunk => {
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || '';
                     return `Fuente: ${sourceInfo}\nContenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        } else {
             console.log("(Controller) No se encontraron fragmentos RAG relevantes.");
        }

        // --- Construir Prompt del Sistema MEJORADO ---
        // Definimos el prompt base específico para SynChat AI aquí
        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto".
2.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases). Cita la fuente si es relevante usando la información de "Fuente:" del contexto.
3.  Si la información necesaria para responder NO se encuentra en el "Contexto", responde EXACTAMENTE con: "Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI." NO intentes adivinar ni buscar en otro lado.
4.  Sé amable y profesional.`;

        // Combinar prompt base con el contexto RAG recuperado
        const finalSystemPrompt = systemPromptBase +
            (ragContext ? `\n\n--- Contexto ---\n${ragContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

        // --- Construir Mensajes para OpenAI ---
        const messagesForAPI = [
            {
                role: "system",
                content: finalSystemPrompt // Usamos el nuevo prompt detallado
            },
            // Historial de la conversación
            ...conversationHistory,
            // Mensaje actual del usuario
            { role: "user", content: message }
        ];

        // console.log('(Controller) Prompt Completo:', JSON.stringify(messagesForAPI, null, 2)); // Debug

        // --- Llamar a OpenAI ---
        console.log(`(Controller) Enviando ${messagesForAPI.length} mensajes a OpenAI (Modelo: ${CHAT_MODEL}, Temp: ${CHAT_TEMPERATURE}).`);
        const botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

        // --- Procesar Respuesta y Guardar ---
        if (botReplyText) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => {
                 console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError);
            });

            db.setCache(cacheKey, botReplyText);
            res.status(200).json({ reply: botReplyText });
        } else {
            console.error(`(Controller) Respuesta vacía o nula de OpenAI para ${conversationId}`);
            // Enviar una respuesta genérica si OpenAI falla
            res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
        }

    } catch (error) {
        console.error(`(Controller) Error general en handleChatMessage para ${conversationId}:`, error);
        next(error);
    }
};

// ... (startConversation se mantiene igual) ...

// Exportar funciones del controlador
export default {
    handleChatMessage,
    startConversation // Asegúrate de que startConversation también se exporte
}; 