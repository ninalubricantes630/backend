const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")

const getDefaultClientId = async (connection) => {
  try {
    const [defaultClients] = await connection.execute(
      "SELECT id FROM clientes WHERE (nombre = 'Consumidor' AND apellido = 'Final') OR (LOWER(CONCAT(nombre, ' ', apellido)) = 'consumidor final') AND activo = 1 LIMIT 1",
    )

    if (defaultClients.length > 0) {
      const clientId = defaultClients[0].id
      return clientId
    }

    const [result] = await connection.execute(
      `INSERT INTO clientes (nombre, apellido, dni, telefono, direccion, activo) 
       VALUES ('Consumidor', 'Final', NULL, NULL, 'Sin dirección especificada', 1)`,
    )

    const newClientId = result.insertId
    return newClientId
  } catch (error) {
    console.error("[v0] Error getting/creating default client:", error) // Usar console.error
    throw error
  }
}

// Crear una nueva venta
const crearVenta = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    let {
      cliente_id,
      sucursal_id,
      items,
      tipo_pago,
      descuento = 0,
      interes_sistema = 0,
      tipo_interes_sistema,
      valor_interes_sistema = 0,
      observaciones,
      tarjeta_id,
      numero_cuotas,
      total_con_interes,
      total_con_interes_tarjeta,
      interes_tarjeta = 0,
      tasa_interes_tarjeta,
      // Campos para pago dividido
      pago_dividido,
      monto_pago_1,
      tipo_pago_2,
      monto_pago_2,
      tarjeta_id_2,
      numero_cuotas_2,
      tasa_interes_tarjeta_2,
    } = req.body
    const usuario_id = req.user.id

    // Convertir pago_dividido a boolean (puede venir como string "true"/"false")
    const esPagoDividido = pago_dividido === true || pago_dividido === "true" || pago_dividido === 1

    console.log("[v0] Datos recibidos pago dividido:", {
      pago_dividido,
      esPagoDividido,
      tipo_pago,
      tipo_pago_2,
      monto_pago_1,
      monto_pago_2
    })

    // Formato: V-YYYYMMDD-XXX (donde XXX es secuencial del día)
    const fecha = new Date()
    const año = fecha.getFullYear()
    const mes = String(fecha.getMonth() + 1).padStart(2, "0")
    const dia = String(fecha.getDate()).padStart(2, "0")
    const fechaStr = `${año}${mes}${dia}`

    // Obtener el último número de venta del día
    const [ultimaVenta] = await connection.execute(
      `SELECT numero FROM ventas 
       WHERE numero LIKE ? 
       ORDER BY numero DESC 
       LIMIT 1`,
      [`V-${fechaStr}-%`],
    )

    let secuencial = 1
    if (ultimaVenta.length > 0) {
      // Extraer el secuencial del último número: V-20251120-001 -> 001
      const ultimoNumero = ultimaVenta[0].numero
      const partes = ultimoNumero.split("-")
      if (partes.length === 3) {
        secuencial = Number.parseInt(partes[2]) + 1
      }
    }

    const numero = `V-${fechaStr}-${String(secuencial).padStart(3, "0")}`

    observaciones = observaciones || null

    tipo_pago = tipo_pago ? tipo_pago.toUpperCase().trim() : ""

    if ((!tipo_pago || tipo_pago === "") && tarjeta_id && numero_cuotas) {
      tipo_pago = "TARJETA_CREDITO"
    }

    if (!tipo_pago || tipo_pago === "") {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "El tipo de pago es requerido y no puede estar vacío")
    }

    const tiposPagoValidos = ["EFECTIVO", "TARJETA_CREDITO", "TRANSFERENCIA", "CUENTA_CORRIENTE", "PAGO_MULTIPLE"]
    if (!tiposPagoValidos.includes(tipo_pago)) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(
        res,
        `Tipo de pago inválido. Valores permitidos: ${tiposPagoValidos.join(", ")}`,
      )
    }

    if (!cliente_id || cliente_id === null || cliente_id === 0 || cliente_id === "") {
      cliente_id = await getDefaultClientId(connection)

      if (!cliente_id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.error(res, "No se pudo obtener o crear el cliente por defecto", 500)
      }
    }

    if (tipo_pago === "CUENTA_CORRIENTE") {
      const [defaultClient] = await connection.execute(
        "SELECT id FROM clientes WHERE (nombre = 'Consumidor' AND apellido = 'Final') OR (LOWER(CONCAT(nombre, ' ', apellido)) = 'consumidor final') AND activo = 1 LIMIT 1",
      )

      if (defaultClient.length > 0 && cliente_id === defaultClient[0].id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Debe seleccionar un cliente específico para cuenta corriente")
      }
    }

    if (tipo_pago === "TARJETA_CREDITO") {
      if (!tarjeta_id || !numero_cuotas) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Para pago con crédito debe seleccionar tarjeta y cuotas")
      }
    }

    if (!items || items.length === 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "Debe agregar al menos un producto")
    }

    for (const item of items) {
      if (!item.producto_id || !item.cantidad || item.precio_unitario === undefined) {
        logger.error("[v0] Item inválido:", item)
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Datos de producto incompletos en el carrito")
      }
    }

    if (tipo_pago === "TARJETA_CREDITO") {
      const [tarjeta] = await connection.execute("SELECT id FROM tarjetas_credito WHERE id = ? AND activo = 1", [
        tarjeta_id,
      ])

      if (!tarjeta.length) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Tarjeta de crédito no válida")
      }

      const [cuota] = await connection.execute(
        "SELECT id, tasa_interes FROM tarjeta_cuotas WHERE tarjeta_id = ? AND numero_cuotas = ? AND activo = 1",
        [tarjeta_id, numero_cuotas],
      )

      if (!cuota.length) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Opción de cuotas no válida para esta tarjeta")
      }

      logger.info("[v0] Crédito validado:", { tarjeta_id, numero_cuotas })
    }

    if (!sucursal_id) {
      const [userSucursales] = await connection.execute(
        `SELECT sucursal_id FROM usuario_sucursales 
         WHERE usuario_id = ? AND es_principal = 1 
         LIMIT 1`,
        [usuario_id],
      )

      if (userSucursales.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Usuario sin sucursal asignada")
      }

      sucursal_id = userSucursales[0].sucursal_id
    }

    const [userHasSucursal] = await connection.execute(
      `SELECT 1 FROM usuario_sucursales 
       WHERE usuario_id = ? AND sucursal_id = ?`,
      [usuario_id, sucursal_id],
    )

    if (userHasSucursal.length === 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.forbidden(res, "No tienes acceso a esta sucursal")
    }

    const [sesionCaja] = await connection.execute(
      `SELECT id FROM sesiones_caja 
       WHERE sucursal_id = ? AND estado = 'ABIERTA' 
       LIMIT 1`,
      [sucursal_id],
    )

    if (sesionCaja.length === 0) {
      await connection.rollback()
      connection.release()
      logger.error("[v0] No hay caja abierta para la sucursal:", sucursal_id)
      return ResponseHelper.validationError(
        res,
        "No hay una caja abierta en esta sucursal. Debe abrir la caja antes de realizar ventas.",
      )
    }

    // Calcular subtotal y validar productos
    let subtotal = 0
    for (const item of items) {
      const [producto] = await connection.execute(
        "SELECT stock, precio, sucursal_id, nombre, unidad_medida FROM productos WHERE id = ? AND activo = 1",
        [item.producto_id],
      )

      if (!producto.length) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, `Producto ${item.producto_id} no encontrado o inactivo`)
      }

      if (producto[0].sucursal_id !== sucursal_id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(
          res,
          `El producto ${producto[0].nombre} no pertenece a la sucursal seleccionada`,
        )
      }

      const cantidadNum = Number.parseFloat(item.cantidad)
      const stockNum = Number.parseFloat(producto[0].stock)
      const unidad_medida = producto[0].unidad_medida || "unidad"

      if (unidad_medida === "unidad" && !Number.isInteger(cantidadNum)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(
          res,
          `La cantidad para el producto ${producto[0].nombre} debe ser un número entero`,
        )
      }

      // El stock puede quedar en negativo después de la venta

      item._unidad_medida = unidad_medida
      item._cantidad_numerica = cantidadNum
      item._stock_anterior = stockNum

      subtotal += Number.parseFloat(item.precio_unitario) * cantidadNum
    }

    const descuentoNum = Number.parseFloat(descuento) || 0
    if (descuentoNum > 0 && valor_interes_sistema && Number.parseFloat(valor_interes_sistema) > 0) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(
        res,
        "No se puede aplicar descuento e interés del sistema simultáneamente. Por favor, selecciona solo uno de ellos.",
      )
    }

    const baseCalculoInteres = subtotal - descuentoNum // Base para calcular interés

    let interesSistemaPorcentaje = 0
    let interesSistemaMonto = 0

    // Si hay interés del sistema, calcularlo según el tipo
    if (valor_interes_sistema && Number.parseFloat(valor_interes_sistema) > 0) {
      const valorInteres = Number.parseFloat(valor_interes_sistema)

      if (tipo_interes_sistema === "porcentaje") {
        // Es un porcentaje - Calcular sobre subtotal directo (sin descuento, ya que no pueden coexistir)
        interesSistemaPorcentaje = valorInteres
        interesSistemaMonto = (subtotal * valorInteres) / 100
      } else {
        // Es un monto fijo
        interesSistemaMonto = valorInteres
        // Calcular el porcentaje equivalente
        interesSistemaPorcentaje = subtotal > 0 ? (valorInteres / subtotal) * 100 : 0
      }
    }

    const totalBase = subtotal - descuentoNum + interesSistemaMonto

    let interesTarjetaPorcentaje = 0
    let interesTarjetaMonto = 0
    let totalConInteresTarjetaFinal = null
    let totalFinalCaja = totalBase

    if (tipo_pago === "TARJETA_CREDITO" && tarjeta_id && numero_cuotas && Number.parseInt(numero_cuotas) > 1) {
      interesTarjetaPorcentaje = Number.parseFloat(tasa_interes_tarjeta) || 0
      interesTarjetaMonto = (totalBase * interesTarjetaPorcentaje) / 100
      totalConInteresTarjetaFinal = totalBase + interesTarjetaMonto
      totalFinalCaja = totalConInteresTarjetaFinal
    }

    if (tipo_pago === "CUENTA_CORRIENTE") {
      let [cuentaCorriente] = await connection.execute(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [cliente_id],
      )

      if (cuentaCorriente.length === 0) {
        logger.info("[v0] Cuenta corriente no existe, creando automáticamente para cliente:", cliente_id)

        await connection.execute(
          `INSERT INTO cuentas_corrientes (cliente_id, saldo, limite_credito, activo) 
           VALUES (?, 0, 0, 1)`,
          [cliente_id],
        )
        ;[cuentaCorriente] = await connection.execute(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [cliente_id],
        )

        logger.info("[v0] Cuenta corriente creada exitosamente")
      }

      const nuevoSaldo = Number.parseFloat(cuentaCorriente[0].saldo) + totalBase
      const limiteCredito = Number.parseFloat(cuentaCorriente[0].limite_credito)

      if (limiteCredito > 0 && nuevoSaldo > limiteCredito) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(
          res,
          `Límite de crédito excedido. Límite: ${limiteCredito}, Saldo actual: ${cuentaCorriente[0].saldo}, Nuevo saldo sería: ${nuevoSaldo}`,
        )
      }
    }

    // Determinar el tipo de pago para guardar en la base de datos
    const tipoPagoFinal = esPagoDividido ? 'PAGO_MULTIPLE' : tipo_pago
    const tipoPago2Upper = tipo_pago_2 ? tipo_pago_2.toUpperCase() : null

    console.log("[v0] Guardando venta con tipo_pago:", tipoPagoFinal, "esPagoDividido:", esPagoDividido)

    let ventaResult
    try {
      // Intenta insertar con las nuevas columnas de pago dividido
      ;[ventaResult] = await connection.execute(
        `INSERT INTO ventas (
          numero, sucursal_id, cliente_id, tipo_pago, tarjeta_id, numero_cuotas,
          subtotal, descuento, interes_sistema_porcentaje, interes_sistema_monto,
          total, interes_tarjeta_porcentaje, interes_tarjeta_monto, total_con_interes_tarjeta,
          estado, observaciones, usuario_id, sesion_caja_id,
          pago_dividido, tipo_pago_2, monto_pago_1, monto_pago_2, tarjeta_id_2, numero_cuotas_2
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          numero,
          sucursal_id,
          cliente_id,
          tipoPagoFinal,
          tarjeta_id || null,
          numero_cuotas || null,
          Number(subtotal).toFixed(2),
          Number(descuentoNum).toFixed(2),
          Number(interesSistemaPorcentaje).toFixed(2),
          Number(interesSistemaMonto).toFixed(2),
          Number(totalBase).toFixed(2),
          Number(interesTarjetaPorcentaje).toFixed(2),
          Number(interesTarjetaMonto).toFixed(2),
          totalConInteresTarjetaFinal ? Number(totalConInteresTarjetaFinal).toFixed(2) : null,
          "COMPLETADA",
          observaciones,
          usuario_id,
          sesionCaja[0].id,
          esPagoDividido ? 1 : 0,
          tipoPago2Upper,
          esPagoDividido ? Number(monto_pago_1).toFixed(2) : null,
          esPagoDividido ? Number(monto_pago_2).toFixed(2) : null,
          tarjeta_id_2 || null,
          numero_cuotas_2 || null,
        ],
      )
    } catch (insertError) {
      // Si falla por columnas no existentes, usar el método antiguo
      console.log("[v0] Insertando venta sin columnas de pago dividido (migración pendiente):", insertError.message)
      ;[ventaResult] = await connection.execute(
        `INSERT INTO ventas (
          numero, sucursal_id, cliente_id, tipo_pago, tarjeta_id, numero_cuotas,
          subtotal, descuento, interes_sistema_porcentaje, interes_sistema_monto,
          total, interes_tarjeta_porcentaje, interes_tarjeta_monto, total_con_interes_tarjeta,
          estado, observaciones, usuario_id, sesion_caja_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          numero,
          sucursal_id,
          cliente_id,
          tipo_pago, // Usar el tipo_pago original (primer método) si PAGO_MULTIPLE no está soportado
          tarjeta_id || null,
          numero_cuotas || null,
          Number(subtotal).toFixed(2),
          Number(descuentoNum).toFixed(2),
          Number(interesSistemaPorcentaje).toFixed(2),
          Number(interesSistemaMonto).toFixed(2),
          Number(totalBase).toFixed(2),
          Number(interesTarjetaPorcentaje).toFixed(2),
          Number(interesTarjetaMonto).toFixed(2),
          totalConInteresTarjetaFinal ? Number(totalConInteresTarjetaFinal).toFixed(2) : null,
          "COMPLETADA",
          observaciones,
          usuario_id,
          sesionCaja[0].id,
        ],
      )
    }

    const venta_id = ventaResult.insertId

    for (const item of items) {
      const cantidadNum = item._cantidad_numerica
      const unidad_medida = item._unidad_medida
      const stockAnterior = item._stock_anterior
      const stockNuevo = stockAnterior - cantidadNum

      // Insertar detalle de venta
      await connection.execute(
        `INSERT INTO detalle_ventas (venta_id, producto_id, unidad_medida, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          venta_id,
          item.producto_id,
          unidad_medida,
          cantidadNum,
          item.precio_unitario,
          Number.parseFloat(item.precio_unitario) * cantidadNum,
        ],
      )

      // Actualizar stock del producto
      await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [stockNuevo, item.producto_id])

      // Registrar movimiento de stock con el usuario que realizó la venta
      await connection.execute(
        `INSERT INTO movimientos_stock (
          producto_id,
          tipo,
          unidad_medida,
          cantidad,
          stock_anterior,
          stock_nuevo,
          motivo,
          referencia_tipo,
          referencia_id,
          usuario_id
        ) VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, 'VENTA', ?, ?)`,
        [
          item.producto_id,
          unidad_medida,
          cantidadNum,
          stockAnterior,
          stockNuevo,
          `Venta ${numero}`,
          venta_id,
          usuario_id,
        ],
      )
    }

    if (tipo_pago === "CUENTA_CORRIENTE") {
      const [cuentaCorriente] = await connection.execute("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
        cliente_id,
      ])

      const saldoAnterior = Number.parseFloat(cuentaCorriente[0].saldo)
      const saldoNuevo = saldoAnterior + totalBase

      await connection.execute("UPDATE cuentas_corrientes SET saldo = ? WHERE id = ?", [
        saldoNuevo,
        cuentaCorriente[0].id,
      ])

      await connection.execute(
        `INSERT INTO movimientos_cuenta_corriente (
          cuenta_corriente_id, 
          tipo, 
          monto, 
          saldo_anterior, 
          saldo_nuevo, 
          descripcion, 
          referencia_tipo, 
          referencia_id, 
          usuario_id
        ) VALUES (?, 'CARGO', ?, ?, ?, ?, 'VENTA', ?, ?)`,
        [cuentaCorriente[0].id, totalBase, saldoAnterior, saldoNuevo, `Venta ${numero}`, venta_id, usuario_id],
      )
    } else {
      // Verificar si es pago dividido
      if (esPagoDividido && tipo_pago_2 && monto_pago_1 && monto_pago_2) {
        console.log("[v0] Registrando movimientos de caja para pago dividido:", {
          tipo_pago,
          tipo_pago_2,
          monto_pago_1,
          monto_pago_2
        })
        
        // Registrar primer movimiento de caja
        await connection.execute(
          `INSERT INTO movimientos_caja (
            sesion_caja_id, 
            tipo, 
            concepto, 
            monto, 
            metodo_pago,
            referencia_tipo, 
            referencia_id, 
            usuario_id
          ) VALUES (?, 'INGRESO', ?, ?, ?, 'VENTA', ?, ?)`,
          [sesionCaja[0].id, `Venta ${numero} - ${tipo_pago} (Pago 1/2)`, monto_pago_1, tipo_pago, venta_id, usuario_id],
        )

        // Registrar segundo movimiento de caja
        await connection.execute(
          `INSERT INTO movimientos_caja (
            sesion_caja_id, 
            tipo, 
            concepto, 
            monto, 
            metodo_pago,
            referencia_tipo, 
            referencia_id, 
            usuario_id
          ) VALUES (?, 'INGRESO', ?, ?, ?, 'VENTA', ?, ?)`,
          [sesionCaja[0].id, `Venta ${numero} - ${tipo_pago_2} (Pago 2/2)`, monto_pago_2, tipo_pago_2, venta_id, usuario_id],
        )
      } else {
        // Pago simple (comportamiento original)
        const montoACaja = totalConInteresTarjetaFinal || totalBase

        await connection.execute(
          `INSERT INTO movimientos_caja (
            sesion_caja_id, 
            tipo, 
            concepto, 
            monto, 
            metodo_pago,
            referencia_tipo, 
            referencia_id, 
            usuario_id
          ) VALUES (?, 'INGRESO', ?, ?, ?, 'VENTA', ?, ?)`,
          [sesionCaja[0].id, `Venta ${numero} - ${tipo_pago}`, montoACaja, tipo_pago, venta_id, usuario_id],
        )
      }
    }

    await connection.commit()

    const [venta] = await connection.execute(
      `SELECT v.*, c.nombre as cliente_nombre, s.nombre as sucursal_nombre, u.nombre as usuario_nombre,
              tc.nombre as tarjeta_nombre
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       LEFT JOIN sucursales s ON v.sucursal_id = s.id
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN tarjetas_credito tc ON v.tarjeta_id = tc.id
       WHERE v.id = ?`,
      [venta_id],
    )

    connection.release()

    return ResponseHelper.created(res, venta[0], "Venta creada exitosamente")
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("[v0] Error al crear venta:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState,
      errno: error.errno,
      sql: error.sql,
    })
    return ResponseHelper.error(res, `Error al crear la venta: ${error.message}`, 500)
  }
}

// Obtener todas las ventas con paginación y filtros
const obtenerVentas = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      fecha_desde,
      fecha_hasta,
      tipo_pago,
      estado,
      sucursal_id,
      sucursales_ids, // New parameter for multiple sucursales
      sortBy = "created_at",
      orderBy = "DESC",
    } = req.query

    const offset = (page - 1) * limit
    const whereConditions = []
    const queryParams = []

    if (search) {
      whereConditions.push("(v.numero LIKE ? OR c.nombre LIKE ?)")
      queryParams.push(`%${search}%`, `%${search}%`)
    }

    if (fecha_desde) {
      whereConditions.push("DATE(v.created_at) >= ?")
      queryParams.push(fecha_desde)
    }

    if (fecha_hasta) {
      whereConditions.push("DATE(v.created_at) <= ?")
      queryParams.push(fecha_hasta)
    }

    if (tipo_pago) {
      whereConditions.push("v.tipo_pago = ?")
      queryParams.push(tipo_pago.toUpperCase())
    }

    if (estado) {
      whereConditions.push("v.estado = ?")
      queryParams.push(estado.toUpperCase())
    }

    if (sucursales_ids) {
      const sucursalIdsArray = sucursales_ids.split(",").map((id) => id.trim())
      const placeholders = sucursalIdsArray.map(() => "?").join(",")
      whereConditions.push(`v.sucursal_id IN (${placeholders})`)
      queryParams.push(...sucursalIdsArray)
    } else if (sucursal_id) {
      whereConditions.push("v.sucursal_id = ?")
      queryParams.push(sucursal_id)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // If total_con_interes_tarjeta exists and is different, use it; otherwise use total field
    const [ventas] = await db.pool.execute(
      `SELECT 
        v.id,
        v.numero,
        v.tipo_pago,
        v.subtotal,
        v.descuento,
        v.total,
        v.total_con_interes_tarjeta,
        v.estado,
        v.observaciones,
        v.created_at,
        v.sesion_caja_id,
        sc.estado AS sesion_caja_estado,
        c.nombre AS cliente_nombre,
        s.nombre AS sucursal_nombre,
        COALESCE(
          (SELECT SUM(dv.cantidad * dv.precio_unitario) 
           FROM detalle_ventas dv 
           WHERE dv.venta_id = v.id),
          0
        ) AS total_productos
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       LEFT JOIN sucursales s ON v.sucursal_id = s.id
       LEFT JOIN sesiones_caja sc ON v.sesion_caja_id = sc.id
       ${whereClause}
       ORDER BY v.${sortBy} ${orderBy}
       LIMIT ${Math.max(1, Math.min(100, Number.parseInt(limit) || 10))} OFFSET ${Math.max(0, Number.parseInt(offset) || 0)}`,
      queryParams,
    )

    const [totalResult] = await db.pool.execute(
      `SELECT COUNT(DISTINCT v.id) as total
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       ${whereClause}`,
      queryParams,
    )

    const total = totalResult[0].total

    return ResponseHelper.success(res, {
      ventas,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    logger.error("Error al obtener ventas:", error)
    return ResponseHelper.error(res, "Error al obtener las ventas", 500)
  }
}

// Obtener una venta por ID con detalle
const obtenerVentaPorId = async (req, res) => {
  try {
    const { id } = req.params

    const [venta] = await db.pool.execute(
      `SELECT v.*, 
              CONCAT(c.nombre, ' ', IFNULL(c.apellido, '')) as cliente_nombre, 
              c.dni as cliente_dni, 
              c.telefono as cliente_telefono,
              s.nombre as sucursal_nombre, 
              u.nombre as usuario_nombre,
              uc.nombre as usuario_cancelacion_nombre,
              tc.nombre as tarjeta_nombre,
              tc2.nombre as tarjeta_nombre_2
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       LEFT JOIN sucursales s ON v.sucursal_id = s.id
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN usuarios uc ON v.cancelado_por = uc.id
       LEFT JOIN tarjetas_credito tc ON v.tarjeta_id = tc.id
       LEFT JOIN tarjetas_credito tc2 ON v.tarjeta_id_2 = tc2.id
       WHERE v.id = ?`,
      [id],
    )

    if (!venta.length) {
      return ResponseHelper.notFound(res, "Venta no encontrada")
    }

    const [detalle] = await db.pool.execute(
      `SELECT dv.*, p.nombre as producto_nombre, p.codigo as producto_codigo
       FROM detalle_ventas dv
       INNER JOIN productos p ON dv.producto_id = p.id
       WHERE dv.venta_id = ?`,
      [id],
    )

    // Si es pago dividido, obtener los movimientos de caja asociados para mostrar el desglose
    let pagos = null
    if (venta[0].pago_dividido) {
      const [movimientosCaja] = await db.pool.execute(
        `SELECT metodo_pago, monto, concepto 
         FROM movimientos_caja 
         WHERE referencia_tipo = 'VENTA' AND referencia_id = ? AND tipo = 'INGRESO' AND estado = 'ACTIVO'
         ORDER BY id ASC`,
        [id],
      )
      pagos = movimientosCaja
    }

    return ResponseHelper.success(res, { ...venta[0], detalle, pagos })
  } catch (error) {
    logger.error("Error al obtener venta:", error)
    return ResponseHelper.error(res, "Error al obtener la venta", 500)
  }
}

// Cancelar una venta
const cancelarVenta = async (req, res) => {
  const connection = await db.pool.getConnection()
  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { motivo } = req.body
    const usuario_id = req.user.id

    const [venta] = await connection.execute("SELECT * FROM ventas WHERE id = ?", [id])

    if (!venta.length) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.notFound(res, "Venta no encontrada")
    }

    if (venta[0].estado === "CANCELADA") {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "La venta ya está cancelada")
    }

    const [sesionCajaVenta] = await connection.execute(
      `SELECT sc.estado FROM sesiones_caja sc 
       WHERE sc.id = ?`,
      [venta[0].sesion_caja_id],
    )

    if (!sesionCajaVenta.length) {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(res, "No se puede cancelar: la sesión de caja de esta venta no existe")
    }

    if (sesionCajaVenta[0].estado !== "ABIERTA") {
      await connection.rollback()
      connection.release()
      return ResponseHelper.validationError(
        res,
        "No se puede cancelar ventas de sesiones de caja cerradas. Solo se pueden cancelar ventas de la sesión actual.",
      )
    }

    const [detalles] = await connection.execute(
      `SELECT dv.*, p.nombre as producto_nombre, p.stock as stock_actual, p.unidad_medida
       FROM detalle_ventas dv
       INNER JOIN productos p ON dv.producto_id = p.id
       WHERE dv.venta_id = ?`,
      [id],
    )

    for (const detalle of detalles) {
      const stockActual = Number.parseFloat(detalle.stock_actual)
      const cantidadVendida = Number.parseFloat(detalle.cantidad)
      const nuevoStock = stockActual + cantidadVendida
      const unidad_medida = detalle.unidad_medida || "unidad"

      await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [nuevoStock, detalle.producto_id])

      await connection.execute(
        `INSERT INTO movimientos_stock (
          producto_id,
          tipo,
          unidad_medida,
          cantidad,
          stock_anterior,
          stock_nuevo,
          motivo,
          referencia_tipo,
          referencia_id,
          usuario_id
        ) VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, 'VENTA_CANCELADA', ?, ?)`,
        [
          detalle.producto_id,
          unidad_medida,
          cantidadVendida,
          stockActual,
          nuevoStock,
          `Cancelación de venta ${venta[0].numero}${motivo ? `: ${motivo}` : ""}`.trim(),
          id,
          usuario_id,
        ],
      )
    }

    const observacionesCancelacion = motivo
      ? `${venta[0].observaciones || ""} | Cancelada: ${motivo}`.trim()
      : `${venta[0].observaciones || ""} | Cancelada`.trim()

    await connection.execute(
      `UPDATE ventas 
       SET estado = 'CANCELADA', 
           observaciones = ?,
           cancelado_por = ?,
           fecha_cancelacion = NOW()
       WHERE id = ?`,
      [observacionesCancelacion, usuario_id, id],
    )

    if (venta[0].tipo_pago === "CUENTA_CORRIENTE" && venta[0].cliente_id) {
      const [cuentaCorriente] = await connection.execute("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [
        venta[0].cliente_id,
      ])

      if (cuentaCorriente.length) {
        const montoParaRestar = venta[0].total
        const saldoAnterior = Number.parseFloat(cuentaCorriente[0].saldo)
        const saldoNuevo = saldoAnterior - montoParaRestar

        await connection.execute("UPDATE cuentas_corrientes SET saldo = ? WHERE id = ?", [
          saldoNuevo,
          cuentaCorriente[0].id,
        ])

        await connection.execute(
          `INSERT INTO movimientos_cuenta_corriente (
            cuenta_corriente_id, 
            tipo, 
            monto, 
            saldo_anterior, 
            saldo_nuevo, 
            descripcion, 
            referencia_tipo, 
            referencia_id
          ) VALUES (?, 'AJUSTE', ?, ?, ?, ?, 'VENTA', ?)`,
          [
            cuentaCorriente[0].id,
            montoParaRestar,
            saldoAnterior,
            saldoNuevo,
            `Cancelación venta ${venta[0].numero}`,
            id,
          ],
        )
      }
    }

    if (venta[0].tipo_pago !== "CUENTA_CORRIENTE") {
      // Si es pago múltiple, obtener los movimientos originales y crear egresos correspondientes
      if (venta[0].pago_dividido) {
        const [movimientosOriginales] = await connection.execute(
          `SELECT id, metodo_pago, monto 
           FROM movimientos_caja 
           WHERE referencia_tipo = 'VENTA' AND referencia_id = ? AND tipo = 'INGRESO' AND estado = 'ACTIVO'`,
          [id],
        )

        for (const mov of movimientosOriginales) {
          // Crear un egreso por cada movimiento de ingreso original
          await connection.execute(
            `INSERT INTO movimientos_caja (
              sesion_caja_id, 
              tipo, 
              concepto, 
              monto,
              metodo_pago, 
              referencia_tipo, 
              referencia_id, 
              usuario_id,
              observaciones
            ) VALUES (?, 'EGRESO', ?, ?, ?, 'VENTA_CANCELADA', ?, ?, ?)`,
            [
              venta[0].sesion_caja_id,
              `Cancelación venta ${venta[0].numero} - ${mov.metodo_pago}`,
              mov.monto,
              mov.metodo_pago,
              id,
              usuario_id,
              motivo || "Venta cancelada",
            ],
          )

          // Marcar el movimiento original como cancelado
          await connection.execute(
            `UPDATE movimientos_caja SET estado = 'CANCELADO' WHERE id = ?`,
            [mov.id],
          )
        }
      } else {
        // Pago simple - comportamiento original
        const montoARevertir = venta[0].total_con_interes_tarjeta || venta[0].total

        await connection.execute(
          `INSERT INTO movimientos_caja (
            sesion_caja_id, 
            tipo, 
            concepto, 
            monto,
            metodo_pago, 
            referencia_tipo, 
            referencia_id, 
            usuario_id,
            observaciones
          ) VALUES (?, 'EGRESO', ?, ?, ?, 'VENTA_CANCELADA', ?, ?, ?)`,
          [
            venta[0].sesion_caja_id,
            `Cancelación venta ${venta[0].numero}`,
            montoARevertir,
            venta[0].tipo_pago,
            id,
            usuario_id,
            motivo || "Venta cancelada",
          ],
        )
      }
    }

    await connection.commit()
    connection.release()

    return ResponseHelper.success(res, null, "Venta cancelada exitosamente. El stock ha sido restaurado.")
  } catch (error) {
    await connection.rollback()
    connection.release()
    logger.error("[v0] Error al cancelar venta:", {
      message: error.message,
      stack: error.stack,
    })
    return ResponseHelper.error(res, `Error al cancelar la venta: ${error.message}`, 500)
  }
}

// Obtener estadísticas de ventas
const obtenerEstadisticas = async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, sucursal_id } = req.query

    const whereConditions = ["estado = 'COMPLETADA'"]
    const queryParams = []

    if (fecha_desde) {
      whereConditions.push("DATE(created_at) >= ?")
      queryParams.push(fecha_desde)
    }

    if (fecha_hasta) {
      whereConditions.push("DATE(created_at) <= ?")
      queryParams.push(fecha_hasta)
    }

    if (sucursal_id) {
      whereConditions.push("sucursal_id = ?")
      queryParams.push(sucursal_id)
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`

    const [estadisticas] = await db.pool.execute(
      `SELECT 
        COUNT(*) as total_ventas,
        SUM(total) as total_facturado, 
        AVG(total) as ticket_promedio, 
        SUM(CASE WHEN tipo_pago = 'EFECTIVO' THEN total ELSE 0 END) as total_efectivo, 
        SUM(CASE WHEN tipo_pago = 'TARJETA_CREDITO' THEN total ELSE 0 END) as total_tarjeta_credito, 
        SUM(CASE WHEN tipo_pago = 'TRANSFERENCIA' THEN total ELSE 0 END) as total_transferencia, 
        SUM(CASE WHEN tipo_pago = 'CUENTA_CORRIENTE' THEN total ELSE 0 END) as total_cuenta_corriente 
       FROM ventas
       ${whereClause}`,
      queryParams,
    )

    return ResponseHelper.success(res, estadisticas[0])
  } catch (error) {
    logger.error("Error al obtener estadísticas:", error)
    return ResponseHelper.error(res, "Error al obtener estadísticas", 500)
  }
}

module.exports = {
  crearVenta,
  obtenerVentas,
  obtenerVentaPorId,
  cancelarVenta,
  obtenerEstadisticas,
}
