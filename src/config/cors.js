// backend/src/config/cors.js
const cors = require("cors")

/**
 * Cors options robustos:
 * - Acepta FRONTEND_URL tal como esté y agrega automáticamente la versión con/sin "www."
 * - Permite varios orígenes (por ejemplo Vercel genera dominios sin/www)
 * - Acepta solicitudes con credentials si lo necesitas (setea credentials: true)
 * - Maneja requests con origin === undefined (herramientas tipo curl / mobile / server-to-server)
 */

function buildAllowedOrigins(frontendUrl) {
  if (!frontendUrl) return []
  const origins = new Set()

  // Normalizar: eliminar trailing slash si existe
  const normalize = (u) => (u || "").replace(/\/$/, "")

  const url = normalize(frontendUrl)
  origins.add(url)

  // si incluye //www. añadimos la versión sin www
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    if (hostname.startsWith("www.")) {
      const noWww = `${parsed.protocol}//${hostname.replace(/^www\./, "")}${parsed.port ? `:${parsed.port}` : ""}`
      origins.add(noWww)
    } else {
      // si no tiene www, añadimos la versión con www
      const withWww = `${parsed.protocol}//www.${hostname}${parsed.port ? `:${parsed.port}` : ""}`
      origins.add(withWww)
    }
  } catch (e) {
    // si FRONTEND_URL no es una URL válida, añadir la cadena tal cual
    origins.add(url)
  }

  return Array.from(origins)
}

const frontendUrl = process.env.FRONTEND_URL || ""
const allowedOrigins = buildAllowedOrigins(frontendUrl)

// Siempre permitimos localhost durante desarrollo
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000")
}

const corsOptions = {
  origin: (origin, callback) => {
    // origin === undefined -> peticiones no-browser (postman, mobile, server)
    if (!origin) return callback(null, true)

    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    // Si no está permitido, devolver error de CORS
    const msg = `La política CORS no permite el acceso desde el origen: ${origin}`
    return callback(new Error(msg), false)
  },
  // Si tu frontend envía cookies/autorización y quieres permitirlo:
  // credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Allow-Origin",
  ],
  // Cache preflight 24h
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
}

const corsMiddleware = cors(corsOptions)

module.exports = {
  corsOptions,
  corsMiddleware,
  buildAllowedOrigins,
}
