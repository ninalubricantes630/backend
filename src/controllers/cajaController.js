const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")

// Obtener sesión de caja activa para una sucursal
const obtenerSesionActiva = async (req, res) => {
  try {
    const userId = req.user.id

    // Obtener sucursales del usuario
    const [usuarioSucursales] = await db.pool.execute(
      `SELECT sucursal_id, es_principal 
       FROM usuario_sucursales 
       WHERE usuario_id = ? 
       ORDER BY es_principal DESC`,
      [userId],
    )

    if (usuarioSucursales.length === 0) {
      return ResponseHelper.error(res, "Usuario no tiene sucursales asignadas", 400)
    }

    // Usar la sucursal principal o la primera si solo tiene una
    const sucursalId = usuarioSucursales[0].sucursal_id

    const [sesiones] = await db.pool.execute(
      `SELECT 
        sc.*,
        ua.nombre as usuario_apertura_nombre,
        ua.email as usuario_apertura_email,
        s.nombre as sucursal_nombre
      FROM sesiones_caja sc
      LEFT JOIN usuarios ua ON sc.usuario_apertura_id = ua.id
      LEFT JOIN sucursales s ON sc.sucursal_id = s.id
      WHERE sc.sucursal_id = ? AND sc.estado = 'ABIERTA'
      ORDER BY sc.fecha_apertura DESC
      LIMIT 1`,
      [sucursalId],
    )

    if (sesiones.length === 0) {
      return ResponseHelper.success(res, null, "No hay sesión de caja abierta")
    }

    return ResponseHelper.success(res, sesiones[0], "Sesión de caja activa obtenida")
  } catch (error) {
    logger.error("Error al obtener sesión activa:", error)
    return ResponseHelper.error(res, "Error al obtener sesión de caja activa", 500)
  }
}

// Abrir caja
const abrirCaja = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { sucursalId, montoInicial, observaciones } = req.body
    const usuarioId = req.user.id

    if (!sucursalId) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "El ID de sucursal es requerido")
    }

    if (montoInicial === undefined || montoInicial === null) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "El monto inicial es requerido")
    }

    if (Number.parseFloat(montoInicial) < 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "El monto inicial no puede ser negativo")
    }

    const observacionesValue = observaciones || null

    // Crear nueva sesión de caja
    const [result] = await connection.execute(
      `INSERT INTO sesiones_caja 
        (sucursal_id, usuario_apertura_id, monto_inicial, observaciones_apertura, estado) 
      VALUES (?, ?, ?, ?, 'ABIERTA')`,
      [sucursalId, usuarioId, montoInicial, observacionesValue],
    )

    const sesionId = result.insertId

    await connection.commit()

    // Obtener la sesión completa
    const [sesion] = await db.pool.execute(
      `SELECT 
        sc.*,
        ua.nombre as usuario_apertura_nombre,
        s.nombre as sucursal_nombre
      FROM sesiones_caja sc
      LEFT JOIN usuarios ua ON sc.usuario_apertura_id = ua.id
      LEFT JOIN sucursales s ON sc.sucursal_id = s.id
      WHERE sc.id = ?`,
      [sesionId],
    )

    connection.release()
    return ResponseHelper.success(res, sesion[0], "Caja abierta exitosamente", 201)
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("Error al abrir caja:", error)
    return ResponseHelper.error(res, "Error al abrir caja", 500)
  }
}

