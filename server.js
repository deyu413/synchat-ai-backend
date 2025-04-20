// server.js
import 'dotenv/config'; // Cargar variables de .env al inicio
import express from 'express'; // ¡Asegúrate de que esta importación esté!
import cors from 'cors';
import apiRoutes from './src/routes/api.js'; // Verifica que la ruta a api.js sea correcta

// Crear la instancia de la aplicación Express (¡Esta línea es crucial!)
const app = express();
const PORT = process.env.PORT || 3001;

// --- Configuración CORS ---
// Lista de orígenes permitidos usando Regex
const allowedOrigins = [
    /^https?:\/\/(.*\.)?synchatai\.com$/, // synchatai.com y subdominios (http/https)
    /^https?:\/\/synchat-ai-backend\.vercel\.app$/, // El propio dominio de Vercel
    process.env.NODE_ENV === 'development' ? /^http:\/\/localhost(:\d+)?$/ : null // localhost con cualquier puerto en desarrollo
].filter(Boolean); // Elimina el null si no estamos en desarrollo

// Opciones detalladas para el middleware CORS
const corsOptions = {
    origin: (origin, callback) => {
        // Permite solicitudes sin 'origin' (como Postman, curl) o si el origen coincide con los patrones
        if (!origin || allowedOrigins.some(pattern => pattern.test(origin))) {
            console.log(`CORS Permitido: Origen -> ${origin || 'N/A'}`); // Log si se permite
            callback(null, true);
        } else {
            console.warn(`CORS Bloqueado: Origen -> ${origin}`); // Log si se bloquea
            callback(new Error('Origen no permitido por CORS')); // Error si no coincide
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'], // Métodos necesarios (IMPORTANTE: incluir OPTIONS)
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'], // Cabeceras permitidas (Añade las que uses)
    credentials: true, // Permite cookies/autorización si es necesario
    optionsSuccessStatus: 200 // Devuelve 200 en OPTIONS preflight (bueno para compatibilidad)
};

// --- Middlewares ---

// 1. Manejar TODAS las peticiones OPTIONS (preflight) PRIMERO usando las opciones CORS
app.options('*', cors(corsOptions));

// 2. Aplicar CORS globalmente a TODAS las demás peticiones ANTES de los parsers y rutas
app.use(cors(corsOptions));

// 3. Body Parsers DESPUÉS de CORS global
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Logging (opcional pero útil)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [Origin: ${req.headers.origin || 'N/A'}]`);
    next();
});

// --- Rutas ---
// Ya no es necesario aplicar cors() aquí individualmente
app.get('/', (req, res) => {
    res.status(200).send('¡Backend operativo!');
});

// Montar las rutas de la API (ya protegidas por el CORS global)
app.use('/api/chat', apiRoutes);

// --- Manejo de Errores (al final de todos los middlewares y rutas) ---

// Manejo de Ruta no encontrada (404)
app.use((req, res, next) => {
     res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores global
app.use((err, req, res, next) => {
    // Manejo específico para errores de CORS generados por nuestra lógica
    if (err.message === 'Origen no permitido por CORS') {
        console.warn(`Violación CORS Final Capturada: ${err.message}`);
        return res.status(403).json({
            error: 'Acceso CORS denegado para este origen.',
            // Podrías querer quitar esto en producción final por seguridad
            // allowedOrigins: allowedOrigins.map(p => p.toString())
        });
    }

    // Manejo para otros errores
    console.error("Error no manejado:", err.stack || err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// --- Exportar app para Vercel ---
export default app;

// --- Arranque Local (Opcional, Vercel no usa esto) ---
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
     app.listen(PORT, () => {
        console.log(`Servidor escuchando LOCALMENTE en el puerto ${PORT}`);
     });
}