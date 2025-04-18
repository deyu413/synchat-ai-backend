// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // <-- Importar cors

const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors()); // <-- ¡AÑADIR ESTO ANTES DE LAS RUTAS! Permite peticiones desde cualquier origen (para empezar)
// Para más seguridad en producción, configura orígenes específicos:
// app.use(cors({ origin: 'https://www.tudominio-synchatai.com' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => { /* ... tu log ... */ next(); });

// --- Rutas ---
app.get('/', (req, res) => { /* ... */ });
app.use('/api/chat', apiRoutes); // <-- CORS debe ir ANTES

// --- Manejo Errores ---
app.use((req, res, next) => { /* ... 404 ... */ });
app.use((err, req, res, next) => { /* ... 500 ... */ });

app.listen(PORT, () => { /* ... */ });