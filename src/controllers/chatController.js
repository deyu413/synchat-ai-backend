// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js'; // Importar todo como 'db'

// Modelo de IA a usar
const CHAT_MODEL = "gpt-3.5-turbo";
const CHAT_TEMPERATURE = 0.7;

/**
 * Maneja la recepción de un nuevo mensaje de chat.
 */
export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId, clientId } = req.body;

    // Validación de entrada
    if (!message || !conversationId || !clientId) {
        console.warn('Petición inválida a /message:', req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    console.log(`(Controller) Mensaje recibido C:${clientId}, CV:${conversationId}: "${message.substring(0, 100)}..."`);

    try {
        // --- Intentar obtener de la caché primero ---
        const cacheKey = `${clientId}:${conversationId}:${message}`;
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            // Guardar mensajes (incluso si la respuesta es de caché)
            // No bloqueante
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', cachedReply)
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));

             return res.status(200).json({ reply: cachedReply });
        }

        // --- Si no está en caché, proceder ---
        console.log("(Controller) No encontrado en caché. Procesando...");

        // --- Obtener datos necesarios en paralelo ---
        const [conversationHistory, clientConfig] = await Promise.all([
            db.getConversationHistory(conversationId),
            db.getClientConfig(clientId)
        ]);

        console.log(`(Controller) Historial recuperado: ${conversationHistory.length} mensajes.`);

        if (!clientConfig) {
             // Importante: El cliente DEBE existir para proceder.
             console.error(`(Controller) Cliente no encontrado o sin configuración: ${clientId}`);
             return res.status(404).json({ error: 'Cliente no configurado o no encontrado.' });
        }
        const systemPrompt = clientConfig.base_prompt || `Eres Zoe, un asistente virtual amable y servicial. Responde de forma concisa.`;
        console.log(`(Controller) Usando system prompt: "${systemPrompt.substring(0,100)}..."`);


        // --- Búsqueda Híbrida (RAG) ---
        const relevantKnowledge = await db.hybridSearch(clientId, message);
        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             console.log(`(Controller) ${relevantKnowledge.length} fragmentos RAG encontrados.`);
             // Formatear contexto RAG para el prompt, incluyendo metadatos si existen
             ragContext = relevantKnowledge
                .map(chunk => {
                     // Intentar obtener jerarquía o URL de metadatos
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || 'Fuente desconocida';
                     return `Fuente: ${sourceInfo}\nContenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        } else {
             console.log("(Controller) No se encontraron fragmentos RAG relevantes.");
        }

        // --- Construir Prompt para OpenAI ---
        const messagesForAPI = [
            {
                role: "system",
                content: systemPrompt + (ragContext ? `\n\nUsa la siguiente información si es relevante para responder:\n${ragContext}` : '')
            },
            // Historial de la conversación
            ...conversationHistory,
            // Mensaje actual del usuario
            { role: "user", content: message }
        ];

        // console.log('(Controller) Prompt Completo:', JSON.stringify(messagesForAPI, null, 2)); // Descomentar para debug detallado

        // --- Llamar a OpenAI ---
        const botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

        // --- Procesar Respuesta y Guardar ---
        if (botReplyText) {
            // Guardar mensajes en DB (no bloqueante)
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => {
                 console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError);
            });

            // Guardar en caché
            db.setCache(cacheKey, botReplyText);

            // Enviar respuesta
            res.status(200).json({ reply: botReplyText });
        } else {
            console.error(`(Controller) Respuesta vacía o nula de OpenAI para ${conversationId}`);
            res.status(503).json({ error: 'La IA no pudo generar una respuesta en este momento.' }); // 503 Service Unavailable
        }

    } catch (error) {
        console.error(`(Controller) Error general en handleChatMessage para ${conversationId}:`, error);
        next(error); // Pasar al middleware de errores global
    }
};

/**
 * Inicia una nueva conversación para un cliente.
 */
export const startConversation = async (req, res, next) => {
    console.log('>>> chatController.js: DENTRO de startConversation');
    const { clientId } = req.body;

    if (!clientId) {
        console.warn('Petición inválida a /start. Falta clientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }

    try {
        // Verificar si el cliente existe (buena práctica)
        const clientExists = await db.getClientConfig(clientId);
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }

        // Crear una nueva conversación
        const conversationId = await db.getOrCreateConversation(clientId);
        console.log(`(Controller) Conversación iniciada/creada: ${conversationId} para cliente ${clientId}`);

        res.status(201).json({ conversationId }); // 201 Created

    } catch (error) {
        console.error(`Error en startConversation para cliente ${clientId}:`, error);
        next(error); // Pasar al middleware de errores
    }
};

// Exportar funciones del controlador
export default {
    handleChatMessage,
    startConversation
};