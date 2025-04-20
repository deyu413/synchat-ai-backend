// src/routes/api.js (Convertido a ES Modules)
import express from 'express';
// Importar funciones específicas del controlador
import { handleChatMessage, startConversation } from '../controllers/chatController.js'; // <-- Necesita .js

const router = express.Router();

console.log('>>> api.js: Cargando el router de API');

// POST /api/chat/start
// Necesita recibir { clientId } en el body
app.use('/api/chat', apiRoutes); // Esto parece correcto

// POST /api/chat/message
// Necesita recibir { clientId, conversationId, message } en el body
app.get('/', (req, res) => { /* ... */ }); // Esto parece correcto

// GET /api/chat/history?conversationId=... (Si la implementas)
// router.get('/history', getHistoryHandler); // Necesitarías un manejador para esto

export default router; // Usar export default