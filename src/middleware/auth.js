const jwt = require("jsonwebtoken")
const crypto = require("crypto")
const db = require("../config/database")

const logAccess = async (userId, action, resource, ip, userAgent) => {
  try {
    const query = `
      INSERT INTO auditoria (tabla, registro_id, accion, datos_nuevos, usuario_id, ip_address, user_agent)
      VALUES ('access_log', ?, 'INSERT', JSON_OBJECT('action', ?, 'resource', ?), ?, ?, ?)
    `
    await db.query(query, [userId, action, resource, userId, ip, userAgent])
  } catch (error) {
    console.error("Error logging access:", error.message)
  }
}

const verifySession = async (tokenHash, userId) => {
  try {
    const query = `
      SELECT id, expires_at FROM sesiones 
      WHERE token_hash = ? AND usuario_id = ? AND activo = 1 AND expires_at > NOW()
    `
    const sessions = await db.query(query, [tokenHash, userId])
    return sessions.length > 0
  } catch (error) {
    console.error("Error verifying session:", error)
    return false
  }
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization")
    const token = authHeader?.replace("Bearer ", "")

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Token de autenticación requerido",
        code: "TOKEN_MISSING",
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")

    const userQuery = `
      SELECT id, nombre, email, rol, activo, ultimo_login 
      FROM usuarios 
      WHERE id = ? AND activo = 1
    `
    const users = await db.query(userQuery, [decoded.id])

    if (!users.length) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Usuario no encontrado o inactivo",
        code: "USER_NOT_FOUND",
      })
    }

    const sessionValid = await verifySession(tokenHash, decoded.id)

    if (!sessionValid) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Sesión expirada o inválida",
        code: "SESSION_INVALID",
      })
    }

    req.user = {
      id: users[0].id,
      nombre: users[0].nombre,
      email: users[0].email,
      rol: users[0].rol,
      ultimo_login: users[0].ultimo_login,
    }

    await logAccess(
      req.user.id,
      req.method,
      req.originalUrl,
      req.ip || req.connection.remoteAddress,
      req.get("User-Agent"),
    )

    next()
  } catch (error) {
    console.error("Authentication error:", error)

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "El token de autenticación ha expirado",
        code: "TOKEN_EXPIRED",
      })
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Token de autenticación inválido",
        code: "TOKEN_INVALID",
      })
    }

    return res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Error interno de autenticación",
      code: "AUTH_ERROR",
    })
  }
}

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Usuario no autenticado",
        code: "USER_NOT_AUTHENTICATED",
      })
    }

    if (!allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        error: "FORBIDDEN",
        message: `Acceso denegado. Roles requeridos: ${allowedRoles.join(", ")}`,
        code: "INSUFFICIENT_PERMISSIONS",
        userRole: req.user.rol,
        requiredRoles: allowedRoles,
      })
    }

    next()
  }
}

const requireAdmin = requireRole("admin")

const requireEmployee = requireRole("admin", "empleado")

const requireOwnershipOrAdmin = (getResourceOwnerId) => {
  return async (req, res, next) => {
    try {
      if (req.user.rol === "admin") {
        return next() // Admin puede acceder a todo
      }

      const resourceOwnerId = await getResourceOwnerId(req)

      if (resourceOwnerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: "FORBIDDEN",
          message: "No tienes permisos para acceder a este recurso",
          code: "RESOURCE_ACCESS_DENIED",
        })
      }

      next()
    } catch (error) {
      console.error("Ownership verification error:", error)
      return res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Error verificando permisos de acceso",
        code: "OWNERSHIP_CHECK_ERROR",
      })
    }
  }
}

const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const userRequests = new Map()

  return (req, res, next) => {
    if (!req.user) {
      return next()
    }

    const userId = req.user.id
    const now = Date.now()
    const windowStart = now - windowMs

    if (userRequests.has(userId)) {
      const requests = userRequests.get(userId).filter((time) => time > windowStart)
      userRequests.set(userId, requests)
    } else {
      userRequests.set(userId, [])
    }

    const currentRequests = userRequests.get(userId)

    if (currentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: "TOO_MANY_REQUESTS",
        message: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
        code: "USER_RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil(windowMs / 1000),
      })
    }

    currentRequests.push(now)
    next()
  }
}

const invalidateSession = async (token) => {
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    const query = `UPDATE sesiones SET activo = 0 WHERE token_hash = ?`
    await db.query(query, [tokenHash])
  } catch (error) {
    console.error("Error invalidating session:", error)
  }
}

const cleanExpiredSessions = async () => {
  try {
    const query = `DELETE FROM sesiones WHERE expires_at < NOW() OR activo = 0`
    await db.query(query)
  } catch (error) {
    // Only log to file in development, not console in production
    if (process.env.NODE_ENV === "development") {
      console.error("Error cleaning expired sessions:", error.message)
    }
  }
}

let cleanupIntervalId = null

const startCleanupInterval = () => {
  if (cleanupIntervalId) return // Prevent duplicate intervals
  cleanupIntervalId = setInterval(cleanExpiredSessions, 60 * 60 * 1000) // Every hour
}

const stopCleanupInterval = () => {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
  }
}

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireEmployee,
  requireOwnershipOrAdmin,
  userRateLimit,
  invalidateSession,
  cleanExpiredSessions,
  logAccess,
  startCleanupInterval,
  stopCleanupInterval,
  verifyToken: authenticateToken,
  verifyRole: requireRole,
  verifyAdmin: requireAdmin,
}
