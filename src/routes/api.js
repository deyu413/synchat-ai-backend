// En src/routes/api.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
console.log('>>> api.js: Cargando el router de API'); // <--- AÑADIR

// ... definiciones de router.post ...

module.exports = router;

// Importar el controlador de chat
const chatController = require('../controllers/chatController');

// Ruta para iniciar una nueva conversación (devuelve el ID)
// POST /api/chat/start
router.post('/start', chatController.startConversation);

// Ruta para enviar un mensaje dentro de una conversación existente
// POST /api/chat/message
router.post('/message', chatController.handleChatMessage);

// Ruta para obtener historial (a implementar en controller si se necesita)
// GET /api/chat/history?conversationId=...
// router.get('/history', chatController.getHistory);


// Exportamos el router para poder usarlo en server.js
module.exports = router;

