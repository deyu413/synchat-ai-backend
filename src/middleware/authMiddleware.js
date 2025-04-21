// src/middleware/authMiddleware.js
import { supabase } from '../services/supabaseClient.js'; // Cliente Supabase del backend

/**
 * Middleware para verificar el token JWT de Supabase Auth.
 * Espera el token en la cabecera 'Authorization: Bearer <TOKEN>'.
 * Si es válido, adjunta el objeto 'user' a 'req.user'.
 */
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.warn('(Auth Middleware) Token no proporcionado.');
    return res.status(401).json({ error: 'Acceso no autorizado: Token no proporcionado.' });
  }

  try {
    // Verificar el token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
        console.warn(`(Auth Middleware) Error al verificar token: ${error.message}`);
        // Manejar errores específicos de Supabase si es necesario
        if (error.message === 'invalid JWT') {
            return res.status(403).json({ error: 'Acceso prohibido: Token inválido.' });
        }
        if (error.message === 'JWT expired') {
            return res.status(403).json({ error: 'Acceso prohibido: Token expirado.' });
        }
         // Otro tipo de error
         return res.status(403).json({ error: 'Acceso prohibido: No se pudo validar el token.' });
    }

    if (!user) {
        // Aunque no haya error, si no devuelve usuario, el token no es válido
        console.warn('(Auth Middleware) Token válido pero no asociado a un usuario.');
        return res.status(403).json({ error: 'Acceso prohibido: Usuario no encontrado para este token.' });
    }

    // ¡Token válido! Adjuntar usuario a la request
    req.user = user;
    console.log(`(Auth Middleware) Token validado para User ID: ${user.id}`);
    next(); // Continuar con la siguiente ruta/middleware

  } catch (error) {
    console.error("(Auth Middleware) Excepción inesperada:", error);
    // Enviar error genérico 500 si algo inesperado ocurre
    return res.status(500).json({ error: 'Error interno del servidor al procesar la autenticación.' });
  }
};