const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")

// Obtener todas las tarjetas activas con sus cuotas
const obtenerTarjetas = async (req, res) => {
  try {
    const [tarjetas] = await db.pool.execute(
      `SELECT 
        t.id,
        t.nombre,
        t.descripcion,
        t.activo,
        t.created_at,
        COUNT(tc.id) as total_cuotas
       FROM tarjetas_credito t
       LEFT JOIN tarjeta_cuotas tc ON t.id = tc.tarjeta_id AND tc.activo = 1
       WHERE t.activo = 1
       GROUP BY t.id
       ORDER BY t.nombre ASC`,
    )

    const tarjetasConDetalles = []
    for (const tarjeta of tarjetas) {
      const [cuotas] = await db.pool.execute(
        `SELECT id, numero_cuotas, tasa_interes, activo
         FROM tarjeta_cuotas
         WHERE tarjeta_id = ?
         ORDER BY numero_cuotas ASC`,
        [tarjeta.id],
      )

      tarjetasConDetalles.push({
        ...tarjeta,
        cuotas: cuotas,
      })
    }

    return ResponseHelper.success(res, tarjetasConDetalles)
  } catch (error) {
    logger.error("Error al obtener tarjetas:", error)
    return ResponseHelper.error(res, "Error al obtener las tarjetas", 500)
  }
}

// Obtener tarjeta con sus cuotas por ID
const obtenerTarjetaPorId = async (req, res) => {
  try {
    const { id } = req.params

    const [tarjeta] = await db.pool.execute("SELECT * FROM tarjetas_credito WHERE id = ?", [id])

    if (!tarjeta.length) {
      return ResponseHelper.notFound(res, "Tarjeta no encontrada")
    }

    const [cuotas] = await db.pool.execute(
      `SELECT id, numero_cuotas, tasa_interes, activo
       FROM tarjeta_cuotas
       WHERE tarjeta_id = ?
       ORDER BY numero_cuotas ASC`,
      [id],
    )

    return ResponseHelper.success(res, { ...tarjeta[0], cuotas })
  } catch (error) {
    logger.error("Error al obtener tarjeta:", error)
    return ResponseHelper.error(res, "Error al obtener la tarjeta", 500)
  }
}

// Crear nueva tarjeta de crédito
const crearTarjeta = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { nombre, descripcion, cuotas } = req.body

    if (!nombre || !cuotas || cuotas.length === 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "Nombre y configuración de cuotas son requeridos")
    }

    // Validar que las cuotas sean válidas
    for (const cuota of cuotas) {
      if (!cuota.numero_cuotas || cuota.tasa_interes === undefined) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Cada cuota debe tener número y tasa de interés")
      }

      if (cuota.numero_cuotas < 1 || cuota.numero_cuotas > 12) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Las cuotas deben estar entre 1 y 12")
      }
    }

    logger.info("[v0] Creando tarjeta:", { nombre, descripcion, cuotasCount: cuotas.length })

    const [result] = await connection.execute("INSERT INTO tarjetas_credito (nombre, descripcion) VALUES (?, ?)", [
      nombre,
      descripcion || null,
    ])

    const tarjeta_id = result.insertId

    // Insertar cuotas
    for (const cuota of cuotas) {
      await connection.execute(
        `INSERT INTO tarjeta_cuotas (tarjeta_id, numero_cuotas, tasa_interes, activo)
         VALUES (?, ?, ?, ?)`,
        [tarjeta_id, cuota.numero_cuotas, cuota.tasa_interes, cuota.activo !== false ? 1 : 0],
      )
    }

    await connection.commit()
    connection.release()

    const [tarjeta] = await db.pool.execute(
      `SELECT t.*, COUNT(tc.id) as total_cuotas
       FROM tarjetas_credito t
       LEFT JOIN tarjeta_cuotas tc ON t.id = tc.tarjeta_id AND tc.activo = 1
       WHERE t.id = ?
       GROUP BY t.id`,
      [tarjeta_id],
    )

    logger.info("Tarjeta creada exitosamente:", { tarjeta_id, nombre })
    return ResponseHelper.created(res, tarjeta[0], "Tarjeta creada exitosamente")
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("[v0] Error al crear tarjeta:", error)
    return ResponseHelper.error(res, `Error al crear la tarjeta: ${error.message}`, 500)
  }
}

