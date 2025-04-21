// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js'; // Importar todo como db

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
const CHAT_TEMPERATURE = 0.3;

/**
 * Maneja la recepción de un nuevo mensaje de chat desde el Widget.
 * Autentica usando X-API-Key header.
 */
export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId } = req.body; // Ya NO viene clientId
    const apiKey = req.headers['x-api-key'];      // Leer API Key de la cabecera

    // Validar entradas básicas
    if (!message || !conversationId) {
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId).' });
    }
    if (!apiKey) {
        return res.status(401).json({ error: 'Falta API Key (X-API-Key header).' });
    }

    console.log(`(Controller) Mensaje recibido CV:${conversationId} (API Key: ...${apiKey.slice(-6)}): "${message.substring(0, 100)}..."`);

    try {
        // --- Autenticar API Key y obtener userId ---
        const userId = await db.getUserIdByApiKey(apiKey); // Usa la nueva función
        if (!userId) {
            console.warn(`(Controller) API Key inválida o no encontrada: ...${apiKey.slice(-6)}`);
            return res.status(403).json({ error: 'API Key inválida o no autorizada.' });
        }
        console.log(`(Controller) API Key validada para User ID: ${userId}`);

        // --- Cache (Usar userId en la clave) ---
        const cacheKey = `${userId}:${conversationId}:${message}`; // Clave con userId
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', cachedReply)
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));
            return res.status(200).json({ reply: cachedReply });
        }

        console.log("(Controller) No encontrado en caché. Procesando...");

        // --- Obtener Historial ---
        const conversationHistory = await db.getConversationHistory(conversationId);
        console.log(`(Controller) Historial recuperado: ${conversationHistory.length} mensajes.`);

        // --- Búsqueda Híbrida (RAG) - Usar userId ---
        const relevantKnowledge = await db.hybridSearch(userId, message); // Pasar userId
        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             console.log(`(Controller) ${relevantKnowledge.length} fragmentos RAG encontrados.`);
             // ... (lógica para formatear ragContext igual que antes) ...
              ragContext = relevantKnowledge
                .map(chunk => {
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || '';
                     const prefix = sourceInfo ? `Fuente: ${sourceInfo}\n` : '';
                     return `${prefix}Contenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        } else {
             console.log("(Controller) No se encontraron fragmentos RAG relevantes.");
        }

        // --- Construir Prompt del Sistema (igual que antes) ---
        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI... (resto del prompt igual)`; // Asegúrate que tu prompt esté completo aquí
        const finalSystemPrompt = systemPromptBase +
            (ragContext ? `\n\n--- Contexto ---\n${ragContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

        // --- Construir Mensajes para OpenAI ---
        const messagesForAPI = [
            { role: "system", content: finalSystemPrompt },
            ...conversationHistory,
            { role: "user", content: message }
        ];

        // --- Llamar a OpenAI ---
        console.log(`(Controller) Enviando ${messagesForAPI.length} mensajes a OpenAI...`);
        const botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

        // --- Procesar Respuesta y Guardar ---
        if (botReplyText) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => {
                 console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError);
            });

            db.setCache(cacheKey, botReplyText); // Usar la clave con userId
            res.status(200).json({ reply: botReplyText });
        } else {
            console.error(`(Controller) Respuesta vacía o nula de OpenAI para ${conversationId}`);
            res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
        }

    } catch (error) {
        // Asegurarse de no enviar el userId en errores genéricos al cliente
        console.error(`(Controller) Error general en handleChatMessage para CV ${conversationId}:`, error);
        next(error); // Pasar al middleware de errores global
    }
};

/**
 * Inicia una nueva conversación para un cliente (llamado por el Widget).
 * Autentica usando X-API-Key header.
 */
export const startConversation = async (req, res, next) => {
    console.log('>>> chatController.js: DENTRO de startConversation (Widget)');
    const apiKey = req.headers['x-api-key']; // Leer API Key de la cabecera

    if (!apiKey) {
        console.warn('Petición inválida a /start. Falta X-API-Key.');
        return res.status(401).json({ error: 'Falta API Key (X-API-Key header).' });
    }

    try {
        // --- Autenticar API Key y obtener userId ---
        const userId = await db.getUserIdByApiKey(apiKey);
        if (!userId) {
            console.warn(`(Controller) /start - API Key inválida o no encontrada: ...${apiKey.slice(-6)}`);
            return res.status(403).json({ error: 'API Key inválida o no autorizada.' });
        }
        console.log(`(Controller) /start - API Key validada para User ID: ${userId}`);

        // --- Crear una nueva conversación ---
        // Pasamos el userId obtenido a la función (que también modificamos)
        const conversationId = await db.getOrCreateConversation(userId);
        console.log(`(Controller) /start - Conversación iniciada/creada: ${conversationId} para userId ${userId}`);

        res.status(201).json({ conversationId }); // 201 Created

    } catch (error) {
        console.error(`Error en startConversation (Widget) para API Key ...${apiKey.slice(-6)}:`, error);
        next(error);
    }
};

// Exportar ambas funciones
export default {
    handleChatMessage,
    startConversation
};