// server.js (Actualizado a ES Modules)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path'; // Necesario si usas __dirname equivalente o express.static
import { fileURLToPath } from 'url'; // Necesario para __dirname en ES Modules

// Importar Rutas
import apiChatRoutes from './src/routes/api.js'; // Rutas de chat existentes
import apiConfigRoutes from './src/routes/configRoutes.js'; // Nuevas rutas de config

// Equivalente a __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---

// Configurar CORS (ACTUALIZADO)
const allowedOrigins = [
    process.env.FRONTEND_URL || 'https://www.synchatai.com', // URL Principal (si aplica)
    process.env.HOSTINGER_DOMAIN || 'https://www.synchatai.com/', // *** ¡¡PON TU DOMINIO REAL DE HOSTINGER AQUÍ!! ***
    'http://localhost:5173', // Puerto por defecto de Vite para desarrollo local
    'http://127.0.0.1:5173' // Otra forma de acceder a localhost
];

app.use(cors({
    origin: function (origin, callback) {
        console.log(`(CORS) Petición desde origen: ${origin}`);
        // Permite peticiones sin 'origin' (ej: Postman) o si está en la lista
        if (!origin || allowedOrigins.includes(origin)) {
            console.log("(CORS) Origen permitido.");
            callback(null, true);
        } else {
            console.warn("(CORS) Origen NO permitido:", origin);
            callback(new Error(`Origen ${origin} no permitido por CORS`));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] // Asegúrate de permitir X-API-Key y Authorization
}));

// Middlewares esenciales de Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --- Rutas ---
// Ya no necesitamos la ruta GET / si servimos un frontend
// app.get('/', (req, res) => { ... });

// Montaje de rutas API
console.log('>>> server.js: Montando rutas /api/chat');
app.use('/api/chat', apiChatRoutes); // Rutas para el widget (usan API Key)
console.log('>>> server.js: Rutas /api/chat montadas');

console.log('>>> server.js: Montando rutas /api/config');
app.use('/api/config', apiConfigRoutes); // Rutas para el dashboard (usan JWT)
console.log('>>> server.js: Rutas /api/config montadas');


// --- Manejo de Errores (Al final) ---
// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
    console.log(`>>> server.js: MANEJADOR 404 para ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta API no encontrada' }); // Mensaje más específico
});

// Middleware para manejo de errores global
app.use((err, req, res, next) => { /* ...código igual... */
    console.error("Error global no manejado:", err.stack || err);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
         error: err.message || 'Error interno del servidor',
         ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => { /* ...código igual... */
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.OPENAI_API_KEY) { console.warn("ADVERTENCIA: Faltan variables de entorno de Supabase/OpenAI."); }
    if (!process.env.FRONTEND_URL && !process.env.HOSTINGER_DOMAIN) { console.warn("ADVERTENCIA: URLs de frontend para CORS no definidas en .env."); }
});