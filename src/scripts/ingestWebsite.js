// src/scripts/ingestWebsite.js
require('dotenv').config(); // Carga .env desde la raíz del proyecto

const axios = require('axios');
const cheerio = require('cheerio');
// Asegúrate de que las rutas a los servicios sean correctas desde aquí
const embeddingService = require('../services/embeddingService');
const databaseService = require('../services/databaseService');

// --- Configuración de Chunking ---
// Puedes experimentar con estos valores
const MIN_CHUNK_LENGTH = 50;  // Mínimo de caracteres para guardar un chunk
const MAX_CHUNK_LENGTH = 500; // Máximo aproximado antes de dividir (en caracteres)
// const CHUNK_SIZE_WORDS = 200; // Alternativa: Tamaño en palabras
// const CHUNK_OVERLAP_WORDS = 30; // Alternativa: Solapamiento en palabras

/**
 * Divide texto basado en elementos estructurales y longitud máxima.
 * Intenta mantener párrafos/items juntos si caben.
 * @param {CheerioAPI} $ - El objeto Cheerio cargado con el área de contenido.
 * @param {Cheerio<Element>} elements - Los elementos a procesar (p, li, h1-h4).
 * @param {number} maxChunkLength - Longitud máxima del chunk en caracteres.
 * @returns {Array<string>} - Array de chunks de texto.
 */
function chunkTextByStructure($, elements, maxChunkLength) {
    const chunks = [];
    let currentChunk = "";

    elements.each((index, element) => {
        // Usar $(element).text() en lugar de recargar con cheerio.load
        let elementText = $(element).text().replace(/\s\s+/g, ' ').trim();

        if (elementText.length === 0) return; // Saltar elementos vacíos

        // Si añadir este elemento supera el límite, guardar el chunk actual (si es válido)
        if (currentChunk.length > 0 && (currentChunk.length + elementText.length + 1) > maxChunkLength) {
            if (currentChunk.length >= MIN_CHUNK_LENGTH) {
                chunks.push(currentChunk);
            }
            currentChunk = elementText; // Empezar nuevo chunk con el elemento actual
        } else {
            // Añadir al chunk actual
            currentChunk += (currentChunk.length > 0 ? "\n" : "") + elementText;
        }

        // Manejar caso de elementos individuales muy largos
        while (currentChunk.length > maxChunkLength) {
             let splitPoint = currentChunk.lastIndexOf('.', maxChunkLength);
             splitPoint = splitPoint > MIN_CHUNK_LENGTH ? splitPoint + 1 : maxChunkLength; // Punto o corte forzado

             const part = currentChunk.substring(0, splitPoint);
             if (part.length >= MIN_CHUNK_LENGTH) { // Guardar solo si es suficientemente largo
                chunks.push(part);
             }
             currentChunk = currentChunk.substring(splitPoint).trim();
        }
    });

    // Añadir el último chunk si es válido
    if (currentChunk.length >= MIN_CHUNK_LENGTH) {
        chunks.push(currentChunk);
    }
    console.log(`(Chunker) Generados ${chunks.length} chunks finales.`);
    return chunks;
}

/**
 * Procesa una URL para un cliente: descarga, extrae, divide, embebe y guarda.
 * @param {string} clientId - El UUID del cliente.
 * @param {string} url - La URL a procesar.
 */