// Cerrar caja
const cerrarCaja = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id: sesionId } = req.params
    const { montoFinal, observaciones } = req.body
    const usuarioId = req.user.id

    if (montoFinal === undefined || montoFinal === null) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "El monto final es requerido")
    }

    // Verificar que la sesión existe y está abierta
    const [sesiones] = await connection.execute(
      `SELECT monto_inicial FROM sesiones_caja WHERE id = ? AND estado = 'ABIERTA'`,
      [sesionId],
    )

    if (sesiones.length === 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.error(res, "Sesión de caja no encontrada o ya cerrada", 404)
    }

    const montoInicial = Number.parseFloat(sesiones[0].monto_inicial) || 0

    const [movimientos] = await connection.execute(
      `SELECT 
        SUM(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN monto ELSE 0 END) as total_ingresos,
        SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) as total_egresos
      FROM movimientos_caja 
      WHERE sesion_caja_id = ? AND estado = 'ACTIVO'`,
      [sesionId],
    )

    const totalIngresos = Number.parseFloat(movimientos[0].total_ingresos) || 0
    const totalEgresos = Number.parseFloat(movimientos[0].total_egresos) || 0

    const montoEsperado = montoInicial + totalIngresos - totalEgresos
    const montoFinalNum = Number.parseFloat(montoFinal)
    const diferencia = montoFinalNum - montoEsperado

    const [ingresosDesglose] = await connection.execute(
      `SELECT 
        metodo_pago,
        SUM(monto) as total,
        COUNT(*) as cantidad
      FROM movimientos_caja
      WHERE sesion_caja_id = ? 
        AND tipo = 'INGRESO'
        AND concepto != 'Apertura de caja'
        AND estado = 'ACTIVO'
      GROUP BY metodo_pago`,
      [sesionId],
    )

    // Consolidar desglose
    const consolidado = {}
    ingresosDesglose.forEach((item) => {
      const metodo = item.metodo_pago || "EFECTIVO"
      consolidado[metodo] = {
        total: Number.parseFloat(item.total) || 0,
        cantidad: Number.parseInt(item.cantidad) || 0,
      }
    })

    const desgloseIngresos = JSON.stringify(consolidado)

    const observacionesValue = observaciones || null

    await connection.execute(
      `UPDATE sesiones_caja 
      SET usuario_cierre_id = ?, 
          monto_final = ?, 
          monto_esperado_sistema = ?,
          total_ingresos = ?,
          total_egresos = ?,
          diferencia = ?,
          desglose_ingresos = ?,
          fecha_cierre = NOW(), 
          estado = 'CERRADA',
          observaciones_cierre = ?
      WHERE id = ?`,
      [
        usuarioId,
        montoFinalNum,
        montoEsperado,
        totalIngresos,
        totalEgresos,
        diferencia,
        desgloseIngresos,
        observacionesValue,
        sesionId,
      ],
    )

    await connection.commit()

    // Obtener la sesión completa
    const [sesion] = await db.pool.execute(
      `SELECT 
        sc.*,
        ua.nombre as usuario_apertura_nombre,
        uc.nombre as usuario_cierre_nombre,
        s.nombre as sucursal_nombre
      FROM sesiones_caja sc
      LEFT JOIN usuarios ua ON sc.usuario_apertura_id = ua.id
      LEFT JOIN usuarios uc ON sc.usuario_cierre_id = uc.id
      LEFT JOIN sucursales s ON sc.sucursal_id = s.id
      WHERE sc.id = ?`,
      [sesionId],
    )

    connection.release()
    return ResponseHelper.success(res, sesion[0], "Caja cerrada exitosamente")
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("Error al cerrar caja:", error)
    return ResponseHelper.error(res, "Error al cerrar caja", 500)
  }
}

