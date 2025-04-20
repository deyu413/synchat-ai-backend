// server.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js';

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---

// Lista de orígenes permitidos
const allowedOrigins = [
    'https://www.synchatai.com',    // Tu dominio de producción
    'https://synchatai.com',        // Tu dominio sin www (si aplica)
    'http://localhost:3000',       // TU ORIGEN LOCAL (¡AJUSTA EL PUERTO SI ES DIFERENTE!)
    'http://localhost:5173',       // Ejemplo con puerto 5173 de Vite (¡AJUSTA!)
    // Añade más orígenes si los necesitas
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permite solicitudes sin 'origin' (como Postman, curl) o si el origen está en la lista blanca
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            console.log(`CORS: Origen permitido -> ${origin || 'Sin origen (permitido)'}`);
            callback(null, true);
        } else {
            console.warn(`CORS: Origen bloqueado -> ${origin}`); // Ayuda a depurar
            callback(new Error('Origen no permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Métodos HTTP permitidos
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], // Cabeceras personalizadas permitidas
    credentials: true // Permite enviar cookies o tokens de autorización si los usas
};

// Aplicar el middleware CORS con las opciones configuradas
app.use(cors(corsOptions));

// Asegúrate que express.json() y otros middlewares vengan DESPUÉS de cors
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging (ya lo tenías)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --- Rutas ---
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI funcionando correctamente! (v_esm)');
});

console.log('>>> server.js: Montando rutas /api/chat...');
app.use('/api/chat', apiRoutes); // Montar las rutas de la API
console.log('>>> server.js: Rutas /api/chat montadas.');

// --- Manejo de Errores ---
// ... (tu manejo de errores 404 y 500 va aquí) ...
app.use((req, res, next) => {
    console.log(`>>> server.js: Ruta no encontrada (404) para ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    // Si el error viene de la validación CORS
    if (err.message === 'Origen no permitido por CORS') {
         res.status(403).json({ error: 'Acceso CORS denegado para este origen.' });
    } else {
        // Otro tipo de error
        console.error("Error global no manejado:", err.stack || err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// --- Exportar app para Vercel ---
export default app;

// --- Inicio local (opcional) ---
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
     app.listen(PORT, () => {
        console.log(`Servidor escuchando LOCALMENTE en el puerto ${PORT}`);
     });
}