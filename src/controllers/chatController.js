// src/controllers/chatController.js

const openaiService = require('../services/openaiService');
const databaseService = require('../services/databaseService');
const embeddingService = require('../services/embeddingService');

/**
 * Maneja la recepción de un nuevo mensaje de chat.
 * Orquesta la búsqueda de historial, RAG, llamada a OpenAI y guardado.
 */
const handleChatMessage = async (req, res, next) => { // Añadido next para manejo de errores
    const { message, conversationId, clientId } = req.body;

    // Validación de entrada básica
    if (!message || !conversationId || !clientId) {
        console.warn('Petición inválida a /message. Faltan datos:', req.body);
        // Usar return aquí evita seguir ejecutando código en esta función
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    console.log(`Msg recibido C:${clientId}, CV:${conversationId}: "${message}"`);

    try {
        // --- Obtener datos necesarios en paralelo ---
        const historyLimit = 8; // Número de mensajes previos a considerar
        const [conversationHistory, clientConfig, questionEmbedding] = await Promise.all([
             databaseService.getConversationHistory(conversationId, historyLimit),
             databaseService.getClientConfig(clientId),
             embeddingService.getEmbedding(message)
        ]);

        console.log(`(Controller) Historial recuperado: ${conversationHistory.length} mensajes.`);
        console.log(`(Controller) Config cliente recuperada: ${clientConfig ? 'OK' : 'No encontrada'}`);

        if (!clientConfig) {
             console.error(`Cliente no encontrado o sin configuración: ${clientId}`);
             // Podrías decidir si fallar o continuar con un prompt genérico
             // return res.status(404).json({ error: 'Cliente no configurado o no encontrado.'});
        }
        // Usar prompt base del cliente o uno por defecto si no existe
        const systemPrompt = clientConfig?.base_prompt || `Eres Zoe, un asistente virtual amable y servicial. Responde de forma concisa.`;

        // --- Lógica RAG ---
        let relevantKnowledge = [];
        if (questionEmbedding) {
            const knowledgeLimit = 3; // Máximo de fragmentos RAG a usar
            // El umbral se define por defecto en databaseService (actualmente 0.65)
            relevantKnowledge = await databaseService.findRelevantKnowledge(
                clientId,
                questionEmbedding,
                knowledgeLimit
            );
        }
        // Formatear contexto RAG para el prompt
        const ragContext = relevantKnowledge.join("\n\n---\n\n");

        // --- Construir Prompt para OpenAI ---
        const messagesForAPI = [
            // Instrucción de Sistema + Contexto RAG (si existe)
            {
                role: "system",
                content: systemPrompt + (ragContext ? `\n\nUtiliza estrictamente la siguiente información específica si es relevante para responder la pregunta del usuario:\n${ragContext}` : '')
            },
            // Historial de la conversación (si existe)
            ...conversationHistory,
            // Mensaje actual del usuario
            { role: "user", content: message }
        ];
        console.log(`(Controller) Enviando ${messagesForAPI.length} mensajes a OpenAI.`);
        // Descomentar para depuración detallada del prompt:
        // console.log('(Controller) Prompt Completo:', JSON.stringify(messagesForAPI, null, 2));

        // --- Llamar a OpenAI ---
        const botReplyText = await openaiService.getChatCompletion(messagesForAPI);

        // --- Procesar Respuesta y Guardar ---
        if (botReplyText !== null && botReplyText !== '') {
             // Guardar mensajes en DB (no bloqueamos la respuesta al usuario por esto)
             // Usamos .catch aquí para loggear errores de guardado sin detener todo
            Promise.all([
                databaseService.saveMessage(conversationId, 'user', message),
                databaseService.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => {
                console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError);
            });

            // Enviar respuesta de Zoe al widget
            res.status(200).json({ reply: botReplyText });

        } else {
             // Si OpenAI no dio respuesta válida
             console.error(`Respuesta vacía o nula de OpenAI para conversación ${conversationId}`);
            res.status(500).json({ error: 'La IA no pudo generar una respuesta en este momento.' });
        }

    } catch (error) {
        // Capturar cualquier error inesperado en el proceso
        console.error(`Error general capturado en handleChatMessage para ${conversationId}:`, error);
        // Pasar el error al siguiente middleware de manejo de errores (definido en server.js)
        next(error);
    }
};

/**
 * Inicia una nueva conversación o recupera una existente si se pasa ID (aunque la ruta /start no lo usa).
 */
const startConversation = async (req, res, next) => { // Añadido next
    try {
        const { clientId } = req.body;
        if (!clientId) {
             console.warn('Petición inválida a /start. Falta clientId.');
             return res.status(400).json({ error: 'Falta clientId.' });
        }

        // Verificar si el cliente existe antes de crear conversación (opcional pero buena idea)
        const clientExists = await databaseService.getClientConfig(clientId);
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }

        // Siempre creamos una nueva conversación al llamar a /start
        const conversationId = await databaseService.getOrCreateConversation(clientId, null);
        console.log(`(Controller) Conversación iniciada: ${conversationId} para cliente ${clientId}`);
        // 201 Created es más apropiado aquí que 200 OK
        res.status(201).json({ conversationId });

    } catch (error) {
        console.error(`Error en startConversation para cliente ${req.body?.clientId}:`, error);
        next(error); // Pasar al middleware de errores
    }
};

module.exports = {
    handleChatMessage,
    startConversation,
    // Aquí podríamos añadir getHistory si lo implementamos
};