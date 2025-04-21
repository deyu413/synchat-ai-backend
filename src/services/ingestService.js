// src/services/ingestService.js
// Mueve la lógica de ingestWebsite aquí como una función exportable
import axios from 'axios';
import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js'; // Necesitamos el cliente aquí también
import OpenAI from 'openai';
import { getEmbedding } from './embeddingService.js'; // Importar desde embeddingService

// --- Configuración (Puedes moverla a un archivo config si prefieres) ---
const MIN_CHUNK_LENGTH_CHARS = 50;
const TARGET_CHUNK_WORDS = 200;
const MAX_CHUNK_WORDS = 300;
const MIN_KEYWORDS_FOR_VALIDATION = 4;
const EMBEDDING_BATCH_SIZE = 20;
const EMBEDDING_MODEL = "text-embedding-3-small";
const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatBot/1.1; +https://www.synchatai.com/bot)';

// --- Inicialización (Dentro de la función o pasado como parámetro) ---
// Es mejor pasar los clientes inicializados para evitar crearlos múltiples veces
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// O importarlos desde sus respectivos módulos
import { supabase } from './supabaseClient.js';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Asume que openaiService no exporta el cliente

// --- Funciones de Ayuda (chunkContent, validateChunk, generateEmbeddings, storeChunks) ---
// *** COPIA Y PEGA LAS FUNCIONES COMPLETAS DESDE TU ingestWebsite.js ORIGINAL AQUÍ ***
// Asegúrate de que 'generateEmbeddings' use la función 'getEmbedding' importada
// y que 'storeChunks' use el cliente 'supabase' importado o pasado.

function validateChunk(text) { /* ... código original ... */
    if (!text || text.trim().length < MIN_CHUNK_LENGTH_CHARS) {
        return false;
    }
    const significantWords = text.match(/\b[a-zA-ZáéíóúñÁÉÍÓÚÑ]{4,}\b/g) || [];
    return significantWords.length >= MIN_KEYWORDS_FOR_VALIDATION;
}

function chunkContent(html, url) { /* ... código original ... */
    console.log("Iniciando chunking jerárquico...");
    const $ = load(html);
    const chunks = [];
    let contextStack = [];
    let currentChunkLines = [];
    let currentWordCount = 0;
    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();
    const relevantSelectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote';
    $(relevantSelectors).each((i, el) => {
        const $el = $(el);
        const tag = $el.prop('tagName').toLowerCase();
        let text = ($el.text() || '').replace(/\s\s+/g, ' ').trim();
        if (text.length < 15) return;
        let currentHierarchy = [...contextStack];
        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            contextStack = contextStack.slice(0, level - 1);
            contextStack[level - 1] = text;
            currentHierarchy = [...contextStack];
            if (currentWordCount > 0) { const chunkText = currentChunkLines.join('\n'); if (validateChunk(chunkText)) { chunks.push({ text: chunkText, metadata: { url, hierarchy: [...contextStack.slice(0, level-1)] } }); } currentChunkLines = []; currentWordCount = 0; }
        }
        const elementWordCount = text.split(/\s+/).length;
        if (currentWordCount > 0 && (currentWordCount + elementWordCount) > MAX_CHUNK_WORDS) { const chunkText = currentChunkLines.join('\n'); if (validateChunk(chunkText)) { chunks.push({ text: chunkText, metadata: { url, hierarchy: [...currentHierarchy] } }); } currentChunkLines = [text]; currentWordCount = elementWordCount; } else { currentChunkLines.push(text); currentWordCount += elementWordCount; }
        if (currentWordCount >= TARGET_CHUNK_WORDS) { const chunkText = currentChunkLines.join('\n'); if (validateChunk(chunkText)) { chunks.push({ text: chunkText, metadata: { url, hierarchy: [...currentHierarchy] } }); } currentChunkLines = []; currentWordCount = 0; }
    });
    if (currentWordCount > 0) { const chunkText = currentChunkLines.join('\n'); if (validateChunk(chunkText)) { chunks.push({ text: chunkText, metadata: { url, hierarchy: [...contextStack] } }); } }
    console.log(`Chunking completado. Generados ${chunks.length} chunks válidos.`);
    return chunks;
}

async function generateEmbeddings(chunks) { /* ... código original ... */
    console.log(`Generando embeddings para ${chunks.length} chunks (lotes de ${EMBEDDING_BATCH_SIZE})...`);
    const embeddingsData = [];
    let totalTokens = 0;
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const inputs = batchChunks.map(c => c.text.replace(/\n/g, ' '));
        try {
            console.log(`Procesando lote ${Math.floor(i/EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(chunks.length/EMBEDDING_BATCH_SIZE)}...`);
            const { data: embeddingResponseData, usage } = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs });
            if (usage) totalTokens += usage.total_tokens;
            if (!embeddingResponseData || embeddingResponseData.length !== batchChunks.length) { console.warn(`Respuesta inesperada para lote ${i}.`); continue; }
            batchChunks.forEach((chunk, idx) => { if (embeddingResponseData[idx]?.embedding) { embeddingsData.push({ ...chunk, embedding: embeddingResponseData[idx].embedding }); } else { console.warn(`No se pudo generar embedding para chunk ${i+idx}.`); } });
            if (i + EMBEDDING_BATCH_SIZE < chunks.length) { await new Promise(resolve => setTimeout(resolve, 500)); }
        } catch (error) { console.error(`Error generando embeddings para lote ${i}:`, error.message); }
    }
    console.log(`Embeddings generados para ${embeddingsData.length} chunks. Tokens totales usados: ${totalTokens}`);
    return embeddingsData;
}

