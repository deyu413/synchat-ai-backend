// src/controllers/configController.js
import * as db from '../services/databaseService.js';
import { runIngestion } from '../services/ingestService.js';

/**
 * Inicia el proceso de ingesta para la URL configurada del usuario autenticado.
 */
export const handleTriggerIngestion = async (req, res, next) => {
    // El middleware authenticateToken ya validó el token y puso user en req.user
    const userId = req.user.id;
    console.log(`(Config Controller) Petición para iniciar ingesta recibida para User ID: ${userId}`);

    try {
        // 1. Obtener la config_url del perfil del usuario
        const profileConfig = await db.getProfileConfig(userId);
        const urlToIngest = profileConfig?.config_url;

        if (!urlToIngest) {
            console.warn(`(Config Controller) No se encontró config_url para iniciar ingesta (User ID: ${userId}).`);
            return res.status(400).json({ error: 'No hay una URL configurada para procesar. Guarda una URL primero.' });
        }

        console.log(`(Config Controller) URL encontrada: ${urlToIngest}. Iniciando proceso de ingesta...`);

        // 2. Llamar al servicio de ingesta (NO esperar con await si es largo)
        // Ejecutar en segundo plano para no bloquear la respuesta al frontend
        runIngestion(userId, urlToIngest)
            .then(result => {
                console.log(`(Config Controller) Proceso de ingesta finalizado en segundo plano para User ID ${userId}:`, result);
                // Aquí podrías guardar el estado de la ingesta en la DB o notificar al usuario (ej: WebSockets, email)
            })
            .catch(error => {
                console.error(`(Config Controller) Error en el proceso de ingesta en segundo plano para User ID ${userId}:`, error);
                // Registrar el error asociado al usuario
            });

        // 3. Responder inmediatamente al frontend que el proceso ha comenzado
        res.status(202).json({ message: `Proceso de ingesta iniciado para ${urlToIngest}. Puede tardar unos minutos.` });

    } catch (error) {
        console.error(`(Config Controller) Error general en handleTriggerIngestion para User ID ${userId}:`, error);
        next(error);
    }
};

export default {
    handleTriggerIngestion
};