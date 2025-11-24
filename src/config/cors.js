const cors = require("cors")

// Configuración de CORS mejorada
const corsOptions = {
  origin: (origin, callback) => {
    // Lista de orígenes permitidos
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
    ]

    if (process.env.NODE_ENV === "development") {
      return callback(null, true)
    }

    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)

    // Verificar si el origin está en la lista permitida
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`CORS blocked origin: ${origin}`)
      callback(new Error("No permitido por política CORS"), false)
    }
  },

  // Métodos HTTP permitidos
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],

  // Headers permitidos
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "X-Access-Token",
  ],

  // Headers expuestos al cliente
  exposedHeaders: ["X-Total-Count", "X-Total-Pages", "X-Current-Page", "X-Rate-Limit-Remaining", "X-Rate-Limit-Reset"],

  // Permitir cookies y credenciales
  credentials: true,

  // Cache de preflight requests (24 horas)
  maxAge: 86400,

  // Manejar preflight requests
  preflightContinue: false,
  optionsSuccessStatus: 204,
}

const corsMiddleware = cors(corsOptions)

module.exports = {
  corsOptions,
  corsMiddleware,
}
