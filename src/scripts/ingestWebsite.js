import 'dotenv/config'; // Carga las variables de .env PRIMERO!

// --- Log Inicial ---
console.log('--- SCRIPT INICIADO ---');
console.log('Verificando variables de entorno...');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Encontrada' : '¡FALTA!');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Encontrada' : '¡FALTA!');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Encontrada' : '¡FALTA!');
// --- Fin Log Inicial ---

// Importaciones necesarias (Asegúrate de tener axios y cheerio instalados: npm install axios cheerio)
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios'; // Usaremos axios para simplificar (en lugar de crawlee por ahora)
import cheerio from 'cheerio'; // Necesitamos cheerio

// --- Inicialización de Clientes ---
// (Asegúrate de que las variables de entorno están cargadas antes de estas líneas)
let openai;
let supabase;

try {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY falta en .env');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Usa la key directamente aquí

    if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL falta en .env');
    if (!process.env.SUPABASE_KEY) throw new Error('SUPABASE_KEY falta en .env');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    console.log("LOG: Clientes OpenAI y Supabase inicializados.");
} catch (initError) {
    console.error("ERROR FATAL al inicializar clientes:", initError.message);
    process.exit(1); // Salir si las claves/url faltan
}


// --- Función chunkContent (La que tenías definida) ---
async function chunkContent(html, url) {
    console.log("LOG: Iniciando chunkContent...");
    const $ = cheerio.load(html);
    const sections = [];

    // Limpieza básica (puedes añadir más selectores si es necesario)
    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg').remove();
    
    // Extracción estructurada con contexto jerárquico
    // Ajuste: buscar dentro de 'main' o 'body' para más precisión
    let contentArea = $('main').length ? $('main') : $('body'); 
    contentArea.find('h1, h2, h3, h4, p, li').each((i, el) => { // Incluimos h1-h4 aquí
      const tag = $(el).prop('tagName').toLowerCase();
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      
      if (tag.match(/^h[1-4]$/)) {
          console.log(`LOG> Nueva sección encontrada: ${text} (Nivel ${tag[1]})`);
          sections.push({
              title: text,
              level: parseInt(tag[1]),
              content: [], // Array para guardar el texto de esta sección
              url: `${url}#${$(el).attr('id') || ''}`
          });
      } else if (text.length > 50 ) { // Umbral de longitud mínimo para texto relevante
            if (sections.length > 0) { // Asegurarse de que hay una sección donde añadir
                const lastSection = sections[sections.length - 1];
                lastSection.content.push({
                    text,
                    // html: $(el).html(), // HTML puede ser muy grande, quitarlo por ahora
                    word_count: text.split(/\s+/).length
                });
            } else {
                // Texto encontrado antes de la primera sección h1-h4, añadir a una sección inicial
                if (sections.length === 0) {
                     sections.push({ title: 'Introducción', level: 0, content: [], url: url});
                }
                 sections[0].content.push({
                    text,
                    word_count: text.split(/\s+/).length
                 });
            }
      }
    });
    console.log(`LOG: Se encontraron ${sections.length} secciones potenciales.`);

    // División adaptativa basada en palabras (~300 palabras por chunk)
    return sections.flatMap(section => {
        const chunks = [];
        let currentChunkTexts = []; // Almacena los textos del chunk actual
        let wordCount = 0;
        const MAX_WORDS = 300; // Límite de palabras por chunk
        
        for (const contentItem of section.content) {
            const contentText = contentItem.text;
            const contentWordCount = contentItem.word_count;

            if (wordCount + contentWordCount > MAX_WORDS && currentChunkTexts.length > 0) {
                // Si añadir este texto supera el límite Y ya tenemos algo en el chunk actual, guardamos el actual
                const chunkText = currentChunkTexts.join(' ');
                chunks.push({
                    text: chunkText.trim(),
                    metadata: {
                        section: section.title,
                        url: section.url,
                        // Calcular jerarquía al momento de crear el chunk
                        hierarchy: sections
                            .filter(s => s.level < section.level) // Solo ancestros
                            .map(s => s.title)
                            .concat(section.title) // Añadir título actual
                    }
                });
                console.log(`LOG >> Chunk creado (Límite palabras). Sección: ${section.title}. Words: ${chunkText.split(/\s+/).length}`);
                // Empezar nuevo chunk con el texto actual
                currentChunkTexts = [contentText];
                wordCount = contentWordCount;
            } else {
                // Añadir texto al chunk actual
                currentChunkTexts.push(contentText);
                wordCount += contentWordCount;
            }
        }
        
        // Guardar el último chunk de la sección si contiene algo
        if (currentChunkTexts.length > 0) {
             const chunkText = currentChunkTexts.join(' ');
             chunks.push({
                 text: chunkText.trim(),
                 metadata: {
                     section: section.title,
                     url: section.url,
                     hierarchy: sections
                        .filter(s => s.level < section.level)
                        .map(s => s.title)
                        .concat(section.title)
                 }
             });
             console.log(`LOG >> Chunk creado (Fin sección). Sección: ${section.title}. Words: ${chunkText.split(/\s+/).length}`);
        }
        return chunks; // Devuelve los chunks de esta sección
    }); // Fin flatMap
} // Fin chunkContent

