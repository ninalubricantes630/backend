const mysql = require("mysql2/promise")
require("dotenv").config()

const logger = require("./logger")

const createDbConfig = () => {
  const baseOptions = {
    waitForConnections: true,
    queueLimit: 0,
    charset: "utf8mb4",
    timezone: "local",
    multipleStatements: false,
    // Mantener conexiones vivas y reducir "Connection lost" (Railway/MySQL)
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  }

  // If DATABASE_URL is provided (production), parse it
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL)
    return {
      ...baseOptions,
      host: url.hostname,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading slash
      port: Number.parseInt(url.port) || 3306,
      connectionLimit:
        Number.parseInt(process.env.DB_CONNECTION_LIMIT) || (process.env.NODE_ENV === "production" ? 50 : 10),
      ssl:
        process.env.NODE_ENV === "production"
          ? {
              rejectUnauthorized: false, // Railway compatibility
            }
          : false,
    }
  }

  // Otherwise use individual environment variables (development)
  return {
    ...baseOptions,
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "milo_lubricantes",
    port: Number.parseInt(process.env.DB_PORT) || 3306,
    connectionLimit: Number.parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  }
}

const dbConfig = createDbConfig()

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const testConnection = async (options = {}) => {
  const maxAttempts = options.maxAttempts ?? (process.env.NODE_ENV === "production" ? 15 : 3)
  const delayMs = options.delayMs ?? 2000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const connection = await pool.getConnection()
      const [rows] = await connection.execute("SELECT VERSION() as version, NOW() as server_time")

      logger.info("MySQL connection established", {
        database: dbConfig.database,
        host: `${dbConfig.host}:${dbConfig.port}`,
        version: rows[0].version,
        serverTime: rows[0].server_time,
        connectionType: process.env.DATABASE_URL ? "DATABASE_URL" : "individual_vars",
        attempt: attempt > 1 ? `${attempt}/${maxAttempts}` : undefined,
      })

      connection.release()
      return true
    } catch (error) {
      const isLast = attempt === maxAttempts
      logger[isLast ? "error" : "warn"]("Error connecting to MySQL", {
        error: error.message,
        code: error.code,
        host: dbConfig.host,
        database: dbConfig.database,
        attempt: `${attempt}/${maxAttempts}`,
      })
      if (isLast) return false
      logger.info(`Reintentando conexión en ${delayMs / 1000}s...`)
      await sleep(delayMs)
    }
  }
  return false
}

const isConnectionLostError = (err) =>
  err && (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT")

const query = async (sql, params = [], logQuery = false, retried = false) => {
  try {
    if (logQuery && process.env.NODE_ENV === "development") {
      logger.debug("Executing database query", {
        sql: sql.substring(0, 100) + (sql.length > 100 ? "..." : ""),
        params,
      })
    }

    const [results] = await pool.execute(sql, params)
    return results
  } catch (error) {
    if (isConnectionLostError(error) && !retried) {
      logger.warn("Database connection lost, retrying once...", { code: error.code })
      await new Promise((r) => setTimeout(r, 500))
      return query(sql, params, logQuery, true)
    }
    logger.error("Database query error", {
      sql: sql.substring(0, 100) + (sql.length > 100 ? "..." : ""),
      params,
      error: error.message,
      code: error.code,
    })
    throw error
  }
}

const beginTransaction = async () => {
  const connection = await pool.getConnection()
  await connection.beginTransaction()

  return {
    query: async (sql, params = []) => {
      try {
        const [results] = await connection.execute(sql, params)
        return results
      } catch (error) {
        console.error("Transaction query error:", error)
        throw error
      }
    },
    commit: async () => {
      try {
        await connection.commit()
        connection.release()
      } catch (error) {
        console.error("Transaction commit error:", error)
        await connection.rollback()
        connection.release()
        throw error
      }
    },
    rollback: async () => {
      try {
        await connection.rollback()
        connection.release()
      } catch (error) {
        console.error("Transaction rollback error:", error)
        connection.release()
        throw error
      }
    },
  }
}

const executeTransaction = async (queries) => {
  const transaction = await beginTransaction()

  try {
    const results = []
    for (const { sql, params } of queries) {
      const result = await transaction.query(sql, params)
      results.push(result)
    }

    await transaction.commit()
    return results
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}

const getStats = async () => {
  try {
    const [connections] = await pool.execute("SHOW STATUS LIKE 'Threads_connected'")
    const [maxConnections] = await pool.execute("SHOW VARIABLES LIKE 'max_connections'")

    return {
      activeConnections: Number.parseInt(connections[0].Value),
      maxConnections: Number.parseInt(maxConnections[0].Value),
      poolConfig: {
        connectionLimit: dbConfig.connectionLimit,
        queueLimit: dbConfig.queueLimit,
      },
    }
  } catch (error) {
    logger.error("Error getting database stats", { error: error.message })
    return null
  }
}

const closePool = async () => {
  try {
    await pool.end()
    logger.info("Database connection pool closed successfully")
  } catch (error) {
    logger.error("Error closing database connection pool", { error: error.message })
  }
}

const getConnection = () => pool.getConnection()

pool.on("connection", (connection) => {
  if (process.env.NODE_ENV === "development") {
    logger.debug("New database connection established", { threadId: connection.threadId })
  }
})

pool.on("error", (error) => {
  logger.error("Database pool error", { error: error.message, code: error.code })
  if (error.code === "PROTOCOL_CONNECTION_LOST") {
    logger.info("Attempting to reconnect to database...")
  }
})

module.exports = {
  pool,
  testConnection,
  query,
  beginTransaction,
  executeTransaction,
  getStats,
  closePool,
  getConnection,
  // Alias para compatibilidad
  executeQuery: query,
}