// Actualizar tarjeta de crédito
const actualizarTarjeta = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { nombre, descripcion, cuotas } = req.body

    const [tarjetaExiste] = await connection.execute("SELECT id FROM tarjetas_credito WHERE id = ?", [id])

    if (!tarjetaExiste.length) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.notFound(res, "Tarjeta no encontrada")
    }

    logger.info("[v0] Actualizando tarjeta:", { id, nombre })

    // Actualizar datos de la tarjeta
    if (nombre || descripcion !== undefined) {
      await connection.execute("UPDATE tarjetas_credito SET nombre = ?, descripcion = ? WHERE id = ?", [
        nombre,
        descripcion || null,
        id,
      ])
    }

    // Si se envían cuotas, actualizar configuración
    if (cuotas && cuotas.length > 0) {
      // Eliminar cuotas existentes
      await connection.execute("DELETE FROM tarjeta_cuotas WHERE tarjeta_id = ?", [id])

      // Insertar nuevas cuotas
      for (const cuota of cuotas) {
        if (cuota.numero_cuotas < 1 || cuota.numero_cuotas > 12) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.validationError(res, "Las cuotas deben estar entre 1 y 12")
        }

        await connection.execute(
          `INSERT INTO tarjeta_cuotas (tarjeta_id, numero_cuotas, tasa_interes, activo)
           VALUES (?, ?, ?, ?)`,
          [id, cuota.numero_cuotas, cuota.tasa_interes, cuota.activo !== false ? 1 : 0],
        )
      }

      logger.info("[v0] Cuotas actualizadas:", { tarjeta_id: id, cuotasCount: cuotas.length })
    }

    await connection.commit()
    connection.release()

    logger.info("Tarjeta actualizada exitosamente:", { id, nombre })
    return ResponseHelper.success(res, null, "Tarjeta actualizada exitosamente")
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("[v0] Error al actualizar tarjeta:", error)
    return ResponseHelper.error(res, `Error al actualizar la tarjeta: ${error.message}`, 500)
  }
}

// Eliminar tarjeta (desactivar)
const eliminarTarjeta = async (req, res) => {
  try {
    const { id } = req.params

    const [tarjeta] = await db.pool.execute("SELECT id FROM tarjetas_credito WHERE id = ?", [id])

    if (!tarjeta.length) {
      return ResponseHelper.notFound(res, "Tarjeta no encontrada")
    }

    logger.info("[v0] Desactivando tarjeta:", { id })

    await db.pool.execute("UPDATE tarjetas_credito SET activo = 0 WHERE id = ?", [id])

    logger.info("Tarjeta desactivada exitosamente:", { id })
    return ResponseHelper.success(res, null, "Tarjeta desactivada exitosamente")
  } catch (error) {
    logger.error("[v0] Error al eliminar tarjeta:", error)
    return ResponseHelper.error(res, `Error al eliminar la tarjeta: ${error.message}`, 500)
  }
}

