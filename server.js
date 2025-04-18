// server.js
require('dotenv').config(); // Cargar variables de .env al inicio
const express = require('express');

// Importar las rutas de la API
const apiRoutes = require('./src/routes/api'); // Asegúrate que la ruta al archivo es correcta

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares esenciales de Express
app.use(express.json()); // Para parsear body JSON
app.use(express.urlencoded({ extended: true })); // Para parsear body URL-encoded

// Middleware simple para loggear peticiones (opcional)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Ruta de prueba básica para la raíz '/'
app.get('/', (req, res) => {
  res.status(200).send('¡Backend de SynChat AI funcionando correctamente!');
});

// Usar las rutas de la API bajo el prefijo /api/chat
// Cualquier petición a /api/chat/... será manejada por apiRoutes
app.use('/api/chat', apiRoutes);

// Middleware para manejar rutas no encontradas (404) - Debe ir después de tus rutas
app.use((req, res, next) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Middleware para manejo de errores global - Debe ir al final
app.use((err, req, res, next) => {
    console.error("Error global no manejado:", err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
});


// Iniciar el servidor
app.listen(PORT, () => {
  // Verifica si el pool de DB está listo (requiere exportar pool o una función de chequeo desde databaseService)
  // Esto es opcional, pero da más seguridad de que todo está ok al arrancar.
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});