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
        contextChunks = await hybridSearch(clientId, question, queryEmbedding);
        console.log(`LOG (Controller): hybridSearch devolvió ${contextChunks.length} chunks.`);
    } else {
         console.warn("WARN (Controller): No se pudo generar embedding. Sin búsqueda RAG.");
    }

    // 3. Construir Mensajes para OpenAI
    const messages = [];
    let systemContent = `Eres Zoe, asistente experto de SynChat AI para el cliente ${clientId}. Eres amable, profesional y respondes de forma concisa.`;

    // --- Construcción del Contexto para el Prompt ---
    if (contextChunks && contextChunks.length > 0) {
        const contextString = contextChunks.map(c => {
             // Intentar obtener jerarquía o sección, con fallback
             const hierarchy = c.metadata?.hierarchy?.join(' > ') || c.metadata?.section || 'Contexto';
             const url = c.metadata?.url || '';
             // Limpiar el contenido antes de añadirlo
             const cleanContent = (c.content || '').replace(/\[CONTEXTO:.*?\]/g, '').trim(); // Eliminar prefijos si existen
             return `--- Inicio Fragmento [Fuente: ${hierarchy}${url ? ` (${url})` : ''}] ---\n${cleanContent}\n--- Fin Fragmento ---`;
        }).join('\n\n'); // Separar fragmentos con doble salto de línea

        systemContent += `\n\nCRÍTICO: Basa tu respuesta PRIORITARIAMENTE en la siguiente información recuperada. Si la información responde a la pregunta del usuario, úsala EXCLUSIVAMENTE. Si no responde directamente, indícalo.\n=== CONTEXTO RECUPERADO ===\n${contextString}\n=== FIN CONTEXTO ===`;
    } else {
        systemContent += "\nNo se encontró información específica relevante en la base de conocimiento para esta pregunta.";
    }
    // --- Fin Construcción del Contexto ---

     systemContent += `\n\nInstrucciones Adicionales:\n - Cita tus fuentes: Si usas información del contexto, DEBES añadir la [Fuente: ...] correspondiente EXACTAMENTE como aparece en el contexto, al final de la frase o párrafo relevante.\n - Si la información del contexto no responde directamente a la pregunta del usuario, indícalo claramente y no intentes responderla usando solo conocimiento general. Di algo como "No encontré información específica sobre eso en la base de datos.".\n - Sé conciso: Limita tu respuesta a 2-3 párrafos como máximo.\n - Usa formato Markdown si mejora la legibilidad (listas, negritas) si aplica.`;

    messages.push({ role: "system", content: systemContent });

    // Añadir historial (si existe)
    if (history && history.length > 0) {
        messages.push(...history);
    }
    // Añadir pregunta actual
    messages.push({ role: "user", content: question });

    console.log(`LOG (Controller): Enviando ${messages.length} mensajes a OpenAI (${MODEL_NAME}).`);

    // 4. Llamar a OpenAI
    let reply = "Lo siento, no pude procesar tu solicitud en este momento."; // Mensaje por defecto
    try {
        const response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: messages,
            temperature: 0.2,
            max_tokens: 350
        });
        const generatedReply = response.choices[0]?.message?.content?.trim();
        if (generatedReply) {
             reply = generatedReply;
             console.log(`LOG (Controller): Respuesta recibida de ${MODEL_NAME}.`);
        } else {
             console.error("ERROR (Controller): Respuesta inesperada de OpenAI (contenido vacío o estructura incorrecta):", response);
             // Mantener el mensaje de error por defecto
        }
    } catch(error) {
        console.error(`ERROR FATAL (Controller) al llamar a OpenAI ${MODEL_NAME}:`, error);
        // Mantener el mensaje de error por defecto o uno más específico si es posible
        reply = "Lo siento, ocurrió un error al contactar con el servicio de IA.";
    }

    return reply;
}

// --- Manejadores para las Rutas API ---

/**
 * Manejador para POST /api/chat/start
 */
// Definir la función SIN export aquí
async function startConversationFn(req, res) {
    const { clientId } = req.body;
    console.log(`LOG (Controller): Recibida petición /start para cliente ${clientId}`);
    if (!clientId) {
        return res.status(400).json({ error: "Falta clientId" });
    }
    try {
        const conversationId = await getOrCreateConversation(clientId); // Crea una nueva siempre para /start
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
 // Definir la función SIN export aquí
async function handleChatMessageFn(req, res) {
    try {
        const { clientId, conversationId, message } = req.body;
        console.log(`LOG (Controller): Recibida petición /message para CV ${conversationId}`);

        if (!clientId || !message || !conversationId) {
            return res.status(400).json({ error: "Faltan clientId, conversationId o message" });
        }

        // Verificar caché de respuesta final
        const cacheKey = `response:${clientId}:${conversationId}:${message}`;
        const cachedReply = getCache(cacheKey);
        if (cachedReply) {
            console.log("LOG (Controller): Devolviendo respuesta desde caché.");
            return res.json({ reply: cachedReply, conversationId });
        }

        // Obtener historial REAL
        const history = await getConversationHistory(conversationId, MAX_HISTORY_MESSAGES);

        // Generar la respuesta
        const reply = await generateRAGResponse(clientId, message, history);

        // Guardar mensajes
        let saved = false;
        if (reply && !reply.startsWith("Lo siento")) {
             // Guardar en paralelo puede ser ligeramente más rápido
             const savePromises = [
                 saveMessage(conversationId, 'user', message),
                 saveMessage(conversationId, 'bot', reply)
             ];
             const results = await Promise.all(savePromises);
             saved = results.every(Boolean); // True si ambos guardados fueron exitosos
             if (!saved) {
                 console.warn(`WARN (Controller): Fallo al guardar uno o ambos mensajes para CV ${conversationId}`);
             } else {
                  console.log(`LOG (Controller): Mensajes guardados para CV ${conversationId}`);
             }
        } else {
            console.warn(`WARN (Controller): No se guardarán mensajes para CV ${conversationId} (respuesta vacía o de error).`);
        }

        // Actualizar caché
        if (reply && !reply.startsWith("Lo siento")) {
             setCache(cacheKey, reply);
        }

        res.json({
            reply: reply,
            conversationId: conversationId
        });

    } catch (error) {
        console.error('Error en handleChatMessage:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// --- Exportación Nombrada ÚNICA al final del archivo ---
export {
    startConversationFn as startConversation, // Exportar con el nombre esperado por api.js
    handleChatMessageFn as handleChatMessage  // Exportar con el nombre esperado por api.js
};