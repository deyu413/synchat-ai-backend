// src/routes/api.js
import express from 'express';
import { handleChatMessage, startConversation } from '../controllers/chatController.js';

const router = express.Router(); // Usar router, NO app

console.log('>>> api.js: Cargando el router de API');

// Usar router.post, NO app.post
router.post('/start', startConversation);
router.post('/message', handleChatMessage);

// Otras rutas si las tienes, siempre con router.get, router.post, etc.

export default router;