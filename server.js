// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js';

const app = express();
const PORT = process.env.PORT || 3001;

// 1. Configuración mejorada de orígenes con regex
const allowedOrigins = [
    /^https?:\/\/(.*\.)?synchatai\.com$/, // Todos los subdominios
    /^https?:\/\/synchat-ai-backend\.vercel\.app$/, // Dominio de Vercel
    process.env.NODE_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/ // Localhost en desarrollo
];

// 2. Opciones CORS optimizadas
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // Permitir herramientas sin origen (Postman)
        
        const isAllowed = allowedOrigins.some(pattern => 
            typeof pattern === 'string' 
                ? origin === pattern 
                : pattern.test(origin)
        );
        
        isAllowed 
            ? callback(null, true)
            : callback(new Error(`Origen bloqueado por CORS: ${origin}`));
    },
    methods: ['GET', 'POST', 'OPTIONS'], // Solo métodos necesarios
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With',
        'X-API-Key' // Añadir cabeceras personalizadas
    ],
    credentials: true,
    optionsSuccessStatus: 200 // Específicamente para Safari
};

// 3. Manejo explícito de OPTIONS
app.options('*', cors(corsOptions)); // Manejar todas las preflight requests

// 4. Orden CRÍTICO de middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions)); // Aplicar CORS después de body parsers

// 5. Middleware de logging mejorado
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [CORS: ${req.headers.origin}]`);
    next();
});

// 6. Configuración específica de rutas API
app.use('/api/chat', cors(corsOptions), apiRoutes); // Aplicar CORS solo a estas rutas

// 7. Endpoint raíz con validación CORS
app.get('/', cors(corsOptions), (req, res) => {
    res.status(200).send('¡Backend operativo!');
});

// 8. Manejo de errores mejorado
app.use((err, req, res, next) => {
    if (err.message.startsWith('Origen bloqueado')) {
        console.warn(`Violación CORS: ${err.message}`);
        return res.status(403).json({ 
            error: 'Acceso no autorizado',
            allowedOrigins: allowedOrigins.map(p => p.toString())
        });
    }
    // ... resto del manejo de errores
});

// Resto del código sin cambios...