// Obtener historial de sesiones de caja
const obtenerHistorialSesiones = async (req, res) => {
  try {
    const { page = 1, limit = 10, sucursalId, estado, fechaDesde, fechaHasta } = req.query

    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    const whereConditions = []
    const queryParams = []

    if (sucursalId) {
      whereConditions.push("sc.sucursal_id = ?")
      queryParams.push(sucursalId)
    }

    if (estado) {
      whereConditions.push("sc.estado = ?")
      queryParams.push(estado)
    }

    if (fechaDesde) {
      whereConditions.push("DATE(sc.fecha_apertura) >= ?")
      queryParams.push(fechaDesde)
    }

    if (fechaHasta) {
      whereConditions.push("DATE(sc.fecha_apertura) <= ?")
      queryParams.push(fechaHasta)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Obtener total de registros
    const [totalResult] = await db.pool.execute(
      `SELECT COUNT(*) as total FROM sesiones_caja sc ${whereClause}`,
      queryParams,
    )

    const total = totalResult[0].total

    // Obtener sesiones
    const [sesiones] = await db.pool.execute(
      `SELECT 
        sc.*,
        ua.nombre as usuario_apertura_nombre,
        uc.nombre as usuario_cierre_nombre,
        s.nombre as sucursal_nombre,
        (SELECT COUNT(*) FROM movimientos_caja WHERE sesion_caja_id = sc.id) as total_movimientos
      FROM sesiones_caja sc
      LEFT JOIN usuarios ua ON sc.usuario_apertura_id = ua.id
      LEFT JOIN usuarios uc ON sc.usuario_cierre_id = uc.id
      LEFT JOIN sucursales s ON sc.sucursal_id = s.id
      ${whereClause}
      ORDER BY sc.fecha_apertura DESC
      LIMIT ${Number.parseInt(limit)} OFFSET ${offset}`,
      queryParams,
    )

    return ResponseHelper.success(res, {
      sesiones,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        totalPages: Math.ceil(total / Number.parseInt(limit)),
      },
    })
  } catch (error) {
    logger.error("Error al obtener historial de sesiones:", error)
    return ResponseHelper.error(res, "Error al obtener historial de sesiones", 500)
  }
}

// Obtener movimientos de una sesión
const obtenerMovimientos = async (req, res) => {
  try {
    const { id: sesionId } = req.params
    const { page = 1, limit = 50, tipo } = req.query

    const pageNum = Number.parseInt(page) || 1
    const limitNum = Number.parseInt(limit) || 50
    const offset = (pageNum - 1) * limitNum

    const whereConditions = ["mc.sesion_caja_id = ?"]
    const queryParams = [sesionId]

    if (tipo) {
      whereConditions.push("mc.tipo = ?")
      queryParams.push(tipo)
    }

    const whereClause = whereConditions.join(" AND ")

    // Obtener total de registros
    const [totalResult] = await db.pool.execute(
      `SELECT COUNT(*) as total FROM movimientos_caja mc WHERE ${whereClause}`,
      queryParams,
    )

    const total = totalResult[0].total

    // Obtener movimientos
    const [movimientos] = await db.pool.execute(
      `SELECT 
        mc.*,
        u.nombre as usuario_nombre
      FROM movimientos_caja mc
      LEFT JOIN usuarios u ON mc.usuario_id = u.id
      WHERE ${whereClause}
      ORDER BY mc.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}`,
      queryParams,
    )

    // Obtener resumen
    const [resumen] = await db.pool.execute(
      `SELECT 
        SUM(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN monto ELSE 0 END) as total_ingresos,
        SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) as total_egresos,
        COUNT(*) as total_movimientos
      FROM movimientos_caja 
      WHERE sesion_caja_id = ?`,
      [sesionId],
    )

    return ResponseHelper.success(res, {
      movimientos,
      resumen: resumen[0],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    })
  } catch (error) {
    logger.error("Error al obtener movimientos:", error)
    return ResponseHelper.error(res, "Error al obtener movimientos", 500)
  }
}

