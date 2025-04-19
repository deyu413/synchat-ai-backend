// ------------------------- 1. INGESTA MEJORADA -------------------------
// ingestWebsite.js
import 'dotenv/config'; // Carga las variables de .env

// --- El resto de tus imports ---
import { CheerioCrawler } from 'crawlee';
import OpenAI from 'openai';
// ... etc ...

const openai = new OpenAI(process.env.OPENAI_API_KEY);

// Función optimizada para chunks semánticos
async function chunkContent(html, url) {
  const $ = cheerio.load(html);
  const sections = [];
  
  // Extracción estructurada con contexto jerárquico
  $('body').find('h1, h2, h3, h4, p, li').each((i, el) => {
    const tag = $(el).prop('tagName').toLowerCase();
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    
    if (tag.match(/^h[1-4]$/)) {
      sections.push({
        title: text,
        level: parseInt(tag[1]),
        content: [],
        url: `${url}#${$(el).attr('id') || ''}`
      });
    } else if (text.length > 50 && sections.length > 0) {
      const lastSection = sections[sections.length - 1];
      lastSection.content.push({
        text,
        html: $(el).html(),
        word_count: text.split(/\s+/).length
      });
    }
  });

  // División adaptativa con overlaping
  return sections.flatMap(section => {
    const chunks = [];
    let currentChunk = [];
    let wordCount = 0;
    
    for (const content of section.content) {
      if (wordCount + content.word_count > 300) {
        chunks.push({
          text: currentChunk.join(' '),
          metadata: {
            section: section.title,
            url: section.url,
            hierarchy: sections.slice(0, sections.indexOf(section)).map(s => s.title)
          }
        });
        currentChunk = [content.text];
        wordCount = content.word_count;
      } else {
        currentChunk.push(content.text);
        wordCount += content.word_count;
      }
    }
    return chunks;
  });
}

// Generación de embeddings con OpenAI
async function generateEmbeddings(chunks) {
  const embeddings = [];
  const BATCH_SIZE = 10; // Aprovechar batches de la API
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.text),
      encoding_format: "float"
    });
    
    batch.forEach((chunk, index) => {
      embeddings.push({
        ...chunk,
        embedding: response.data[index].embedding
      });
    });
  }
  
  return embeddings;
}

// ------------------------- 2. ALMACENAMIENTO VECTORIAL -------------------------
// databaseService.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Función optimizada para Supabase
async function storeChunks(clientId, chunks) {
  const { data, error } = await supabase
    .from('knowledge_base')
    .insert(chunks.map(c => ({
      client_id: clientId,
      content: c.text,
      embedding: c.embedding,
      metadata: c.metadata
    })));

  if (error) throw new Error(`Error almacenando chunks: ${error.message}`);
  return data;
}

// ------------------------- 3. BÚSQUEDA HÍBRIDA MEJORADA -------------------------
// searchService.js
const SIMILARITY_THRESHOLD = 0.82; // Optimizado para text-embedding-3-small

async function hybridSearch(clientId, query) {
  // Generar embedding de la pregunta
  const { data: [embedding] } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
    encoding_format: "float"
  });

  // Búsqueda vectorial
  const vectorResults = await supabase.rpc('vector_search', {
    client_id: clientId,
    query_embedding: embedding.embedding,
    similarity_threshold: SIMILARITY_THRESHOLD,
    match_count: 5
  });

  // Búsqueda full-text
  const fulltextResults = await supabase
    .from('knowledge_base')
    .select()
    .textSearch('content', query, {
      type: 'websearch',
      config: 'spanish'
    })
    .eq('client_id', clientId);

  // Combinar y ordenar resultados
  return [...vectorResults.data, ...fulltextResults.data]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

// ------------------------- 4. GENERACIÓN CON GPT -------------------------
// chatController.js
async function generateResponse(context, question) {
  const contextString = context.map(c => 
    `[Fuente: ${c.metadata.hierarchy.join(' > ')}]\n${c.content}`
  ).join('\n\n');

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [{
      role: "system",
      content: `Eres Zoe, asistente experto. Base tu respuesta en:
${contextString}

Reglas:
1. Respuestas precisas y citando fuentes
2. Si la información es insuficiente, pregunta para clarificar
3. Usar markdown para formatos
4. Máximo 3 párrafos`
    }, {
      role: "user",
      content: question
    }],
    temperature: 0.2,
    max_tokens: 500
  });

  return response.choices[0].message.content;
}

