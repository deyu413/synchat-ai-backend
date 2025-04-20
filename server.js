// server.js (Actualizado con CORS y Logs de diagnóstico)
require('dotenv').config(); // Cargar variables de .env al inicio
const express = require('express');
const cors = require('cors'); // <--- Importar cors
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---

// Configurar CORS para permitir peticiones DESDE tu dominio frontend
// ¡ASEGÚRATE que la URL sea EXACTAMENTE tu dominio donde está el widget!
app.use(cors({
    origin: 'https://www.synchatai.com'
}));

// Middlewares esenciales de Express (después de CORS)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones (opcional pero útil)
app.use((req, res, next) => {
    // Este log ya existía, lo mantenemos
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});


// --- Rutas ---

// Ruta de prueba básica para la raíz '/'
app.get('/', (req, res) => {
    res.status(200).send('¡Backend de SynChat AI funcionando correctamente!');
});

// --- Montaje de rutas API con Logs de diagnóstico ---
console.log('>>> server.js: ANTES de app.use /api/chat'); // LOG AÑADIDO
app.use('/api/chat', apiRoutes);
console.log('>>> server.js: DESPUÉS de app.use /api/chat'); // LOG AÑADIDO


// --- Manejo de Errores (Al final) ---

// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
    // --- Log para diagnóstico 404 ---
    console.log(`>>> server.js: Cayendo en MANEJADOR 404 para ${req.method} ${req.path}`); // LOG AÑADIDO
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Middleware para manejo de errores global
app.use((err, req, res, next) => {
    console.error("Error global no manejado:", err.stack || err);
    // Evitar enviar detalles del error en producción por seguridad
    res.status(500).json({ error: 'Error interno del servidor' });
});


// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`); // Quitamos localhost de aquí, Vercel usa otro sistema
});

// Exportar app puede ser necesario para algunos tests o configuraciones,
// pero para el despliegue estándar en Vercel con server.js y listen, no suele hacer falta.
// Si lo necesitas por otra razón, descomenta:
// module.exports = app;