// Obtener solo las tarjetas y cuotas activas para ventas
const obtenerTarjetasParaVenta = async (req, res) => {
  try {
    const [tarjetas] = await db.pool.execute(
      `SELECT 
        t.id,
        t.nombre,
        t.descripcion
       FROM tarjetas_credito t
       WHERE t.activo = 1
       ORDER BY t.nombre ASC`,
    )

    const tarjetasConCuotas = []
    for (const tarjeta of tarjetas) {
      const [cuotas] = await db.pool.execute(
        `SELECT id, numero_cuotas, tasa_interes
         FROM tarjeta_cuotas
         WHERE tarjeta_id = ? AND activo = 1
         ORDER BY numero_cuotas ASC`,
        [tarjeta.id],
      )

      tarjetasConCuotas.push({
        ...tarjeta,
        cuotas: cuotas,
      })
    }

    return ResponseHelper.success(res, tarjetasConCuotas)
  } catch (error) {
    logger.error("Error al obtener tarjetas para venta:", error)
    return ResponseHelper.error(res, "Error al obtener las tarjetas", 500)
  }
}

// Obtener cuotas de una tarjeta específica
const obtenerCuotasPorTarjeta = async (req, res) => {
  try {
    const { tarjeta_id } = req.params

    const [cuotas] = await db.pool.execute(
      `SELECT id, numero_cuotas, tasa_interes
       FROM tarjeta_cuotas
       WHERE tarjeta_id = ? AND activo = 1
       ORDER BY numero_cuotas ASC`,
      [tarjeta_id],
    )

    return ResponseHelper.success(res, cuotas)
  } catch (error) {
    logger.error("Error al obtener cuotas:", error)
    return ResponseHelper.error(res, "Error al obtener las cuotas", 500)
  }
}

const obtenerTarjetasPaginadas = async (req, res) => {
  try {
    let page = Number.parseInt(req.query.page, 10) || 1
    let limit = Number.parseInt(req.query.limit, 10) || 10
    const search = req.query.search || ""

    page = page < 1 ? 1 : page
    limit = limit < 1 ? 10 : limit
    limit = Math.min(limit, 100)
    const offset = (page - 1) * limit

    let query = `
      SELECT 
        t.id,
        t.nombre,
        t.descripcion,
        t.activo,
        t.created_at,
        COUNT(tc.id) as total_cuotas
       FROM tarjetas_credito t
       LEFT JOIN tarjeta_cuotas tc ON t.id = tc.tarjeta_id AND tc.activo = 1
       WHERE t.activo = 1`
    const queryParams = []

    if (search) {
      query += " AND (t.nombre LIKE ? OR t.descripcion LIKE ?)"
      const searchParam = `%${search}%`
      queryParams.push(searchParam, searchParam)
    }

    query += ` GROUP BY t.id ORDER BY t.nombre ASC LIMIT ${limit} OFFSET ${offset}`

    const countQuery = `SELECT COUNT(*) as total FROM tarjetas_credito WHERE activo = 1${
      search ? " AND (nombre LIKE ? OR descripcion LIKE ?)" : ""
    }`

    const [tarjetas] = await db.pool.execute(query, queryParams)
    const [countResult] = await db.pool.execute(countQuery, search ? [`%${search}%`, `%${search}%`] : [])

    const tarjetasConCuotas = []
    for (const tarjeta of tarjetas) {
      const [cuotas] = await db.pool.execute(
        `SELECT id, numero_cuotas, tasa_interes, activo
         FROM tarjeta_cuotas
         WHERE tarjeta_id = ?
         ORDER BY numero_cuotas ASC`,
        [tarjeta.id],
      )
      tarjetasConCuotas.push({ ...tarjeta, cuotas })
    }

    const total = countResult[0].total
    const totalPages = Math.ceil(total / limit)

    return ResponseHelper.success(res, {
      tarjetas: tarjetasConCuotas,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    })
  } catch (error) {
    logger.error("Error al obtener tarjetas paginadas:", error)
    return ResponseHelper.error(res, "Error al obtener las tarjetas", 500)
  }
}

module.exports = {
  obtenerTarjetas,
  obtenerTarjetasPaginadas,
  obtenerTarjetaPorId,
  crearTarjeta,
  actualizarTarjeta,
  eliminarTarjeta,
  obtenerTarjetasParaVenta,
  obtenerCuotasPorTarjeta,
}
