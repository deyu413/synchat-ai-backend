// src/services/embeddingService.js
import 'dotenv/config';
import OpenAI from 'openai';

// Inicializar cliente OpenAI
if (!process.env.OPENAI_API_KEY) {
    console.error("FATAL ERROR: OPENAI_API_KEY is missing in .env");
    process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
console.log("LOG: OpenAI client initialized in embeddingService.");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EXPECTED_DIMENSION = 1536;

/**
 * Genera embedding para UN texto con reintentos.
 * @param {string} text - Texto a embedir.
 * @param {number} [retries=3] - Reintentos.
 * @returns {Promise<Array<number>|null>} Embedding o null.
 */
export async function getEmbeddingWithRetry(text, retries = 3) {
    if (!text || typeof text !== 'string') {
        console.warn("WARN (Embedding): Invalid text provided:", text);
        return null;
    }
    const inputText = text.replace(/\n/g, ' ').trim();
    if (inputText.length === 0) {
         console.warn("WARN (Embedding): Empty text after cleaning.");
         return null;
    }

    let delay = 1000;
    console.log(`LOG (Embedding): Getting embedding for: "${inputText.substring(0, 50)}..."`);
    for (let i = 0; i < retries; i++) {
        try {
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: inputText,
                encoding_format: "float"
            });
            const embedding = response.data?.[0]?.embedding;
            if (embedding) {
                if(embedding.length !== EXPECTED_DIMENSION) {
                     console.warn(`WARN (Embedding): Unexpected dimension (${embedding.length} vs ${EXPECTED_DIMENSION})`);
                }
                console.log("LOG (Embedding): Success.");
                return embedding;
            } else {
                throw new Error("Invalid response structure from OpenAI Embeddings API");
            }
        } catch (error) {
            const status = error?.status;
            if (status === 429 && i < retries - 1) {
                console.warn(`WARN (Embedding): Rate limit (429). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                console.error(`ERROR (Embedding) after ${i + 1} attempts:`, error.message || error);
                return null; // Falló definitivamente
            }
        }
    }
    console.error(`ERROR (Embedding): Failed to get embedding after ${retries} retries.`);
    return null;
}

/**
 * Genera embeddings para un LOTE de textos.
 * @param {Array<string>} texts - Array de textos.
 * @returns {Promise<Array<Array<number>|null>>} Array de embeddings (o null si falló).
 */
export async function getEmbeddingsInBatch(texts) {
    const BATCH_SIZE = 50;
    console.log(`LOG (Embedding): Getting batch embeddings for ${texts?.length ?? 0} texts...`);
     if (!texts || texts.length === 0) return [];

     const allEmbeddings = [];

     for (let i = 0; i < texts.length; i+= BATCH_SIZE) {
        const batchTexts = texts.slice(i, i + BATCH_SIZE);
        const cleanedBatchTexts = batchTexts.map(t => (t || '').replace(/\n/g, ' ').trim());
        const validTextsIndices = cleanedBatchTexts.map((t, idx) => t.length > 0 ? idx : -1).filter(idx => idx !== -1);
        const validTextsToSend = cleanedBatchTexts.filter(t => t.length > 0);

        if (validTextsToSend.length === 0) {
            console.log(`LOG (Embedding): Batch ${Math.floor(i/BATCH_SIZE)+1} has only empty texts, skipping.`);
             allEmbeddings.push(...Array(batchTexts.length).fill(null));
             continue;
        }

        console.log(`LOG (Embedding): Processing batch ${Math.floor(i/BATCH_SIZE)+1} (${validTextsToSend.length} valid texts)`);
        let attempt = 0;
        const MAX_RETRIES = 3;
        let delay = 1000;
        let batchResult = null;

        while (attempt < MAX_RETRIES && !batchResult) {
            try {
                const response = await openai.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: validTextsToSend,
                    encoding_format: "float"
                });

                if (response.data && response.data.length === validTextsToSend.length) {
                     batchResult = response.data.map(item => item.embedding);
                    console.log(`LOG (Embedding): Batch ${Math.floor(i/BATCH_SIZE)+1} successful on attempt ${attempt + 1}.`);
                } else {
                    console.error(`ERROR (Embedding): Mismatch in OpenAI batch response for batch ${Math.floor(i/BATCH_SIZE)+1}.`);
                    break;
                }
            } catch(error) {
                const status = error?.status;
                 if (status === 429 && attempt < MAX_RETRIES - 1) {
                    console.warn(`WARN (Embedding): Rate limit (429) on batch ${Math.floor(i/BATCH_SIZE)+1}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    console.error(`ERROR FATAL (Embedding) processing batch ${Math.floor(i/BATCH_SIZE)+1} after ${attempt + 1} attempts:`, error.message);
                    break;
                }
            }
            attempt++;
        }

         const finalBatchEmbeddings = Array(batchTexts.length).fill(null);
         if (batchResult) {
             let resultIndex = 0;
             validTextsIndices.forEach(originalIndex => {
                 if (batchResult[resultIndex]) {
                      finalBatchEmbeddings[originalIndex] = batchResult[resultIndex];
                 }
                 resultIndex++;
             });
         }
         allEmbeddings.push(...finalBatchEmbeddings);

        if (i + BATCH_SIZE < texts.length) {
           await new Promise(resolve => setTimeout(resolve, 200));
        }
     }

     console.log(`LOG (Embedding): Finished batch embeddings. Got ${allEmbeddings.filter(e => e !== null).length} successful embeddings out of ${texts.length}.`);
     return allEmbeddings;
}