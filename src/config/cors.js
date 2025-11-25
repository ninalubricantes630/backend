const cors = require("cors")
const logger = require("./logger") || console // use local logger or console

// Build a robust set of allowed origins based on FRONTEND_URL env var
const FRONTEND_URL = process.env.FRONTEND_URL || ""

const allowedOrigins = new Set()

if (FRONTEND_URL) {
  allowedOrigins.add(FRONTEND_URL)

  // If FRONTEND_URL includes www, add the variant without www and viceversa
  try {
    const url = new URL(FRONTEND_URL)
    const hostname = url.hostname // e.g. www.ninalubricantes.site
    if (hostname.startsWith("www.")) {
      const withoutWww = hostname.replace(/^www\./, "")
      allowedOrigins.add(`${url.protocol}//${withoutWww}`)
    } else {
      allowedOrigins.add(`${url.protocol}//www.${hostname}`)
    }
  } catch (e) {
    // If FRONTEND_URL isn't a full URL, try simple string variants
    if (FRONTEND_URL.includes("://www.")) {
      allowedOrigins.add(FRONTEND_URL.replace("://www.", "://"))
    } else {
      allowedOrigins.add(FRONTEND_URL.replace("://", "://www."))
    }
  }
}

// Always allow localhost for development
allowedOrigins.add("http://localhost:3000")
allowedOrigins.add("http://127.0.0.1:3000")
allowedOrigins.add("http://localhost:5173")
allowedOrigins.add("http://127.0.0.1:5173")

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, CLI tools, server-to-server)
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true)
    }

    // Not allowed - report and block
    if (logger && typeof logger.warn === "function") {
      logger.warn(`CORS blocked request from origin: ${origin}`)
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`)
    }

    return callback(new Error("Not allowed by CORS"))
  },

  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  maxAge: 86400, // cache preflight for 24h
  preflightContinue: false,
  optionsSuccessStatus: 204,
}

const corsMiddleware = cors(corsOptions)

module.exports = {
  corsOptions,
  corsMiddleware,
}
