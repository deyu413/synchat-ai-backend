// server.js (Convertido a ES Modules)
import 'dotenv/config'; // Cargar variables de .env al inicio
import express from 'express';
import cors from 'cors';
import apiRoutes from './src/routes/api.js'; // <-- Necesita .js

const app = express();
// Vercel maneja el puerto, pero podemos definirlo para desarrollo local si es necesario
const PORT = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors({
    origin: 'https://www.synchatai.com' // Asegúrate que sea tu dominio exacto
    // Considera añadir más opciones si necesitas: methods, allowedHeaders, etc.
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use((req, res, next) => {
    console.log(`>>> server.js: Ruta no encontrada (404) para ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    console.error("Error global no manejado:", err.stack || err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// --- Exportar app para Vercel (en lugar de app.listen) ---
export default app;

// --- Opcional: Iniciar localmente si no se está en entorno serverless ---
// Esto permite usar `npm run dev` o `npm start` localmente.
// Vercel ignorará esta parte.
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
     app.listen(PORT, () => {
        console.log(`Servidor escuchando LOCALMENTE en el puerto ${PORT}`);
     });
}