// Registrar movimiento manual
const registrarMovimiento = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { sesionId, tipo, concepto, monto, metodoPago = "EFECTIVO", observaciones } = req.body
    const usuarioId = req.user.id

    if (!sesionId || !tipo || !concepto || monto === undefined || monto === null) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "Todos los campos son requeridos: sesionId, tipo, concepto, monto")
    }

    // Verificar que la sesión existe y está abierta
    const [sesiones] = await connection.execute("SELECT id FROM sesiones_caja WHERE id = ? AND estado = 'ABIERTA'", [
      sesionId,
    ])

    if (sesiones.length === 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.error(res, "Sesión de caja no encontrada o cerrada", 404)
    }

    const observacionesValue = observaciones || null

    const [result] = await connection.execute(
      `INSERT INTO movimientos_caja 
        (sesion_caja_id, tipo, concepto, monto, metodo_pago, estado, referencia_tipo, usuario_id, observaciones) 
      VALUES (?, ?, ?, ?, ?, 'ACTIVO', 'MANUAL', ?, ?)`,
      [sesionId, tipo, concepto, monto, metodoPago, usuarioId, observacionesValue],
    )

    await connection.commit()

    // Obtener el movimiento completo
    const [movimiento] = await db.pool.execute(
      `SELECT 
        mc.*,
        u.nombre as usuario_nombre
      FROM movimientos_caja mc
      LEFT JOIN usuarios u ON mc.usuario_id = u.id
      WHERE mc.id = ?`,
      [result.insertId],
    )

    connection.release()
    return ResponseHelper.success(res, movimiento[0], "Movimiento registrado exitosamente", 201)
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("Error al registrar movimiento:", error)
    return ResponseHelper.error(res, "Error al registrar movimiento", 500)
  }
}

// Obtener detalle de una sesión
const obtenerDetalleSesion = async (req, res) => {
  try {
    const { id: sesionId } = req.params

    // Obtener sesión
    const [sesiones] = await db.pool.execute(
      `SELECT 
        sc.*,
        ua.nombre as usuario_apertura_nombre,
        ua.email as usuario_apertura_email,
        uc.nombre as usuario_cierre_nombre,
        uc.email as usuario_cierre_email,
        s.nombre as sucursal_nombre,
        s.ubicacion as sucursal_ubicacion
      FROM sesiones_caja sc
      LEFT JOIN usuarios ua ON sc.usuario_apertura_id = ua.id
      LEFT JOIN usuarios uc ON sc.usuario_cierre_id = uc.id
      LEFT JOIN sucursales s ON sc.sucursal_id = s.id
      WHERE sc.id = ?`,
      [sesionId],
    )

    if (sesiones.length === 0) {
      return ResponseHelper.error(res, "Sesión no encontrada", 404)
    }

    // Obtener resumen de movimientos
    const [resumen] = await db.pool.execute(
      `SELECT 
        SUM(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN monto ELSE 0 END) as total_ingresos,
        SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) as total_egresos,
        COUNT(*) as total_movimientos,
        COUNT(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN 1 END) as cantidad_ingresos,
        COUNT(CASE WHEN tipo = 'EGRESO' THEN 1 END) as cantidad_egresos
      FROM movimientos_caja 
      WHERE sesion_caja_id = ? AND estado = 'ACTIVO'`,
      [sesionId],
    )

    return ResponseHelper.success(res, {
      sesion: sesiones[0],
      resumen: resumen[0],
    })
  } catch (error) {
    logger.error("Error al obtener detalle de sesión:", error)
    return ResponseHelper.error(res, "Error al obtener detalle de sesión", 500)
  }
}

// Obtener detalle de ingresos para una sesión
const obtenerDetalleIngresos = async (req, res) => {
  try {
    const { id: sesionId } = req.params

    // Verificar que la sesión existe
    const [sesiones] = await db.pool.execute(`SELECT id FROM sesiones_caja WHERE id = ?`, [sesionId])

    if (sesiones.length === 0) {
      return ResponseHelper.error(res, "Sesión no encontrada", 404)
    }

    const [ingresos] = await db.pool.execute(
      `SELECT 
        COALESCE(metodo_pago, 'EFECTIVO') as metodo_pago,
        SUM(monto) as total,
        COUNT(*) as cantidad
      FROM movimientos_caja
      WHERE sesion_caja_id = ? 
        AND tipo = 'INGRESO'
        AND concepto != 'Apertura de caja'
        AND estado = 'ACTIVO'
      GROUP BY metodo_pago
      ORDER BY total DESC`,
      [sesionId],
    )

    console.log("[v0] Backend - obtenerDetalleIngresos raw query result:", ingresos)

    // Calcular total
    const totalIngresos = ingresos.reduce((sum, item) => sum + (Number.parseFloat(item.total) || 0), 0)

    // Formatear respuesta
    const desglose = ingresos.map((item) => ({
      metodo_pago: item.metodo_pago || "EFECTIVO",
      total: Number.parseFloat(item.total) || 0,
      cantidad: Number.parseInt(item.cantidad) || 0,
    }))

    const resultado = {
      total_general: totalIngresos,
      desglose: desglose,
    }

    console.log("[v0] Backend - obtenerDetalleIngresos final result:", resultado)

    return ResponseHelper.success(res, resultado)
  } catch (error) {
    console.error("[v0] Backend - Error al obtener detalle de ingresos:", error)
    logger.error("Error al obtener detalle de ingresos:", error)
    return ResponseHelper.error(res, "Error al obtener detalle de ingresos", 500)
  }
}

