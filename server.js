// server.js (VERSIÓN DE PRUEBA SÚPER SIMPLE)
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Asegúrate de que 'cors' está en package.json

const app = express();
const PORT = process.env.PORT || 3001;

// 1. Aplicar CORS para TODO primero
app.use(cors()); // Permitir cualquier origen

// 2. Middleware para parsear JSON (necesario para POST)
app.use(express.json());

// 3. UNA SOLA RUTA DE PRUEBA para /api/chat/start
app.post('/api/chat/start', (req, res) => {
  console.log('Llegó petición a /api/chat/start (TEST)');
  // Simular una respuesta exitosa con un ID falso
  res.status(201).json({ conversationId: 'test-cors-ok-' + Date.now() });
});

// ¡¡Hemos quitado todas las demás rutas y middlewares!!

app.listen(PORT, () => {
  console.log(`Servidor de PRUEBA escuchando en puerto ${PORT}`);
});