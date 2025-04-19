// server.js (Prueba CORS con ruta directa y OPTIONS explícito)
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Asegúrate que está instalado

const app = express();
const PORT = process.env.PORT || 3001;

// 1. CORS global (debería manejar OPTIONS para rutas simples)
app.use(cors());

// 2. Otros middlewares necesarios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Log de Peticiones
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --- Rutas de Prueba Directas ---

// Ruta Raíz (para verificar que el servidor responde)
app.get('/', (req, res) => {
  res.status(200).send('¡Backend de SynChat AI (Prueba CORS) funcionando!');
});

// Manejar explícitamente OPTIONS para /api/chat/start
// Esto aplica las opciones de cors() a la petición OPTIONS para esta ruta
app.options('/api/chat/start', cors());

// Manejar POST para /api/chat/start
app.post('/api/chat/start', cors(), (req, res) => { // Aplicar cors() aquí también puede ayudar
  console.log('Llegó petición POST a /api/chat/start');
  const { clientId } = req.body;
  console.log('ClientId recibido:', clientId);
  // Simular respuesta exitosa (sin DB por ahora)
  res.status(201).json({ conversationId: 'test-start-ok-' + Date.now() });
});

// Por ahora no incluimos '/api/chat/message' ni apiRoutes

// --- Manejo de Errores ---
app.use((req, res, next) => {
    res.status(404).json({ error: 'Ruta no encontrada en servidor de prueba' });
});
app.use((err, req, res, next) => {
    console.error("Error global no manejado (Prueba CORS):", err.stack || err);
    res.status(500).json({ error: 'Error interno del servidor (Prueba CORS)' });
});

// --- Iniciar Servidor ---
app.listen(PORT, () => {
  console.log(`Servidor de PRUEBA CORS escuchando en puerto ${PORT}`);
});