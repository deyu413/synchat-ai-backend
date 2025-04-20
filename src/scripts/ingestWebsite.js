// SOLO PARA DEPURAR TEMPORALMENTE EN VERCEL
// ... imports ...
const app = express();

// Configuración CORS súper simple
const debugCorsOptions = { origin: '*' }; // Permite todo temporalmente
app.options('*', cors(debugCorsOptions)); // Maneja OPTIONS
app.use(cors(debugCorsOptions));    // Aplica a todo

// Resto de middlewares y rutas como los tenías...
app.use(express.json());
// ...