const cors = require("cors")
const logger = require("winston") // Assuming winston is used for logging

const corsOptions = {
  origin: (origin, callback) => {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"

    const allowedOrigins = [
      frontendUrl,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
    ]

    if (process.env.NODE_ENV === "production" && frontendUrl) {
      if (frontendUrl.includes("://www.")) {
        allowedOrigins.push(frontendUrl.replace("://www.", "://"))
      }
      if (!frontendUrl.includes("://www.")) {
        allowedOrigins.push(frontendUrl.replace("://", "://www."))
      }
    }

    if (process.env.NODE_ENV === "development") {
      return callback(null, true)
    }

    if (!origin) {
      return callback(null, true)
    }

    // This allows the browser to see the rejection reason
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, false)
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