const ingestUrl = async (clientId, url) => {
    console.log(`\n--- Iniciando ingesta MEJORADA para Cliente ${clientId} desde ${url} ---`);
    try {
        // 1. Descargar HTML
        console.log("Descargando HTML...");
        const response = await axios.get(url, {
             headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SynChatBot/1.0; +https://www.tudominio-synchatai.com/bot)' } // User agent personalizado
        });
        const html = response.data;
        console.log("HTML descargado.");

        // 2. Cargar HTML y Eliminar Ruido
        const $ = cheerio.load(html);
        console.log("Eliminando ruido (scripts, styles, nav, footer, etc.)...");
        $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], #hubspot-messages-iframe-container, .cookie-consent-banner, #cookie-banner, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons').remove(); // Más selectores de ruido comunes

        // 3. Identificar Área de Contenido Principal
        let $contentArea = $('main').first();
        if ($contentArea.length === 0) $contentArea = $('article').first();
        if ($contentArea.length === 0) $contentArea = $('#content').first(); // Probar ID común
        if ($contentArea.length === 0) $contentArea = $('.content').first(); // Probar clase común
        if ($contentArea.length === 0) {
            $contentArea = $('body');
            console.warn("Advertencia: No se encontró <main>, <article>, #content o .content. Procesando <body> completo.");
        } else {
             console.log(`(Extractor) Usando <${$contentArea[0].tagName}${($contentArea.attr('id') ? `#${$contentArea.attr('id')}` : '')}${($contentArea.attr('class') ? `.${$contentArea.attr('class').split(' ')[0]}` : '')}> como área de contenido.`);
        }

        // 4. Seleccionar Elementos de Texto Relevantes
        // Priorizar párrafos, listas, títulos. Excluir elementos vacíos o muy cortos implícitamente.
        // Podríamos añadir 'div' pero sería muy ruidoso, mejor ser específicos.
        // Excluir elementos dentro de nav/footer que pudieran haber quedado
        const textElements = $contentArea.find('p, li, h1, h2, h3, h4, h5, h6, td, th, pre').filter((i, el) => {
             // Filtrar elementos que están dentro de estructuras que probablemente no son contenido principal
             // Esto es heurístico y puede necesitar ajustes
             return $(el).parents('nav, footer, header, aside, form').length === 0 && $(el).text().trim().length > 10; // Mínimo 10 chars
        });
        console.log(`(Extractor) Se encontraron ${textElements.length} elementos de texto potenciales en el área de contenido.`);

        // 5. Dividir en Chunks
        console.log(`Dividiendo en chunks (máx ~${MAX_CHUNK_LENGTH} chars)...`);
        const textChunks = chunkTextByStructure($, textElements, MAX_CHUNK_LENGTH);

        if (textChunks.length === 0) {
            console.error("Error: No se generaron chunks de texto válidos. Verifica la extracción o la estructura de la página.");
            return;
        }
        // Opcional: Loguear los chunks para depuración
        // console.log("(Chunker) Chunks generados:", textChunks);

        // 6. Generar Embeddings y Guardar
        console.log("Generando embeddings y guardando en DB...");
        let successCount = 0;
        const batchSize = 5; // Procesar en pequeños lotes para no sobrecargar
        for (let i = 0; i < textChunks.length; i += batchSize) {
            const batch = textChunks.slice(i, i + batchSize);
            console.log(`Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(textChunks.length/batchSize)} (chunks ${i+1} a ${Math.min(i+batchSize, textChunks.length)})...`);

            const embeddingPromises = batch.map(chunk => embeddingService.getEmbedding(chunk));
            const embeddings = await Promise.all(embeddingPromises);

            const savePromises = [];
            for (let j = 0; j < batch.length; j++) {
                if (embeddings[j]) { // Solo guardar si el embedding se generó
                    savePromises.push(
                        databaseService.saveKnowledgeChunk(clientId, batch[j], embeddings[j], url)
                    );
                    successCount++;
                } else {
                    console.warn(`No se pudo generar embedding para el chunk ${i + j + 1}. Saltando guardado.`);
                }
            }
            // Esperar a que se guarden los chunks del lote actual
            await Promise.all(savePromises);

             // Pausa entre lotes para evitar rate limits
             if (i + batchSize < textChunks.length) {
                 console.log(`Pausa de 1 segundo entre lotes...`);
                 await new Promise(resolve => setTimeout(resolve, 1000)); // 1 segundo
             }
        }
        console.log(`--- Ingesta completada para ${url}. Guardados ${successCount}/${textChunks.length} chunks. ---`);

    } catch (error) {
         if (axios.isAxiosError(error)) { console.error(`Error de red/HTTP: ${error.message}`); }
         else { console.error(`Error general durante la ingesta:`, error); }
    }
};

// --- Ejecución del Script ---
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Uso: node src/scripts/ingestWebsite.js <clientId> <url>");
    process.exit(1);
}
const clientId = args[0];
const urlToIngest = args[1];
if (!clientId || !urlToIngest || !urlToIngest.startsWith('http')) {
     console.error("Por favor, proporciona un clientId válido y una URL completa (ej: https://...)");
     process.exit(1);
}

// Validar que los servicios se cargaron bien (simplificado)
if(typeof databaseService.saveKnowledgeChunk !== 'function' || typeof embeddingService.getEmbedding !== 'function'){
    console.error("Error: Los servicios de base de datos o embedding no se cargaron correctamente.");
    process.exit(1);
}

ingestUrl(clientId, urlToIngest);
// -------------------------