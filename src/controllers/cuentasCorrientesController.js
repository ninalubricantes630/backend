const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")

const { sendSuccess, sendError } = ResponseHelper

// Obtener saldo de cuenta corriente de un cliente
exports.getSaldoCliente = async (req, res) => {
  const connection = await db.getConnection()
  try {
    const { clienteId } = req.params


    const [clientes] = await connection.query(`SELECT id, nombre, apellido FROM clientes WHERE id = ? AND activo = 1`, [
      clienteId,
    ])

    if (clientes.length === 0) {
      return sendError(res, "Cliente no encontrado", 404)
    }

    const [cuentas] = await connection.query(
      `SELECT cc.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido
       FROM cuentas_corrientes cc
       INNER JOIN clientes c ON cc.cliente_id = c.id
       WHERE cc.cliente_id = ? AND cc.activo = 1`,
      [clienteId],
    )

    if (cuentas.length === 0) {
      // Crear cuenta corriente automáticamente si no existe
      await connection.query(
        `INSERT INTO cuentas_corrientes (cliente_id, saldo, limite_credito, activo) 
         VALUES (?, 0, 0, 1)`,
        [clienteId],
      )

      const [newCuentas] = await connection.query(
        `SELECT cc.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido
         FROM cuentas_corrientes cc
         INNER JOIN clientes c ON cc.cliente_id = c.id
         WHERE cc.cliente_id = ?`,
        [clienteId],
      )

      logger.info(`Cuenta corriente creada automáticamente para cliente ${clienteId}`)
      return sendSuccess(res, newCuentas[0], "Cuenta corriente creada y obtenida exitosamente")
    }

    sendSuccess(res, cuentas[0], "Saldo obtenido exitosamente")
  } catch (error) {
    logger.error("Error al obtener saldo:", error)
    sendError(res, "Error al obtener saldo de cuenta corriente")
  } finally {
    connection.release()
  }
}

