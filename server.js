const corsOptions = {
    origin: (origin, callback) => {
        // Permite solicitudes sin 'origin' (como Postman, curl) o si el origen está en la lista
        if (!origin || allowedOrigins.some(pattern => pattern.test(origin))) {
            callback(null, true);
        } else {
            console.warn(`CORS Bloqueado: Origen -> ${origin}`); // Loguea el origen bloqueado
            callback(new Error('Origen no permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'], // Métodos necesarios (incluye OPTIONS)
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'], // Cabeceras que usas
    credentials: true,
    optionsSuccessStatus: 200 // Para navegadores 'quisquillosos'
};

// --- Middlewares ---

// 1. Manejar TODAS las peticiones OPTIONS (preflight) PRIMERO
app.options('*', cors(corsOptions));

// 2. Aplicar CORS globalmente a TODAS las demás peticiones ANTES de cualquier otra cosa
app.use(cors(corsOptions));

// 3. Body Parsers DESPUÉS de CORS global
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [Origin: ${req.headers.origin || 'N/A'}]`);
    next();
});

// --- Rutas ---
// Ya no necesitas aplicar cors() aquí porque se aplica globalmente arriba
app.get('/', (req, res) => {
    res.status(200).send('¡Backend operativo!');
});

app.use('/api/chat', apiRoutes); // Montar las rutas de la API

// --- Manejo de Errores (al final) ---
// Ruta no encontrada (404)
app.use((req, res, next) => {
     res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores global
app.use((err, req, res, next) => {
    if (err.message === 'Origen no permitido por CORS') {
        console.warn(`Violación CORS Final: ${err.message}`);
        return res.status(403).json({
            error: 'Acceso CORS denegado para este origen.',
            // Opcional: Devolver los orígenes permitidos puede ayudar a depurar el frontend
            // allowedOrigins: allowedOrigins.map(p => p.toString())
        });
    }

    console.error("Error no manejado:", err.stack || err);
    res.status(500).json({ error: 'Error interno del servidor' });
});


// --- Exportar app y Arranque Local ---
export default app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
     app.listen(PORT, () => {
        console.log(`Servidor escuchando LOCALMENTE en el puerto ${PORT}`);
     });
}