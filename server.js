// server.js (Actualizado con CORS configurado)
require('dotenv').config(); // Cargar variables de .env al inicio
const express = require('express');
const cors = require('cors'); // <--- 1. Importar cors
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---

// 2. Configurar CORS para permitir peticiones DESDE tu dominio frontend
//    ¡ASEGÚRATE que la URL sea EXACTAMENTE tu dominio donde está el widget!
app.use(cors({
  origin: 'https://www.synchatai.com'
}));
// Si necesitaras permitir múltiples orígenes (ej. localhost para desarrollo Y tu dominio):
// const allowedOrigins = ['http://localhost:xxxx', 'https://www.synchatai.com'];
// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true)
//     } else {
//       callback(new Error('Not allowed by CORS'))
//     }
//   }
// }));


// Middlewares esenciales de Express (después de CORS)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware simple para loggear peticiones (opcional)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});


// --- Rutas ---

// Ruta de prueba básica para la raíz '/'
app.get('/', (req, res) => {
  res.status(200).send('¡Backend de SynChat AI funcionando correctamente!');
});

// Usar las rutas de la API bajo el prefijo /api/chat
// ¡IMPORTANTE! CORS debe ir ANTES de esto.
app.use('/api/chat', apiRoutes);


// --- Manejo de Errores (Al final) ---

// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
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