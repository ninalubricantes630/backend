class ResponseHelper {
  // Respuesta exitosa estándar
  static success(res, data = null, message = "Operación exitosa", statusCode = 200) {
    const response = {
      success: true,
      message,
      timestamp: new Date().toISOString(),
    }

    if (data !== null) {
      response.data = data
    }

    return res.status(statusCode).json(response)
  }

  // Respuesta exitosa con paginación
  static successWithPagination(res, data, pagination, message = "Datos obtenidos exitosamente") {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        currentPage: Number.parseInt(pagination.page) || 1,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        totalItems: pagination.total,
        itemsPerPage: Number.parseInt(pagination.limit) || 10,
        hasNextPage: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrevPage: pagination.page > 1,
      },
      timestamp: new Date().toISOString(),
    })
  }

  // Respuesta de error estándar
  static error(res, message = "Error interno del servidor", statusCode = 500, errorCode = null, details = null) {
    const response = {
      success: false,
      error: {
        message,
        code: errorCode || this.getErrorCodeFromStatus(statusCode),
        timestamp: new Date().toISOString(),
      },
    }

    // Agregar detalles del error solo en desarrollo
    if (process.env.NODE_ENV === "development" && details) {
      response.error.details = details
      response.error.stack = details.stack
    }

    return res.status(statusCode).json(response)
  }

  // Respuesta de validación de errores
  static validationError(res, errors, message = "Errores de validación") {
    return res.status(400).json({
      success: false,
      error: {
        message,
        code: "VALIDATION_ERROR",
        timestamp: new Date().toISOString(),
        validationErrors: Array.isArray(errors) ? errors : [errors],
      },
    })
  }

  // Respuesta de no autorizado
  static unauthorized(res, message = "No autorizado", code = "UNAUTHORIZED") {
    return res.status(401).json({
      success: false,
      error: {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
    })
  }

  // Respuesta de prohibido
  static forbidden(res, message = "Acceso prohibido", code = "FORBIDDEN") {
    return res.status(403).json({
      success: false,
      error: {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
    })
  }

  // Respuesta de no encontrado
  static notFound(res, message = "Recurso no encontrado", code = "NOT_FOUND") {
    return res.status(404).json({
      success: false,
      error: {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
    })
  }

  // Respuesta de conflicto
  static conflict(res, message = "Conflicto de datos", code = "CONFLICT") {
    return res.status(409).json({
      success: false,
      error: {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
    })
  }

  // Respuesta de demasiadas solicitudes
  static tooManyRequests(res, message = "Demasiadas solicitudes", retryAfter = null) {
    const response = {
      success: false,
      error: {
        message,
        code: "TOO_MANY_REQUESTS",
        timestamp: new Date().toISOString(),
      },
    }

    if (retryAfter) {
      response.error.retryAfter = retryAfter
    }

    return res.status(429).json(response)
  }

  // Respuesta de creación exitosa
  static created(res, data, message = "Recurso creado exitosamente") {
    return this.success(res, data, message, 201)
  }

  // Respuesta de actualización exitosa
  static updated(res, data = null, message = "Recurso actualizado exitosamente") {
    return this.success(res, data, message, 200)
  }

  // Respuesta de eliminación exitosa
  static deleted(res, message = "Recurso eliminado exitosamente") {
    return this.success(res, null, message, 200)
  }

  // Obtener código de error basado en status HTTP
  static getErrorCodeFromStatus(statusCode) {
    const codes = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      422: "UNPROCESSABLE_ENTITY",
      429: "TOO_MANY_REQUESTS",
      500: "INTERNAL_SERVER_ERROR",
      502: "BAD_GATEWAY",
      503: "SERVICE_UNAVAILABLE",
    }
    return codes[statusCode] || "UNKNOWN_ERROR"
  }

  // Wrapper para manejo de errores async
  static asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch((error) => {
        console.error("Async handler error:", error)
        this.error(res, "Error interno del servidor", 500, "INTERNAL_SERVER_ERROR", error)
      })
    }
  }

  // Respuesta de login exitoso
  static loginSuccess(res, user, token, message = "Login exitoso") {
    return res.status(200).json({
      success: true,
      message,
      data: {
        user,
        token,
        expiresIn: "24h",
      },
      timestamp: new Date().toISOString(),
    })
  }

  // Respuesta de logout exitoso
  static logoutSuccess(res, message = "Logout exitoso") {
    return this.success(res, null, message, 200)
  }

  static sendSuccess(res, data = null, message = "Operación exitosa", statusCode = 200) {
    return this.success(res, data, message, statusCode)
  }

  static sendError(res, message = "Error interno del servidor", statusCode = 500, errorCode = null) {
    return this.error(res, message, statusCode, errorCode)
  }
}

module.exports = ResponseHelper
module.exports.sendSuccess = ResponseHelper.sendSuccess.bind(ResponseHelper)
module.exports.sendError = ResponseHelper.sendError.bind(ResponseHelper)
