// src/controllers/chatController.js
import openai from '../config/openaiClient.js';
import { getEmbeddingWithRetry } from '../services/embeddingService.js';
import { hybridSearch } from '../services/searchService.js';
// Descomenta e importa tus funciones reales de DB para historial y guardado
// import { getConversationHistory, saveMessage } from '../services/databaseService.js';

const MODEL_NAME = "gpt-3.5-turbo"; // ¡Modelo Corregido!
const MAX_HISTORY_MESSAGES = 8; // Max pares User/Assistant en historial

/**
 * Función principal para manejar una petición de chat. Obtiene historial,
 * busca contexto RAG, genera respuesta y (opcionalmente) guarda mensajes.
 * @param {string} clientId
 * @param {string} question
 * @param {string|null} [conversationId=null]
 * @returns {Promise<{reply: string, conversationId: string|null}>}
 */
export async function handleChatMessage(clientId, question, conversationId = null) {
    console.log(`LOG (Controller): Recibido mensaje de ${clientId}. Pregunta: "${question.substring(0,50)}..." CV: ${conversationId}`);

     // --- 1. Obtener Historial ---
     // TODO: Implementar usando tus funciones de DB reales
     console.warn("WARN (Controller): Obtención de historial NO IMPLEMENTADA.");
     const history = conversationId ? [] /* await getConversationHistory(conversationId, MAX_HISTORY_MESSAGES); */ : [];
     console.log(`LOG (Controller): Usando ${history.length} mensajes de historial.`);

     // --- 2. Generar Embedding para la Pregunta ---
     console.log("LOG (Controller): Obteniendo embedding para la pregunta...");
     const queryEmbedding = await getEmbeddingWithRetry(question);

     // --- 3. Buscar Contexto Relevante (RAG Híbrido) ---
     let contextChunks = [];
     if (queryEmbedding) {
         contextChunks = await hybridSearch(clientId, question, queryEmbedding);
         console.log(`LOG (Controller): hybridSearch devolvió ${contextChunks.length} chunks.`);
     } else {
          console.warn("WARN (Controller): No se pudo generar embedding. Procediendo sin búsqueda RAG.");
     }

     // --- 4. Construir Mensajes para OpenAI ---
     const messages = [];

     // System Prompt (con o sin contexto RAG)
     let systemContent = `Eres Zoe, asistente experto de SynChat AI para el cliente ${clientId}. Eres amable, profesional y respondes de forma concisa.`;
     if (contextChunks && contextChunks.length > 0) {
         const contextString = contextChunks.map(c => {
             const hierarchy = c.metadata?.hierarchy?.join(' > ') || c.metadata?.section || 'Contexto';
             const url = c.metadata?.url || '';
             // Formato mejorado para el LLM
             return `--- Inicio Fragmento [Fuente: ${hierarchy}${url ? ` (${url})` : ''}] ---\n${c.content}\n--- Fin Fragmento ---`;
         }).join('\n\n');

         systemContent += `\n\nCRÍTICO: Basa tu respuesta PRIORITARIAMENTE en la siguiente información recuperada. Si la información responde a la pregunta del usuario, úsala EXCLUSIVAMENTE. Si no responde directamente, indícalo.\n=== CONTEXTO RECUPERADO ===\n${contextString}\n=== FIN CONTEXTO ===`;
     } else {
         systemContent += "\nNo se encontró información específica relevante en la base de conocimiento para esta pregunta.";
     }
      systemContent += `\n\nInstrucciones Adicionales:
 - Cita tus fuentes: Si usas información del contexto, DEBES añadir la [Fuente: ...] correspondiente al final de la frase o párrafo. Usa la fuente exacta proporcionada en el contexto.
 - Sé conciso: Limita tu respuesta a 2-3 párrafos como máximo.
 - No inventes: Si el contexto no responde, NO inventes una respuesta. Indica que no encontraste la información específica.
 - Formato: Usa Markdown para mejorar la legibilidad (listas, negritas) si aplica.`;

     messages.push({ role: "system", content: systemContent });

     // Añadir historial (si existe)
     if (history.length > 0) {
         messages.push(...history);
     }

     // Añadir pregunta actual del usuario
     messages.push({ role: "user", content: question });

     console.log(`LOG (Controller): Enviando ${messages.length} mensajes a OpenAI (${MODEL_NAME}).`);
     // console.log("DEBUG (Controller): Mensajes:", JSON.stringify(messages, null, 2)); // Para depurar prompt

     // --- 5. Llamar a OpenAI ---
     let reply = "Lo siento, no pude generar una respuesta."; // Default
     try {
         const response = await openai.chat.completions.create({
             model: MODEL_NAME,
             messages: messages,
             temperature: 0.2,
             max_tokens: 350 // Un poco más de margen
         });
         reply = response.choices[0]?.message?.content?.trim() || reply;
         console.log(`LOG (Controller): Respuesta recibida de ${MODEL_NAME}.`);
     } catch(error) {
         console.error(`ERROR FATAL (Controller) al llamar a OpenAI ${MODEL_NAME}:`, error);
         // Mantener el mensaje de error genérico
     }

     // --- 6. Guardar Mensajes (¡IMPLEMENTAR!) ---
     // TODO: Implementar guardado de 'question' (user) y 'reply' (bot) en DB
     // if (conversationId && reply !== "Lo siento...") {
     //      await saveMessage(conversationId, 'user', question);
     //      await saveMessage(conversationId, 'bot', reply);
     // }
     console.warn("WARN (Controller): Guardado de mensajes NO IMPLEMENTADO.");

     // --- 7. Devolver Respuesta ---
     return { reply, conversationId }; // Devolver ID por si se creó uno nuevo

} // Fin handleChatMessage (o como llames a tu función principal del controlador)

// --- Exportar el manejador para usarlo en tus rutas Express ---
// export default { handleChatMessage }; // O la exportación que necesites