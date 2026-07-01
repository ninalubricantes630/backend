const ResponseHelper = require("../utils/responseHelper")

// Middleware para manejo de errores 404
const notFoundHandler = (req, res, next) => {
  return ResponseHelper.notFound(res, `Ruta ${req.method} ${req.originalUrl} no encontrada`, "ROUTE_NOT_FOUND")
}

// Middleware global de manejo de errores
const globalErrorHandler = (err, req, res, next) => {
  // Log del error
  console.error("Global Error Handler:", {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    user: req.user?.id || "anonymous",
    timestamp: new Date().toISOString(),
  })

  // Errores de validación de express-validator
  if (err.type === "entity.parse.failed") {
    return ResponseHelper.validationError(res, [
      { field: "body", message: "JSON inválido en el cuerpo de la petición" },
    ])
  }

  // Errores de JWT
  if (err.name === "JsonWebTokenError") {
    return ResponseHelper.unauthorized(res, "Token JWT inválido", "INVALID_JWT")
  }

  if (err.name === "TokenExpiredError") {
    return ResponseHelper.unauthorized(res, "Token JWT expirado", "EXPIRED_JWT")
  }

  // Errores de base de datos MySQL
  if (err.code === "ER_DUP_ENTRY") {
    const field = err.sqlMessage?.match(/for key '(.+?)'/)?.[1] || "campo"
    return ResponseHelper.conflict(res, `Ya existe un registro con ese ${field}`, "DUPLICATE_ENTRY")
  }

  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return ResponseHelper.validationError(res, [{ field: "foreign_key", message: "Referencia a registro inexistente" }])
  }

  if (err.code === "ER_ROW_IS_REFERENCED_2") {
    return ResponseHelper.conflict(
      res,
      "No se puede eliminar el registro porque está siendo utilizado",
      "REFERENCED_RECORD",
    )
  }

  // Errores de conexión a base de datos
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ER_ACCESS_DENIED_ERROR" ||
    err.code === "ETIMEDOUT" ||
    err.code === "PROTOCOL_CONNECTION_LOST" ||
    err.code === "ECONNRESET"
  ) {
    return ResponseHelper.error(res, "Error de conexión a la base de datos. Intenta de nuevo.", 503, "DATABASE_CONNECTION_ERROR")
  }

  // Errores de límite de tamaño de payload
  if (err.type === "entity.too.large") {
    return ResponseHelper.validationError(res, [
      { field: "payload", message: "El tamaño de la petición excede el límite permitido" },
    ])
  }

  // Errores de rate limiting
  if (err.status === 429) {
    return ResponseHelper.tooManyRequests(res, "Demasiadas solicitudes, intenta de nuevo más tarde", err.retryAfter)
  }

  // Errores de validación personalizados
  if (err.name === "ValidationError") {
    return ResponseHelper.validationError(res, err.errors || [{ field: "validation", message: err.message }])
  }

  // Errores de autorización personalizados
  if (err.name === "UnauthorizedError") {
    return ResponseHelper.unauthorized(res, err.message, "UNAUTHORIZED")
  }

  if (err.name === "ForbiddenError") {
    return ResponseHelper.forbidden(res, err.message, "FORBIDDEN")
  }

  // Error interno del servidor por defecto
  return ResponseHelper.error(
    res,
    process.env.NODE_ENV === "development" ? err.message : "Error interno del servidor",
    500,
    "INTERNAL_SERVER_ERROR",
    process.env.NODE_ENV === "development" ? err : null,
  )
}

// Middleware para capturar errores async sin try/catch
const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// Middleware de logging de requests
const requestLogger = (req, res, next) => {
  const start = Date.now()

  // Log de request
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - IP: ${req.ip}`)

  // Interceptar el final de la response para log
  const originalSend = res.send
  res.send = function (data) {
    const duration = Date.now() - start
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`)
    originalSend.call(this, data)
  }

  next()
}

// Middleware de seguridad adicional
const securityHeaders = (req, res, next) => {
  // Headers de seguridad adicionales
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("X-XSS-Protection", "1; mode=block")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

  // Remover header que expone información del servidor
  res.removeHeader("X-Powered-By")

  next()
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
  asyncErrorHandler,
  requestLogger,
  securityHeaders,
}