// --- Función generateEmbeddings (La que tenías) ---
async function generateEmbeddings(chunks) {
    console.log(`LOG: Iniciando generateEmbeddings para ${chunks?.length ?? 0} chunks.`);
    if (!chunks || chunks.length === 0) return []; // Devolver array vacío si no hay chunks

    const embeddings = [];
    const BATCH_SIZE = 10; // Usar un tamaño de lote razonable
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const inputTexts = batch.map(c => c.text.replace(/\n/g, ' ')); // OpenAI recomienda reemplazar saltos de línea
        
        console.log(`LOG: Enviando lote ${Math.floor(i/BATCH_SIZE) + 1} a OpenAI Embeddings (${inputTexts.length} textos)...`);
        try {
            const response = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: inputTexts,
                encoding_format: "float" // Asegurarse de que devuelve floats
            });
            
            // Añadir el embedding a cada chunk del lote
            batch.forEach((chunk, index) => {
                if (response.data && response.data[index]) {
                    embeddings.push({
                        ...chunk, // Mantener texto y metadatos
                        embedding: response.data[index].embedding // Añadir el vector
                    });
                } else {
                     console.warn(`WARN: No se recibió embedding para el chunk ${i + index}. Texto: ${chunk.text.substring(0,50)}...`);
                }
            });
            console.log(`LOG: Lote ${Math.floor(i/BATCH_SIZE) + 1} procesado.`);
        } catch(embeddingError) {
             console.error(`ERROR FATAL en llamada a OpenAI Embeddings para lote ${Math.floor(i/BATCH_SIZE) + 1}:`, embeddingError.message);
             // Podríamos decidir si continuar con los demás lotes o parar todo
             // Por ahora, paramos si un lote falla gravemente:
             throw embeddingError; 
        }
         // Añadir una pequeña pausa para evitar rate limits muy agresivos
        if (i + BATCH_SIZE < chunks.length) {
           await new Promise(resolve => setTimeout(resolve, 200)); // Pausa de 200ms
        }
    }
    
    console.log(`LOG: Embeddings generados para ${embeddings.length} chunks.`);
    return embeddings; // Devuelve los chunks originales + la propiedad embedding
} // Fin generateEmbeddings


