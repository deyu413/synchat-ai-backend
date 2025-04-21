// src/routes/configRoutes.js
import express from 'express';
import configController from '../controllers/configController.js';
import { authenticateToken } from '../middleware/authMiddleware.js'; // Importar el middleware JWT

const router = express.Router();

console.log('>>> configRoutes.js: Cargando router /api/config');

// POST /api/config/ingest - Inicia la ingesta para el usuario autenticado
// Esta ruta está protegida, requiere un token JWT válido en la cabecera Authorization
router.post('/ingest', authenticateToken, configController.handleTriggerIngestion);

console.log('>>> configRoutes.js: Rutas definidas');

export default router;