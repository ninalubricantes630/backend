const cors = require("cors")

const corsOptions = {
  origin: (origin, callback) => {
    const frontendUrl = process.env.FRONTEND_URL

    const allowedOrigins = []

    if (frontendUrl) {
      allowedOrigins.push(frontendUrl)

      // Add domain without www if it has www
      if (frontendUrl.includes("://www.")) {
        allowedOrigins.push(frontendUrl.replace("://www.", "://"))
      }
      // Add domain with www if it doesn't have www
      if (!frontendUrl.includes("://www.")) {
        allowedOrigins.push(frontendUrl.replace("://", "://www."))
      }
    }

    if (process.env.NODE_ENV === "production") {
      // Allow any Vercel app deployment
      allowedOrigins.push(/\.vercel\.app$/)
    }

    if (process.env.NODE_ENV === "development") {
      return callback(null, true)
    }

    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)

    const isAllowed = allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin)
      }
      return allowedOrigin === origin
    })

    if (isAllowed) {
      callback(null, true)
    } else {
      console.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`)
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

  maxAge: 86400,

  preflightContinue: false,
  optionsSuccessStatus: 200,
}

const corsMiddleware = cors(corsOptions)

module.exports = {
  corsOptions,
  corsMiddleware,
}
