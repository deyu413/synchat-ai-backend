// src/scripts/ingestWebsite.js
// Este script es para ejecutar la ingesta manualmente desde la línea de comandos.
import 'dotenv/config';
import { runIngestion } from '../services/ingestService.js'; // Importa la lógica refactorizada

async function executeScript() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Uso: node src/scripts/ingestWebsite.js <userId> <url>");
        console.error("     <userId> debe ser el UUID del perfil del usuario de Supabase.");
        process.exit(1);
    }
    const userId = args[0]; // Ahora esperamos el userId (UUID)
    const urlToIngest = args[1];

    // Validación básica
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!userId || !uuidRegex.test(userId)) {
         console.error("Por favor, proporciona un userId válido (UUID).");
         process.exit(1);
    }
    if (!urlToIngest || !urlToIngest.startsWith('http')) {
        console.error("Por favor, proporciona una URL completa válida (ej: https://...).");
        process.exit(1);
    }

    try {
        const result = await runIngestion(userId, urlToIngest);
        console.log("\nResultado del Script:", result);
        if (!result.success) {
            process.exitCode = 1; // Indicar error en la salida
        }
    } catch (error) {
        // runIngestion ya debería manejar y loguear errores, pero por si acaso
        console.error("Error fatal ejecutando el script de ingesta:", error);
        process.exitCode = 1;
    }
}

// Ejecutar la función principal del script
executeScript();