// Obtener resumen de caja actual
const obtenerResumenCaja = async (req, res) => {
  try {
    const { id: sesionId } = req.params

    // Verificar que la sesión existe
    const [sesiones] = await db.pool.execute(
      `SELECT monto_inicial FROM sesiones_caja WHERE id = ? AND estado = 'ABIERTA'`,
      [sesionId],
    )

    if (sesiones.length === 0) {
      return ResponseHelper.error(res, "Sesión no encontrada o cerrada", 404)
    }

    const montoInicial = Number.parseFloat(sesiones[0].monto_inicial) || 0

    const [resumen] = await db.pool.execute(
      `SELECT 
        SUM(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN monto ELSE 0 END) as total_ingresos,
        SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) as total_egresos,
        COUNT(CASE WHEN tipo = 'INGRESO' AND concepto != 'Apertura de caja' THEN 1 END) as cantidad_ingresos,
        COUNT(CASE WHEN tipo = 'EGRESO' THEN 1 END) as cantidad_egresos
      FROM movimientos_caja 
      WHERE sesion_caja_id = ? AND estado = 'ACTIVO'`,
      [sesionId],
    )

    const totalIngresos = Number.parseFloat(resumen[0].total_ingresos) || 0
    const totalEgresos = Number.parseFloat(resumen[0].total_egresos) || 0
    const montoActual = montoInicial + totalIngresos - totalEgresos

    const [desglose] = await db.pool.execute(
      `SELECT 
        COALESCE(metodo_pago, 'EFECTIVO') as metodo_pago,
        SUM(monto) as total,
        COUNT(*) as cantidad
      FROM movimientos_caja
      WHERE sesion_caja_id = ? 
        AND tipo = 'INGRESO'
        AND concepto != 'Apertura de caja'
        AND estado = 'ACTIVO'
      GROUP BY metodo_pago
      ORDER BY total DESC`,
      [sesionId],
    )

    const desgloseFormateado = desglose.map((item) => ({
      metodoPago: item.metodo_pago || "EFECTIVO",
      total: Number.parseFloat(item.total) || 0,
      cantidad: Number.parseInt(item.cantidad) || 0,
      porcentaje: totalIngresos > 0 ? ((Number.parseFloat(item.total) || 0) / totalIngresos) * 100 : 0,
    }))

    return ResponseHelper.success(res, {
      montoInicial,
      totalIngresos,
      totalEgresos,
      montoActual,
      cantidadIngresos: Number.parseInt(resumen[0].cantidad_ingresos) || 0,
      cantidadEgresos: Number.parseInt(resumen[0].cantidad_egresos) || 0,
      desgloseIngresos: desgloseFormateado,
    })
  } catch (error) {
    logger.error("Error al obtener resumen de caja:", error)
    return ResponseHelper.error(res, "Error al obtener resumen de caja", 500)
  }
}

module.exports = {
  obtenerSesionActiva,
  abrirCaja,
  cerrarCaja,
  obtenerHistorialSesiones,
  obtenerMovimientos,
  registrarMovimiento,
  obtenerDetalleSesion,
  obtenerDetalleIngresos,
  obtenerResumenCaja, // Exportando nueva función
}
