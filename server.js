const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const morgan = require("morgan")
const rateLimit = require("express-rate-limit")
require("dotenv").config()

const { validateEnv } = require("./src/config/envValidator")
const logger = require("./src/config/logger")

// Validate environment variables before starting
try {
  validateEnv()
  logger.info("Environment variables validated successfully")
} catch (error) {
  logger.error("Environment validation failed", { error: error.message })
  process.exit(1)
}

const { notFoundHandler, globalErrorHandler, requestLogger, securityHeaders } = require("./src/middleware/errorHandler")
const db = require("./src/config/database")
const { startCleanupInterval, stopCleanupInterval } = require("./src/middleware/auth")

const app = express()
const PORT = process.env.PORT || 4485
let server // Declare the server variable here

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1) // Solo confiar en el primer proxy (Railway)
}

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://www.ninalubricantes.site",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// Body parsing con límites de seguridad
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf)
      } catch (e) {
        res.status(400).json({
          success: false,
          error: {
            message: "JSON inválido en el cuerpo de la petición",
            code: "INVALID_JSON",
            timestamp: new Date().toISOString(),
          },
        })
        throw new Error("Invalid JSON")
      }
    },
  }),
)

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
    parameterLimit: 1000,
  }),
)

// Rate limiting general
app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 800, // Increased from 100 to 500 requests - more reasonable for active users
    message: {
      success: false,
      error: {
        message: "Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.",
        code: "RATE_LIMIT_EXCEEDED",
        timestamp: new Date().toISOString(),
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: process.env.NODE_ENV === "production",
    keyGenerator: (req) => {
      // En producción usar IP real, en desarrollo usar IP directa
      return process.env.NODE_ENV === "production"
        ? req.ip || req.connection.remoteAddress
        : req.connection.remoteAddress
    },
    skip: (req) => req.method === "OPTIONS",
  }),
)

// Rate limiting específico para login
app.use(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 50, // 5 intentos de login
    message: {
      success: false,
      error: {
        message: "Demasiados intentos de login, intenta de nuevo en 15 minutos.",
        code: "RATE_LIMIT_EXCEEDED",
        timestamp: new Date().toISOString(),
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: process.env.NODE_ENV === "production",
    keyGenerator: (req) => {
      // En producción usar IP real, en desarrollo usar IP directa
      return process.env.NODE_ENV === "production"
        ? req.ip || req.connection.remoteAddress
        : req.connection.remoteAddress
    },
    skip: (req) => req.method === "OPTIONS",
  }),
)

if (process.env.NODE_ENV === "development") {
  app.use(requestLogger)
} else {
  app.use(morgan("combined"))
}

app.use(securityHeaders)

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: "deny",
    },
    noSniff: true,
    xssFilter: true,
  }),
)

app.use("/api/auth", require("./src/routes/authRoutes"))
app.use("/api/users", require("./src/routes/usersRoutes"))
app.use("/api/permisos", require("./src/routes/permisosRoutes")) // agregando rutas de permisos
app.use("/api/clientes", require("./src/routes/clientesRoutes"))
app.use("/api/vehiculos", require("./src/routes/vehiculosRoutes"))
app.use("/api/servicios", require("./src/routes/serviciosRoutes"))
app.use("/api/configuracion", require("./src/routes/configuracionRoutes"))
app.use("/api/tipos-servicios", require("./src/routes/tiposServiciosRoutes"))
app.use("/api/empleados", require("./src/routes/empleadosRoutes"))
app.use("/api/sucursales", require("./src/routes/sucursalesRoutes"))
app.use("/api/productos", require("./src/routes/productosRoutes"))
app.use("/api/movimientos-stock", require("./src/routes/movimientosStockRoutes"))
app.use("/api/categorias", require("./src/routes/categoriasRoutes")) // Agregando ruta de categorías
app.use("/api/ventas", require("./src/routes/ventasRoutes"))
app.use("/api/cuentas-corrientes", require("./src/routes/cuentasCorrientesRoutes"))
app.use("/api/caja", require("./src/routes/cajaRoutes"))
app.use("/api/tarjetas", require("./src/routes/tarjetasRoutes")) // Added new route

app.get("/api/health", (req, res) => {
  const healthCheck = {
    status: "OK",
    message: "Nina Lubricantes API funcionando correctamente",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: process.env.npm_package_version || "1.0.0",
    memory: process.memoryUsage(),
  }

  res.json({
    success: true,
    data: healthCheck,
  })
})

app.use("*", notFoundHandler)

app.use(globalErrorHandler)

const initializeServer = async () => {
  try {
    // Probar conexión a base de datos (con reintentos en producción para esperar a que MySQL esté listo)
    const dbConnected = await db.testConnection()
    if (!dbConnected) {
      logger.error("No se pudo conectar a la base de datos después de varios intentos. Revisa DATABASE_URL y que el servicio MySQL esté activo.")
      process.exit(1)
    }

    startCleanupInterval()

    // Mostrar estadísticas de la base de datos
    const stats = await db.getStats()
    if (stats) {
      logger.info("Database connection stats", {
        activeConnections: stats.activeConnections,
        maxConnections: stats.maxConnections,
      })
    }

    return true
  } catch (error) {
    logger.error("Error inicializando servidor", { error: error.message, stack: error.stack })
    process.exit(1)
  }
}

process.on("SIGTERM", async () => {
  logger.info("SIGTERM recibido, cerrando servidor...")
  stopCleanupInterval()
  await db.closePool()
  if (server) {
    server.close(() => {
      logger.info("Servidor cerrado correctamente")
      process.exit(0)
    })
  }
})

process.on("SIGINT", async () => {
  logger.info("SIGINT recibido, cerrando servidor...")
  stopCleanupInterval()
  await db.closePool()
  if (server) {
    server.close(() => {
      logger.info("Servidor cerrado correctamente")
      process.exit(0)
    })
  }
})

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", { error: error.message, stack: error.stack })
  process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection", { reason, promise })
  process.exit(1)
})

const startServer = async () => {
  await initializeServer()

  server = app.listen(PORT, () => {
    logger.info("Servidor Nina Lubricantes iniciado", {
      port: PORT,
      environment: process.env.NODE_ENV,
      apiUrl: process.env.FRONTEND_URL,
      corsUrl: process.env.FRONTEND_URL,
      timestamp: new Date().toISOString(),
    })
  })

  server.timeout = process.env.NODE_ENV === "production" ? 120000 : 30000
  server.keepAliveTimeout = 65000
  server.headersTimeout = 66000

  return server
}

// Iniciar servidor
if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Failed to start server", { error: error.message, stack: error.stack })
  })
}

module.exports = app
