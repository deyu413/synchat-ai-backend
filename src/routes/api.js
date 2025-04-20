// En src/routes/api.js
const express = require('express');
const router = express.Router();

// --- Asegúrate que la ruta al controlador sea correcta ---
// Importar el controlador UNA SOLA VEZ al principio
const chatController = require('../controllers/chatController');

// --- Log de diagnóstico ---
console.log('>>> api.js: Cargando el router de API');

// --- Definición de Rutas ---

// Ruta para iniciar una nueva conversación (devuelve el ID)
// POST /api/chat/start
router.post('/start', chatController.startConversation);

// Ruta para enviar un mensaje dentro de una conversación existente
// POST /api/chat/message
router.post('/message', chatController.handleChatMessage);

// Ruta para obtener historial (a implementar en controller si se necesita)
// GET /api/chat/history?conversationId=...
// router.get('/history', chatController.getHistory); // Mantenida comentada

// --- Exportar el router DESPUÉS de definir las rutas y UNA SOLA VEZ ---
module.exports = router;