// --- Función storeChunks (La que tenías, adaptada) ---
async function storeChunks(clientId, chunksWithEmbeddings) {
     console.log(`LOG: Iniciando storeChunks para ${clientId}. Recibidos ${chunksWithEmbeddings?.length ?? 0} chunks con embeddings.`);
     if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
         console.warn("WARN: No hay chunks con embeddings para guardar.");
         return null;
     }

    // Mapear al formato esperado por la tabla 'knowledge_base'
    const dataToInsert = chunksWithEmbeddings.map(c => ({
        client_id: clientId,
        content: c.text,
        embedding: c.embedding, // Ya debería ser el vector de floats
        metadata: c.metadata // El objeto con section, url, hierarchy
    }));

    // --- Log ANTES de guardar ---
    console.log(`--- ANTES DE GUARDAR EN DB (${dataToInsert.length} registros) ---`);
    // console.log("DEBUG: Primer registro a insertar:", JSON.stringify(dataToInsert[0], null, 2)); // Descomenta para ver el primer objeto completo

    try {
        const { data, error } = await supabase
            .from('knowledge_base') // Nombre correcto de la tabla
            .insert(dataToInsert); // Insertar los datos mapeados

        // --- Log DESPUÉS de intentar guardar ---
        console.log('--- DESPUÉS DE INTENTAR GUARDAR ---'); 

        if (error) {
            // Si Supabase devuelve un error estructurado, lo lanzamos
            console.error("ERROR DETECTADO AL GUARDAR (desde Supabase):", error);
            throw new Error(`Error almacenando chunks: ${error.message}`);
        } else {
            // Si no hay error, Supabase devuelve los datos insertados (o un array vacío a veces?)
            console.log("LOG: Guardado en Supabase aparentemente exitoso.");
            // console.log("LOG: Datos devueltos por Supabase (parcial):", data ? data.length : 'null/undefined'); // Ver cuántos registros devolvió
            return data; // Devolver los datos (o lo que devuelva Supabase en éxito)
        }
    } catch (catchError) {
        // Capturar cualquier otro error que pueda ocurrir (ej, de red)
         console.error("ERROR FATAL durante la operación de guardado en Supabase:", catchError);
         throw catchError; // Re-lanzar para que la ejecución principal falle
    }
} // Fin storeChunks


// --- Lógica Principal de Ejecución ---
async function runIngestion(clientId, url) {
    console.log(`LOG: Iniciando ingesta para Cliente ${clientId} desde ${url}`);
    try {
        // 1. Descargar HTML
        console.log("LOG: Descargando HTML...");
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'SynChatAI-IngestionBot/1.0' } // Añadir User-Agent
        }); 
        const html = response.data;
        console.log("LOG: HTML descargado con éxito.");

        // 2. Extraer y Dividir Contenido
        const chunksRaw = await chunkContent(html, url);
        console.log(`LOG: chunkContent finalizó, ${chunksRaw?.length ?? 0} chunks generados.`);

        if (!chunksRaw || chunksRaw.length === 0) {
            console.warn("WARN: No se generaron chunks válidos desde chunkContent. Proceso detenido.");
            return;
        }

        // 3. Generar Embeddings
        const chunksWithEmbeddings = await generateEmbeddings(chunksRaw);
        console.log(`LOG: generateEmbeddings finalizó, ${chunksWithEmbeddings?.length ?? 0} chunks con embedding.`);
        
        if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
            console.warn("WARN: No se generaron embeddings válidos. Proceso detenido.");
            return;
        }

        // 4. Almacenar en Supabase
        await storeChunks(clientId, chunksWithEmbeddings);
        console.log("LOG: storeChunks finalizó.");

    } catch (error) {
        console.error(`ERROR FATAL en el proceso de ingesta para ${url}:`, error.message);
        // Considera loguear el stack trace si es necesario: console.error(error);
    } finally {
        console.log('--- SCRIPT DE INGESTA FINALIZADO ---');
    }
}

// --- Obtener argumentos y ejecutar ---
const clientId = process.argv[2];
const urlToIngest = process.argv[3];

if (!clientId || !urlToIngest || !urlToIngest.startsWith('http')) {
    console.error("Error: Falta Client ID o URL válida.");
    console.error("Uso: node src/scripts/ingestWebsite.js <clientId> <urlCompleta>");
    process.exit(1);
}

// Llamar a la función principal
runIngestion(clientId, urlToIngest);