async function storeChunks(userId, chunksWithEmbeddings) { /* ... código original, pero recibe userId ... */
     if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) { console.log("No hay chunks válidos con embeddings para almacenar."); return { data: null, error: null, count: 0 }; }
     console.log(`Almacenando ${chunksWithEmbeddings.length} chunks en Supabase para userId ${userId}...`);
     const recordsToInsert = chunksWithEmbeddings.map(c => ({
         client_id: userId, // *** Cambiado a userId ***
         content: c.text,
         embedding: c.embedding,
         metadata: c.metadata,
     }));
     try {
         const { data, error, count } = await supabase.from('knowledge_base').insert(recordsToInsert).select(); // Añadir select() para obtener count
         if (error) { console.error("Error al almacenar chunks:", error.message); if (error.details) console.error("Detalles:", error.details); if (error.hint) console.error("Sugerencia:", error.hint); return { data, error, count: 0 }; }
         const finalCount = count ?? recordsToInsert.length; // Usar count si está disponible, si no el total insertado
         console.log(`Almacenamiento completado. ${finalCount} chunks guardados/actualizados.`);
         return { data, error, count: finalCount };
     } catch (error) { console.error("Error inesperado en storeChunks:", error); return { data: null, error, count: 0 }; }
 }
// --- Función Principal Exportable ---
/**
 * Ejecuta el proceso completo de ingesta para una URL y un userId.
 * @param {string} userId - El ID del usuario/cliente (UUID).
 * @param {string} urlToIngest - La URL a procesar.
 * @returns {Promise<{success: boolean, message: string, chunksProcessed?: number}>} - Resultado de la operación.
 */
export const runIngestion = async (userId, urlToIngest) => {
    if (!userId || !urlToIngest || !urlToIngest.startsWith('http')) {
        console.error("runIngestion: userId o urlToIngest inválidos.");
        return { success: false, message: "ID de usuario o URL inválida." };
    }

    console.log(`\n--- Iniciando Ingesta (Servicio) para User ${userId} desde ${urlToIngest} ---`);
    let chunksProcessed = 0;

    try {
        // 1. Limpiar datos antiguos (Opcional pero recomendado)
        console.log(`(Ingest Service) Eliminando datos antiguos para userId: ${userId} y URL: ${urlToIngest}...`);
        const { error: deleteError } = await supabase
            .from('knowledge_base')
            .delete()
            .eq('client_id', userId)
            .eq('metadata->>url', urlToIngest); // Asumiendo que guardas la URL en metadata

        if (deleteError) {
             console.warn(`(Ingest Service) No se pudieron eliminar datos antiguos (puede que no existieran): ${deleteError.message}`);
             // No consideramos esto un error fatal necesariamente
        } else {
             console.log(`(Ingest Service) Datos antiguos eliminados (si existían).`);
        }


        // 2. Descargar HTML
        console.log("(Ingest Service) Descargando HTML...");
        const response = await axios.get(urlToIngest, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });
        const html = response.data;
        console.log(`(Ingest Service) HTML descargado (${(html.length / 1024).toFixed(1)} KB).`);

        // 3. Extraer y Dividir Contenido
        const chunks = chunkContent(html, urlToIngest);
        if (chunks.length === 0) {
            console.warn("(Ingest Service) No se generaron chunks válidos.");
            return { success: true, message: "URL procesada, pero no se extrajo contenido relevante.", chunksProcessed };
        }

        // 4. Generar Embeddings
        const chunksWithEmbeddings = await generateEmbeddings(chunks);
        if (chunksWithEmbeddings.length === 0) {
            console.warn("(Ingest Service) No se pudieron generar embeddings.");
             // Podríamos devolver error o éxito parcial
             return { success: false, message: "Se extrajo contenido, pero falló la generación de embeddings.", chunksProcessed };
        }

        // 5. Almacenar en Supabase
        const { error: storeError, count: storedCount } = await storeChunks(userId, chunksWithEmbeddings);
        if (storeError) {
             // Lanzar error para que el controlador lo capture
             throw new Error(`Error al guardar chunks en DB: ${storeError.message}`);
        }
        chunksProcessed = storedCount;

        console.log(`--- Ingesta (Servicio) Finalizada para ${urlToIngest}. Chunks procesados: ${chunksProcessed} ---`);
        return { success: true, message: `Ingesta completada. ${chunksProcessed} fragmentos procesados.`, chunksProcessed };

    } catch (error) {
        let errorMessage = "Error desconocido durante la ingesta.";
        if (axios.isAxiosError(error)) {
            errorMessage = `Error de red/HTTP al descargar ${urlToIngest}: ${error.message}`;
            if (error.response) { errorMessage += ` (Status: ${error.response.status})`; }
        } else {
            errorMessage = `Error general durante la ingesta de ${urlToIngest}: ${error.message}`;
        }
        console.error(`(Ingest Service) ${errorMessage}`);
        return { success: false, message: errorMessage, chunksProcessed };
    }
};