// Obtener historial de movimientos de cuenta corriente
exports.getMovimientos = async (req, res) => {
  const connection = await db.getConnection()
  try {
    const { clienteId } = req.params
    const { page = 1, limit = 5, tipo } = req.query
    const offset = (page - 1) * limit


    const [cuentas] = await connection.query(`SELECT id FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1`, [
      clienteId,
    ])

    if (cuentas.length === 0) {
      return sendSuccess(res, {
        movimientos: [],
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      })
    }

    const cuentaId = cuentas[0].id

    let whereClause = "WHERE m.cuenta_corriente_id = ?"
    const params = [cuentaId]

    if (tipo) {
      whereClause += " AND m.tipo = ?"
      params.push(tipo)
    }

    const [movimientos] = await connection.query(
      `SELECT m.*, 
              c.nombre as cliente_nombre, c.apellido as cliente_apellido,
              u.nombre as usuario_nombre,
              uc.nombre as cancelado_por_nombre,
              mc.sesion_caja_id,
              sc.estado as sesion_caja_estado
       FROM movimientos_cuenta_corriente m
       INNER JOIN cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
       INNER JOIN clientes c ON cc.cliente_id = c.id
       LEFT JOIN usuarios u ON m.usuario_id = u.id
       LEFT JOIN usuarios uc ON m.cancelado_por_usuario_id = uc.id
       LEFT JOIN movimientos_caja mc ON mc.referencia_tipo = 'PAGO_CUENTA_CORRIENTE' 
                                     AND mc.referencia_id = m.id
       LEFT JOIN sesiones_caja sc ON mc.sesion_caja_id = sc.id
       ${whereClause}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [...params, Number.parseInt(limit), offset],
    )


    const [totalResult] = await connection.query(
      `SELECT COUNT(*) as total
       FROM movimientos_cuenta_corriente m
       ${whereClause}`,
      params,
    )

    const total = totalResult[0].total
    const totalPages = Math.ceil(total / limit)
    const hasMore = offset + movimientos.length < total

    sendSuccess(res, {
      movimientos,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        totalPages,
        hasMore,
      },
    })
  } catch (error) {
    logger.error("Error al obtener movimientos:", error)
    sendError(res, "Error al obtener movimientos de cuenta corriente")
  } finally {
    connection.release()
  }
}

exports.registrarPago = async (req, res) => {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const { clienteId } = req.params
    const { monto, metodo_pago, observaciones, sesion_caja_id } = req.body
    const usuarioId = req.user.id


    if (!sesion_caja_id) {
      await connection.rollback()
      return sendError(res, "Debe haber una sesión de caja abierta para registrar pagos de cuenta corriente", 400)
    }

    const [sesiones] = await connection.query(`SELECT id FROM sesiones_caja WHERE id = ? AND estado = 'ABIERTA'`, [
      sesion_caja_id,
    ])

    if (sesiones.length === 0) {
      await connection.rollback()
      return sendError(
        res,
        "No hay una caja abierta. Debe abrir la caja antes de registrar pagos de cuenta corriente.",
        400,
      )
    }

    // Verificar que la cuenta corriente existe
    const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1", [
      clienteId,
    ])

    if (cuentas.length === 0) {
      await connection.rollback()
      return sendError(res, "Cuenta corriente no encontrada", 404)
    }

    const cuenta = cuentas[0]

    // Verificar que el monto sea válido
    if (Number.parseFloat(monto) <= 0) {
      await connection.rollback()
      return sendError(res, "El monto del pago debe ser mayor a cero", 400)
    }

    // Verificar que el monto no sea mayor al saldo
    if (Number.parseFloat(monto) > Number.parseFloat(cuenta.saldo)) {
      await connection.rollback()
      return sendError(res, "El monto del pago no puede ser mayor al saldo", 400)
    }

    const nuevoSaldo = Number.parseFloat(cuenta.saldo) - Number.parseFloat(monto)


    const [movimientoResult] = await connection.query(
      `INSERT INTO movimientos_cuenta_corriente 
       (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, descripcion, usuario_id, estado, metodo_pago, sesion_caja_id)
       VALUES (?, 'PAGO', ?, ?, ?, ?, ?, 'ACTIVO', ?, ?)`,
      [
        cuenta.id,
        monto,
        cuenta.saldo,
        nuevoSaldo,
        `Pago de cuenta corriente - ${metodo_pago || "EFECTIVO"} ${observaciones ? "- " + observaciones : ""}`,
        usuarioId,
        metodo_pago || "EFECTIVO",
        sesion_caja_id,
      ],
    )


    // Actualizar el saldo de la cuenta corriente
    await connection.query("UPDATE cuentas_corrientes SET saldo = ?, updated_at = NOW() WHERE id = ?", [
      nuevoSaldo,
      cuenta.id,
    ])

    const [cajaResult] = await connection.query(
      `INSERT INTO movimientos_caja 
       (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
       VALUES (?, 'INGRESO', ?, ?, ?, 'PAGO_CUENTA_CORRIENTE', ?, ?, ?)`,
      [
        sesion_caja_id,
        `Pago cuenta corriente - Cliente: ${clienteId} (${metodo_pago || "EFECTIVO"})`,
        monto,
        metodo_pago || "EFECTIVO",
        movimientoResult.insertId,
        usuarioId,
        observaciones || null,
      ],
    )


    await connection.commit()

    logger.info(`Pago de ${monto} registrado en cuenta corriente del cliente ${clienteId} y en caja`)
    sendSuccess(res, { nuevoSaldo, movimientoId: movimientoResult.insertId }, "Pago registrado exitosamente", 201)
  } catch (error) {
    await connection.rollback()
    logger.error("Error al registrar pago:", error)
    sendError(res, "Error al registrar pago en cuenta corriente")
  } finally {
    connection.release()
  }
}

exports.cancelarPago = async (req, res) => {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const { movimientoId } = req.params
    const { motivo } = req.body
    const usuarioId = req.user.id


    const [movimientos] = await connection.query(
      `SELECT m.*, cc.cliente_id, mc.sesion_caja_id, sc.estado as sesion_estado, m.metodo_pago
       FROM movimientos_cuenta_corriente m
       INNER JOIN cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
       LEFT JOIN movimientos_caja mc ON mc.referencia_tipo = 'PAGO_CUENTA_CORRIENTE' 
                                     AND mc.referencia_id = m.id
       LEFT JOIN sesiones_caja sc ON mc.sesion_caja_id = sc.id
       WHERE m.id = ? AND m.tipo = 'PAGO'`,
      [movimientoId],
    )

    if (movimientos.length === 0) {
      await connection.rollback()
      return sendError(res, "Movimiento de pago no encontrado", 404)
    }

    const movimiento = movimientos[0]

    // Verificar que el pago no esté ya cancelado
    if (movimiento.estado === "CANCELADO") {
      await connection.rollback()
      return sendError(res, "Este pago ya fue cancelado anteriormente", 400)
    }

    if (!movimiento.sesion_caja_id) {
      await connection.rollback()
      return sendError(res, "No se puede cancelar: la sesión de caja de este pago no existe", 400)
    }

    if (movimiento.sesion_estado !== "ABIERTA") {
      await connection.rollback()
      return sendError(
        res,
        "No se puede cancelar pagos de sesiones de caja cerradas. Solo se pueden cancelar pagos de la sesión actual.",
        400,
      )
    }

    // Obtener cuenta corriente actual
    const [cuentas] = await connection.query("SELECT * FROM cuentas_corrientes WHERE id = ? AND activo = 1", [
      movimiento.cuenta_corriente_id,
    ])

    if (cuentas.length === 0) {
      await connection.rollback()
      return sendError(res, "Cuenta corriente no encontrada", 404)
    }

    const cuenta = cuentas[0]
    const saldoAnterior = Number.parseFloat(cuenta.saldo)
    const montoReversion = Number.parseFloat(movimiento.monto)
    const nuevoSaldo = saldoAnterior + montoReversion


    // Crear movimiento de reversión (CARGO)
    const [reversionResult] = await connection.query(
      `INSERT INTO movimientos_cuenta_corriente 
       (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, descripcion, usuario_id, estado)
       VALUES (?, 'CARGO', ?, ?, ?, ?, ?, 'ACTIVO')`,
      [
        movimiento.cuenta_corriente_id,
        montoReversion,
        saldoAnterior,
        nuevoSaldo,
        `Reversión de pago cancelado (Movimiento #${movimientoId}) - Motivo: ${motivo || "No especificado"}`,
        usuarioId,
      ],
    )


    // Marcar el pago original como cancelado
    await connection.query(
      `UPDATE movimientos_cuenta_corriente 
       SET estado = 'CANCELADO', 
           cancelado_por_usuario_id = ?,
           fecha_cancelacion = NOW(),
           motivo_cancelacion = ?,
           movimiento_reversion_id = ?
       WHERE id = ?`,
      [usuarioId, motivo || null, reversionResult.insertId, movimientoId],
    )


    // Actualizar el saldo de la cuenta corriente
    await connection.query("UPDATE cuentas_corrientes SET saldo = ?, updated_at = NOW() WHERE id = ?", [
      nuevoSaldo,
      cuenta.id,
    ])


    await connection.query(
      `INSERT INTO movimientos_caja 
       (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
       VALUES (?, 'EGRESO', ?, ?, ?, 'CANCELACION_PAGO_CUENTA_CORRIENTE', ?, ?, ?)`,
      [
        movimiento.sesion_caja_id,
        `Cancelación de pago cuenta corriente - Cliente: ${movimiento.cliente_id}`,
        montoReversion,
        movimiento.metodo_pago || "EFECTIVO",
        movimientoId,
        usuarioId,
        motivo || "Pago cancelado",
      ],
    )

    await connection.commit()

    logger.info(`Pago ${movimientoId} cancelado por usuario ${usuarioId}. Saldo revertido: ${montoReversion}`)
    sendSuccess(res, { nuevoSaldo, movimientoReversionId: reversionResult.insertId }, "Pago cancelado exitosamente")
  } catch (error) {
    await connection.rollback()
    logger.error("Error al cancelar pago:", error)
    sendError(res, "Error al cancelar pago de cuenta corriente")
  } finally {
    connection.release()
  }
}

// Obtener clientes con cuenta corriente activa
exports.getClientesConCuentaCorriente = async (req, res) => {
  const connection = await db.getConnection()
  try {
    const { search } = req.query

    let whereClause = "WHERE cc.activo = 1"
    const params = []

    if (search) {
      whereClause += " AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.dni LIKE ?)"
      const searchParam = `%${search}%`
      params.push(searchParam, searchParam, searchParam)
    }

    const [clientes] = await connection.query(
      `SELECT c.id, c.nombre, c.apellido, c.dni, c.telefono,
              cc.saldo, cc.limite_credito
       FROM clientes c
       INNER JOIN cuentas_corrientes cc ON c.id = cc.cliente_id
       ${whereClause}
       ORDER BY c.apellido, c.nombre`,
      params,
    )

    sendSuccess(res, clientes)
  } catch (error) {
    logger.error("Error al obtener clientes con cuenta corriente:", error)
    sendError(res, "Error al obtener clientes con cuenta corriente")
  } finally {
    connection.release()
  }
}

exports.createOrUpdateCuentaCorriente = async (req, res) => {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const { clienteId } = req.params
    const { tiene_cuenta_corriente, limite_credito } = req.body

    // Verificar que el cliente existe
    const [clientes] = await connection.query("SELECT id FROM clientes WHERE id = ? AND activo = 1", [clienteId])

    if (clientes.length === 0) {
      await connection.rollback()
      return sendError(res, "Cliente no encontrado", 404)
    }

    // Buscar cuenta corriente existente
    const [cuentasExistentes] = await connection.query("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
      clienteId,
    ])

    if (tiene_cuenta_corriente) {
      // El cliente debe tener cuenta corriente
      if (cuentasExistentes.length === 0) {
        // Crear nueva cuenta corriente
        await connection.query(
          `INSERT INTO cuentas_corrientes (cliente_id, saldo, limite_credito, activo) 
           VALUES (?, 0, ?, 1)`,
          [clienteId, limite_credito || 0],
        )
        logger.info(`Cuenta corriente creada para cliente ${clienteId}`)
      } else {
        // Actualizar cuenta corriente existente
        await connection.query(
          `UPDATE cuentas_corrientes 
           SET limite_credito = ?, activo = 1, updated_at = NOW() 
           WHERE cliente_id = ?`,
          [limite_credito || 0, clienteId],
        )
        logger.info(`Cuenta corriente actualizada para cliente ${clienteId}`)
      }
    } else {
      // El cliente NO debe tener cuenta corriente
      if (cuentasExistentes.length > 0) {
        const cuenta = cuentasExistentes[0]

        // Verificar que no tenga saldo pendiente
        if (Number.parseFloat(cuenta.saldo) > 0) {
          await connection.rollback()
          return sendError(res, "No se puede desactivar la cuenta corriente porque tiene saldo pendiente", 400)
        }

        // Desactivar cuenta corriente
        await connection.query("UPDATE cuentas_corrientes SET activo = 0, updated_at = NOW() WHERE cliente_id = ?", [
          clienteId,
        ])
        logger.info(`Cuenta corriente desactivada para cliente ${clienteId}`)
      }
    }

    await connection.commit()

    // Obtener estado actualizado
    const [cuentaActualizada] = await connection.query(
      `SELECT cc.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido
       FROM cuentas_corrientes cc
       INNER JOIN clientes c ON cc.cliente_id = c.id
       WHERE cc.cliente_id = ?`,
      [clienteId],
    )

    sendSuccess(
      res,
      cuentaActualizada[0] || null,
      tiene_cuenta_corriente
        ? "Cuenta corriente configurada exitosamente"
        : "Cuenta corriente desactivada exitosamente",
    )
  } catch (error) {
    await connection.rollback()
    logger.error("Error al configurar cuenta corriente:", error)
    sendError(res, "Error al configurar cuenta corriente")
  } finally {
    connection.release()
  }
}
