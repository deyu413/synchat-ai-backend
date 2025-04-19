// src/config/supabaseClient.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL) {
    console.error("FATAL ERROR: SUPABASE_URL is missing in .env");
    process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
    console.error("FATAL ERROR: SUPABASE_KEY is missing in .env (Use Service Role Key for backend operations)");
    process.exit(1);
}

// Usar Service Role Key para operaciones de backend como ingesta/búsqueda que pueden necesitar saltarse RLS
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

console.log("LOG: Supabase client initialized.");

export default supabase;