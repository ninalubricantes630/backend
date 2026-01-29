const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const serviciosController = {
  // Obtener todos los servicios con paginación y filtros
  getServicios: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        clienteId = "",
        vehiculoId = "",
        sucursal_id = "",
        sucursales_ids = "",
        tipo_pago = "",
        estado = "",
        fecha_desde = "",
        fecha_hasta = "",
      } = req.query
      const pageNum = Number.parseInt(page) || 1
      const limitNum = Math.min(Number.parseInt(limit) || 10, 100)
      const offset = (pageNum - 1) * limitNum

      let query = `SELECT s.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.dni as cliente_dni,
               v.patente, v.marca, v.modelo, v.año,
               suc.nombre as sucursal_nombre,
               u.nombre as usuario_nombre,
               sc.estado AS sesion_caja_estado,
               s.total,
               s.tipo_pago
        FROM servicios s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
        LEFT JOIN usuarios u ON s.usuario_id = u.id
        LEFT JOIN sesiones_caja sc ON s.sesion_caja_id = sc.id
        WHERE s.activo = true`

      let countQuery = "SELECT COUNT(DISTINCT s.id) as total FROM servicios s WHERE s.activo = true"
      const queryParams = []
      const countParams = []

      const itemsCountQuery = `(SELECT COUNT(*) FROM servicio_items si2 WHERE si2.servicio_id = s.id) as items_count`
      query = query.replace("s.tipo_pago", `s.tipo_pago, ${itemsCountQuery}`)

      // Filtro de búsqueda
      if (search) {
        query += " AND (s.numero LIKE ? OR CONCAT(c.nombre, ' ', c.apellido) LIKE ? OR v.patente LIKE ?)"
        countQuery +=
          " AND EXISTS (SELECT 1 FROM clientes c2 LEFT JOIN vehiculos v2 ON s.vehiculo_id = v2.id WHERE s.cliente_id = c2.id AND (s.numero LIKE ? OR CONCAT(c2.nombre, ' ', c2.apellido) LIKE ? OR v2.patente LIKE ?))"
        const searchParam = `%${search}%`
        queryParams.push(searchParam, searchParam, searchParam)
        countParams.push(searchParam, searchParam, searchParam)
      }

      // Filtro por cliente
      if (clienteId) {
        query += " AND s.cliente_id = ?"
        countQuery += " AND s.cliente_id = ?"
        queryParams.push(clienteId)
        countParams.push(clienteId)
      }

      // Filtro por vehículo
      if (vehiculoId) {
        query += " AND s.vehiculo_id = ?"
        countQuery += " AND s.vehiculo_id = ?"
        queryParams.push(vehiculoId)
        countParams.push(vehiculoId)
      }

      // Filtro por sucursal
      if (sucursal_id) {
        query += " AND s.sucursal_id = ?"
        countQuery += " AND s.sucursal_id = ?"
        queryParams.push(sucursal_id)
        countParams.push(sucursal_id)
      } else if (sucursales_ids) {
        const sucursalIdsArray = sucursales_ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id)
        if (sucursalIdsArray.length > 0) {
          const placeholders = sucursalIdsArray.map(() => "?").join(",")
          query += ` AND s.sucursal_id IN (${placeholders})`
          countQuery += ` AND s.sucursal_id IN (${placeholders})`
          queryParams.push(...sucursalIdsArray)
          countParams.push(...sucursalIdsArray)
        }
      }

      // Filtro por tipo de pago
      if (tipo_pago) {
        query += " AND s.tipo_pago = ?"
        countQuery += " AND s.tipo_pago = ?"
        queryParams.push(tipo_pago)
        countParams.push(tipo_pago)
      }

      // Filtro por estado
      if (estado) {
        query += " AND s.estado = ?"
        countQuery += " AND s.estado = ?"
        queryParams.push(estado)
        countParams.push(estado)
      }

      // Filtro por rango de fechas
      if (fecha_desde) {
        query += " AND DATE(s.created_at) >= ?"
        countQuery += " AND DATE(s.created_at) >= ?"
        queryParams.push(fecha_desde)
        countParams.push(fecha_desde)
      }

      if (fecha_hasta) {
        query += " AND DATE(s.created_at) <= ?"
        countQuery += " AND DATE(s.created_at) <= ?"
        queryParams.push(fecha_hasta)
        countParams.push(fecha_hasta)
      }

      query += ` ORDER BY s.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`

      const [servicios] = await db.pool.execute(query, queryParams)
      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total
      const totalPages = Math.ceil(total / limitNum)

      return ResponseHelper.success(res, {
        servicios,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      })
    } catch (error) {
      console.error("Error al obtener servicios:", error)
      return ResponseHelper.error(res, "Error al obtener servicios", 500)
    }
  },

  // Obtener servicio por ID con items y productos
  getServicioById: async (req, res) => {
    try {
      const { id } = req.params

      const [servicios] = await db.pool.execute(
        `SELECT s.*, 
               c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.dni as cliente_dni, c.telefono as cliente_telefono,
               v.patente, v.marca, v.modelo, v.año,
               suc.nombre as sucursal_nombre, suc.ubicacion as sucursal_ubicacion,
               u.nombre as usuario_nombre,
               tc.nombre as tarjeta_nombre,
               tc2.nombre as tarjeta_nombre_2
        FROM servicios s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
        LEFT JOIN usuarios u ON s.usuario_id = u.id
        LEFT JOIN tarjetas_credito tc ON s.tarjeta_id = tc.id
        LEFT JOIN tarjetas_credito tc2 ON s.tarjeta_id_2 = tc2.id
        WHERE s.id = ? AND s.activo = true`,
        [id],
      )

      if (servicios.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" })
      }

      // Obtener empleados del servicio
      const [empleados] = await db.pool.execute(
        `SELECT e.id, e.nombre, e.apellido, e.cargo
        FROM servicio_empleados se
        LEFT JOIN empleados e ON se.empleado_id = e.id
        WHERE se.servicio_id = ? AND e.activo = true
        ORDER BY e.nombre, e.apellido`,
        [id],
      )

      const [items] = await db.pool.execute(
        `SELECT si.*, ts.nombre as tipo_servicio_nombre, ts.descripcion as tipo_servicio_descripcion
        FROM servicio_items si
        LEFT JOIN tipos_servicios ts ON si.tipo_servicio_id = ts.id
        WHERE si.servicio_id = ?
        ORDER BY si.id`,
        [id],
      )

      for (const item of items) {
        const [productos] = await db.pool.execute(
          `SELECT dsp.*, p.nombre as producto_nombre, p.codigo as producto_codigo, p.unidad_medida
          FROM detalle_servicio_productos dsp
          LEFT JOIN productos p ON dsp.producto_id = p.id
          WHERE dsp.servicio_item_id = ?
          ORDER BY dsp.id`,
          [item.id],
        )
        item.productos = productos
      }

      // Si es pago dividido, obtener los movimientos de caja asociados para mostrar el desglose
      let pagos = null
      if (servicios[0].pago_dividido) {
        const [movimientosCaja] = await db.pool.execute(
          `SELECT metodo_pago, monto, concepto 
           FROM movimientos_caja 
           WHERE referencia_tipo = 'SERVICE' AND referencia_id = ? AND tipo = 'INGRESO' AND estado = 'ACTIVO'
           ORDER BY id ASC`,
          [id],
        )
        pagos = movimientosCaja
      }

      const servicio = {
        ...servicios[0],
        empleados,
        items,
        pagos,
      }

      res.json(servicio)
    } catch (error) {
      console.error("Error al obtener servicio:", error)
      res.status(500).json({ error: "Error interno del servidor" })
    }
  },

  createServicio: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const {
        cliente_id,
        vehiculo_id,
        sucursal_id,
        empleados,
        observaciones,
        items,
        tipo_pago,
        tarjeta_id,
        numero_cuotas,
        descuento = 0,
        interes_sistema = 0,
        tipo_interes_sistema,
        valor_interes_sistema = 0,
        interes_tarjeta = 0,
        tasa_interes_tarjeta,
        total_con_interes,
        total_con_interes_tarjeta,
        subtotal,
        interes,
        // Campos para pago dividido
        pago_dividido,
        monto_pago_1,
        tipo_pago_2,
        monto_pago_2,
        tarjeta_id_2,
        numero_cuotas_2,
        tasa_interes_tarjeta_2,
      } = req.body

      // Convertir pago_dividido a boolean (puede venir como string "true"/"false")
      const esPagoDividido = pago_dividido === true || pago_dividido === "true" || pago_dividido === 1

      console.log("[v0] Servicio - Datos recibidos pago dividido:", {
        pago_dividido,
        esPagoDividido,
        tipo_pago,
        tipo_pago_2,
        monto_pago_1,
        monto_pago_2
      })

      if (!cliente_id) {
        return res.status(400).json({ error: "Cliente ID es requerido" })
      }
      if (!vehiculo_id) {
        return res.status(400).json({ error: "Vehículo ID es requerido" })
      }
      if (!sucursal_id) {
        return res.status(400).json({ error: "Sucursal ID es requerido" })
      }

      if (!tipo_pago || tipo_pago.trim() === "") {
        await connection.rollback()
        connection.release()
        return res.status(400).json({ error: "Tipo de pago es requerido y no puede estar vacío" })
      }

      const tipo_pago_upper = tipo_pago.toUpperCase().trim()

  const tiposPagoValidos = ["EFECTIVO", "TARJETA_CREDITO", "TRANSFERENCIA", "CUENTA_CORRIENTE", "PAGO_MULTIPLE"]
  if (!tiposPagoValidos.includes(tipo_pago_upper)) {
    await connection.rollback()
    connection.release()
    return res
      .status(400)
      .json({ error: `Tipo de pago inválido. Valores permitidos: ${tiposPagoValidos.join(", ")}` })
  }

      const usuario_id = req.user?.id || null

      const [sesionCaja] = await connection.execute(
        `SELECT id FROM sesiones_caja 
         WHERE sucursal_id = ? AND estado = 'ABIERTA' 
         ORDER BY fecha_apertura DESC LIMIT 1`,
        [sucursal_id],
      )

      if (sesionCaja.length === 0) {
        await connection.rollback()
        connection.release()
        return res.status(400).json({
          error: "No hay una caja abierta en esta sucursal. Debe abrir la caja antes de realizar servicios.",
        })
      }

      const sesion_caja_id = sesionCaja[0].id

      const [lastService] = await connection.execute(
        "SELECT numero FROM servicios WHERE numero LIKE 'SERV-%' ORDER BY CAST(SUBSTRING(numero, 6) AS UNSIGNED) DESC LIMIT 1",
      )

      let nextNumber = 1
      if (lastService.length > 0) {
        const lastNumber = Number.parseInt(lastService[0].numero.substring(5))
        nextNumber = lastNumber + 1
      }

      const numero = `SERV-${nextNumber.toString().padStart(5, "0")}`

      const itemsArray = Array.isArray(items) ? items : []

      let calculatedSubtotal = subtotal || 0

      if (!subtotal || subtotal === 0) {
        for (const item of itemsArray) {
          if (item.productos && Array.isArray(item.productos)) {
            for (const prod of item.productos) {
              calculatedSubtotal += Number.parseFloat(prod.precio_unitario || 0) * Number.parseFloat(prod.cantidad || 0)
            }
          } else {
            calculatedSubtotal += Number.parseFloat(item.total || 0)
          }
        }
      }

      const finalSubtotal = calculatedSubtotal
      const descuentoNum = Number.parseFloat(descuento) || 0

      if (descuentoNum > 0 && valor_interes_sistema && Number.parseFloat(valor_interes_sistema) > 0) {
        await connection.rollback()
        connection.release()
        return res.status(400).json({
          error:
            "No se puede aplicar descuento e interés del sistema simultáneamente. Por favor, selecciona solo uno de ellos.",
        })
      }

      let interesSistemaPorcentaje = 0
      let interesSistemaMonto = 0

      if (valor_interes_sistema && Number.parseFloat(valor_interes_sistema) > 0) {
        const valorInteres = Number.parseFloat(valor_interes_sistema)

        if (tipo_interes_sistema === "porcentaje") {
          interesSistemaPorcentaje = valorInteres
          interesSistemaMonto = (finalSubtotal * valorInteres) / 100
        } else {
          interesSistemaMonto = valorInteres
          interesSistemaPorcentaje = finalSubtotal > 0 ? (valorInteres / finalSubtotal) * 100 : 0
        }
      }

      const totalBase = finalSubtotal - descuentoNum + interesSistemaMonto

      let interesTarjetaPorcentaje = 0
      let interesTarjetaMonto = 0
      let totalConInteresTarjetaFinal = null
      let totalFinalCaja = totalBase

      // Aplicar interés de tarjeta cuando haya tasa (incluye 1 cuota con interés, no solo más de 1 cuota)
      const tasaInteresTarjetaNum = Number.parseFloat(tasa_interes_tarjeta) || 0
      if (tipo_pago_upper === "TARJETA_CREDITO" && tarjeta_id && numero_cuotas && tasaInteresTarjetaNum > 0) {
        interesTarjetaPorcentaje = tasaInteresTarjetaNum
        interesTarjetaMonto = (totalBase * interesTarjetaPorcentaje) / 100
        totalConInteresTarjetaFinal = totalBase + interesTarjetaMonto
        totalFinalCaja = totalConInteresTarjetaFinal
      }

      // Total a guardar: monto con interés de tarjeta cuando aplique (reportes y detalle usan este valor)
      const totalAGuardar = totalConInteresTarjetaFinal ?? totalBase

      // Determinar el tipo de pago para guardar en la base de datos
      const tipoPagoFinal = esPagoDividido ? 'PAGO_MULTIPLE' : tipo_pago_upper
      const tipoPago2Upper = tipo_pago_2 ? tipo_pago_2.toUpperCase() : null

      console.log("[v0] Servicio - Guardando con tipo_pago:", tipoPagoFinal, "esPagoDividido:", esPagoDividido)

      let result
      try {
        // Intenta insertar con las nuevas columnas de pago dividido
        ;[result] = await connection.execute(
          `INSERT INTO servicios (
            numero, cliente_id, vehiculo_id, sucursal_id, descripcion, observaciones,
            subtotal, descuento, interes_sistema_porcentaje, interes_sistema_monto,
            total, interes_tarjeta_porcentaje, interes_tarjeta_monto, total_con_interes_tarjeta,
            tipo_pago, tarjeta_id, numero_cuotas, usuario_id, sesion_caja_id, fecha_pago, estado, activo,
            pago_dividido, tipo_pago_2, monto_pago_1, monto_pago_2, tarjeta_id_2, numero_cuotas_2
          ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'COMPLETADA', 1, ?, ?, ?, ?, ?, ?)`,
          [
            numero,
            cliente_id,
            vehiculo_id,
            sucursal_id,
            req.body.descripcion || "",
            observaciones || null,
            Number(finalSubtotal).toFixed(2),
            Number(descuentoNum).toFixed(2),
            Number(interesSistemaPorcentaje).toFixed(2),
            Number(interesSistemaMonto).toFixed(2),
            Number(totalAGuardar).toFixed(2),
            Number(interesTarjetaPorcentaje).toFixed(2),
            Number(interesTarjetaMonto).toFixed(2),
            totalConInteresTarjetaFinal ? Number(totalConInteresTarjetaFinal).toFixed(2) : null,
            tipoPagoFinal,
            tarjeta_id || null,
            numero_cuotas || 1,
            usuario_id,
            sesion_caja_id,
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
        console.log("[v0] Insertando servicio sin columnas de pago dividido (migración pendiente):", insertError.message)
        ;[result] = await connection.execute(
          `INSERT INTO servicios (
            numero, cliente_id, vehiculo_id, sucursal_id, descripcion, observaciones,
            subtotal, descuento, interes_sistema_porcentaje, interes_sistema_monto,
            total, interes_tarjeta_porcentaje, interes_tarjeta_monto, total_con_interes_tarjeta,
            tipo_pago, tarjeta_id, numero_cuotas, usuario_id, sesion_caja_id, fecha_pago, estado, activo
          ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'COMPLETADA', 1)`,
          [
            numero,
            cliente_id,
            vehiculo_id,
            sucursal_id,
            req.body.descripcion || "",
            observaciones || null,
            Number(finalSubtotal).toFixed(2),
            Number(descuentoNum).toFixed(2),
            Number(interesSistemaPorcentaje).toFixed(2),
            Number(interesSistemaMonto).toFixed(2),
            Number(totalAGuardar).toFixed(2),
            Number(interesTarjetaPorcentaje).toFixed(2),
            Number(interesTarjetaMonto).toFixed(2),
            totalConInteresTarjetaFinal ? Number(totalConInteresTarjetaFinal).toFixed(2) : null,
            tipo_pago_upper, // Usar el tipo_pago original si PAGO_MULTIPLE no está soportado
            tarjeta_id || null,
            numero_cuotas || 1,
            usuario_id,
            sesion_caja_id,
          ],
        )
      }

      const servicioId = result.insertId

      if (empleados && Array.isArray(empleados) && empleados.length > 0) {
        for (const empleadoId of empleados) {
          await connection.execute(`INSERT INTO servicio_empleados (servicio_id, empleado_id) VALUES (?, ?)`, [
            servicioId,
            empleadoId,
          ])
        }
      }

      for (const item of itemsArray) {
        let item_subtotal = 0

        if (item.productos && Array.isArray(item.productos) && item.productos.length > 0) {
          for (const prod of item.productos) {
            item_subtotal += Number.parseFloat(prod.precio_unitario || 0) * Number.parseFloat(prod.cantidad || 0)
          }
        } else {
          item_subtotal = Number.parseFloat(item.total) || 0
          if (isNaN(item_subtotal)) {
            item_subtotal = 0
          }
        }

        const [itemResult] = await connection.execute(
          `INSERT INTO servicio_items (servicio_id, tipo_servicio_id, descripcion, observaciones, notas, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            servicioId,
            item.tipo_servicio_id,
            item.descripcion || "Sin descripción",
            item.observaciones || null,
            item.notas || null,
            Number(item_subtotal).toFixed(2),
          ],
        )

        const servicioItemId = itemResult.insertId

        if (item.productos && Array.isArray(item.productos)) {
          for (const producto of item.productos) {
            const cantidad = Number.parseFloat(producto.cantidad || 0)
            const precio_unitario = Number.parseFloat(producto.precio_unitario || 0)
            const producto_subtotal = precio_unitario * cantidad

            const [productoData] = await connection.execute(
              "SELECT stock, unidad_medida, nombre FROM productos WHERE id = ?",
              [producto.producto_id],
            )

            if (productoData.length === 0) {
              throw new Error(`Producto con ID ${producto.producto_id} no encontrado`)
            }

            const stockAnterior = Number.parseFloat(productoData[0].stock)
            const stockNuevo = stockAnterior - cantidad
            const unidad_medida = productoData[0].unidad_medida

            await connection.execute(
              `INSERT INTO detalle_servicio_productos 
               (servicio_item_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [servicioItemId, producto.producto_id, cantidad, unidad_medida, precio_unitario, producto_subtotal],
            )

            await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [stockNuevo, producto.producto_id])

            await connection.execute(
              `INSERT INTO movimientos_stock 
               (producto_id, tipo, unidad_medida, cantidad, stock_anterior, stock_nuevo, motivo, referencia_tipo, referencia_id, usuario_id)
               VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, 'SERVICE', ?, ?)`,
              [
                producto.producto_id,
                unidad_medida,
                cantidad,
                stockAnterior,
                stockNuevo,
                `Servicio #${numero}`,
                servicioId,
                usuario_id,
              ],
            )
          }
        }
      }

      if (tipo_pago_upper !== "CUENTA_CORRIENTE") {
        // Verificar si es pago dividido
        if (esPagoDividido && tipo_pago_2 && monto_pago_1 && monto_pago_2) {
          console.log("[v0] Servicio - Registrando movimientos de caja para pago dividido:", {
            tipo_pago_upper,
            tipo_pago_2,
            monto_pago_1,
            monto_pago_2
          })
          
          // Registrar primer movimiento de caja
          await connection.execute(
            `INSERT INTO movimientos_caja 
             (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
             VALUES (?, 'INGRESO', ?, ?, ?, 'SERVICE', ?, ?, ?)`,
            [
              sesion_caja_id,
              `Servicio #${numero} - ${tipo_pago_upper} (Pago 1/2)`,
              monto_pago_1,
              tipo_pago_upper,
              servicioId,
              usuario_id,
              observaciones || `Servicio del cliente - Pago dividido`,
            ],
          )

          // Registrar segundo movimiento de caja
          const tipo_pago_2_upper = tipo_pago_2.toUpperCase()
          await connection.execute(
            `INSERT INTO movimientos_caja 
             (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
             VALUES (?, 'INGRESO', ?, ?, ?, 'SERVICE', ?, ?, ?)`,
            [
              sesion_caja_id,
              `Servicio #${numero} - ${tipo_pago_2_upper} (Pago 2/2)`,
              monto_pago_2,
              tipo_pago_2_upper,
              servicioId,
              usuario_id,
              observaciones || `Servicio del cliente - Pago dividido`,
            ],
          )
        } else {
          // Pago simple (comportamiento original)
          await connection.execute(
            `INSERT INTO movimientos_caja 
             (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
             VALUES (?, 'INGRESO', ?, ?, ?, 'SERVICE', ?, ?, ?)`,
            [
              sesion_caja_id,
              `Servicio #${numero} - ${tipo_pago_upper}`,
              totalFinalCaja,
              tipo_pago_upper,
              servicioId,
              usuario_id,
              observaciones || `Servicio del cliente`,
            ],
          )
        }
      }

      if (tipo_pago_upper === "CUENTA_CORRIENTE") {
        const [cuentaCorriente] = await connection.execute(
          "SELECT id, saldo FROM cuentas_corrientes WHERE cliente_id = ? AND activo = true",
          [cliente_id],
        )

        if (cuentaCorriente.length > 0) {
          const cuenta_id = cuentaCorriente[0].id
          const saldo_anterior = Number.parseFloat(cuentaCorriente[0].saldo)
          const saldo_nuevo = saldo_anterior + totalBase

          await connection.execute("UPDATE cuentas_corrientes SET saldo = ? WHERE id = ?", [saldo_nuevo, cuenta_id])

          await connection.execute(
            `INSERT INTO movimientos_cuenta_corriente 
             (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, descripcion, referencia_tipo, referencia_id, usuario_id)
             VALUES (?, 'CARGO', ?, ?, ?, ?, 'SERVICE', ?, ?)`,
            [cuenta_id, totalBase, saldo_anterior, saldo_nuevo, `Servicio #${numero}`, servicioId, usuario_id],
          )
        }
      }

      await connection.commit()

      const [newServicio] = await db.pool.execute(
        `SELECT s.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.dni as cliente_dni,
               v.patente, v.marca, v.modelo, v.año,
               suc.nombre as sucursal_nombre,
               u.nombre as usuario_nombre
        FROM servicios s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
        LEFT JOIN usuarios u ON s.usuario_id = u.id
        WHERE s.id = ?`,
        [servicioId],
      )

      res.status(201).json(newServicio[0])
    } catch (error) {
      await connection.rollback()
      console.error("Error al crear servicio:", error)
      res.status(400).json({ error: error.message || "Error interno del servidor" })
    } finally {
      connection.release()
    }
  },

  updateServicio: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { id } = req.params
      const {
        cliente_id,
        vehiculo_id,
        sucursal_id,
        empleados,
        observaciones,
        items,
        tipo_pago,
        tarjeta_id,
        numero_cuotas,
        interes_monto,
        total_con_interes_tarjeta,
        descuento = 0,
      } = req.body

      const [existingServicio] = await connection.execute("SELECT id FROM servicios WHERE id = ? AND activo = true", [
        id,
      ])

      if (existingServicio.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" })
      }

      await connection.execute("DELETE FROM servicio_empleados WHERE servicio_id = ?", [id])

      await connection.execute(
        "DELETE p FROM detalle_servicio_productos p INNER JOIN servicio_items si ON p.servicio_item_id = si.id WHERE si.servicio_id = ?",
        [id],
      )
      await connection.execute("DELETE FROM servicio_items WHERE servicio_id = ?", [id])

      const itemsArray = Array.isArray(items) ? items : []

      let subtotal = 0
      for (const item of itemsArray) {
        if (item.productos && Array.isArray(item.productos)) {
          for (const prod of item.productos) {
            subtotal += Number.parseFloat(prod.precio_unitario || 0) * Number.parseFloat(prod.cantidad || 0)
          }
        }
      }

      const total = subtotal - Number.parseFloat(descuento || 0)
      const intereses_sistema = Number.parseFloat(interes_monto || 0)
      const total_con_interes = total + intereses_sistema

      const tipo_pago_upper = tipo_pago.toUpperCase().trim()

      await connection.execute(
        `UPDATE servicios 
        SET cliente_id = ?, vehiculo_id = ?, sucursal_id = ?, observaciones = ?, precio_referencia = ?,
            subtotal = ?, descuento = ?, interes_monto = ?, total = ?, total_con_interes = ?, total_con_interes_tarjeta = ?
        WHERE id = ?`,
        [
          cliente_id,
          vehiculo_id,
          sucursal_id,
          observaciones || null,
          0,
          subtotal,
          descuento || 0,
          intereses_sistema,
          total,
          total_con_interes,
          total_con_interes_tarjeta || null,
          id,
        ],
      )

      if (empleados && Array.isArray(empleados) && empleados.length > 0) {
        for (const empleadoId of empleados) {
          await connection.execute(`INSERT INTO servicio_empleados (servicio_id, empleado_id) VALUES (?, ?)`, [
            id,
            empleadoId,
          ])
        }
      }

      for (const item of itemsArray) {
        const [itemResult] = await connection.execute(
          `INSERT INTO servicio_items (servicio_id, tipo_servicio_id, descripcion, observaciones, notas)
          VALUES (?, ?, ?, ?, ?)`,
          [
            id,
            item.tipo_servicio_id,
            item.descripcion || "Sin descripción",
            item.observaciones || null,
            item.notas || null,
          ],
        )

        const servicioItemId = itemResult.insertId

        if (item.productos && Array.isArray(item.productos)) {
          for (const producto of item.productos) {
            await connection.execute(`INSERT INTO productos (servicio_item_id, nombre, es_nuestro) VALUES (?, ?, ?)`, [
              servicioItemId,
              producto.nombre,
              producto.es_nuestro,
            ])
          }
        }
      }

      await connection.commit()

      const [updatedServicio] = await db.pool.execute(
        `SELECT s.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido,
               v.patente, v.marca, v.modelo,
               suc.nombre as sucursal_nombre,
               u.nombre as usuario_nombre,
               uc.nombre as usuario_cancelacion_nombre
         FROM servicios s
         LEFT JOIN clientes c ON s.cliente_id = c.id
         LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
         LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
         LEFT JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN usuarios uc ON s.cancelado_por = uc.id
         WHERE s.id = ?`,
        [id],
      )

      res.json(updatedServicio[0])
    } catch (error) {
      await connection.rollback()
      console.error("Error al actualizar servicio:", error)
      res.status(500).json({ error: error.message || "Error interno del servidor" })
    } finally {
      connection.release()
    }
  },

  deleteServicio: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { id } = req.params

      const [existingServicio] = await connection.execute("SELECT id FROM servicios WHERE id = ? AND activo = true", [
        id,
      ])

      if (existingServicio.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" })
      }

      await connection.execute(
        `DELETE p FROM detalle_servicio_productos p 
        INNER JOIN servicio_items si ON p.servicio_item_id = si.id 
        WHERE si.servicio_id = ?`,
        [id],
      )

      await connection.execute("DELETE FROM servicio_items WHERE servicio_id = ?", [id])

      await connection.execute("DELETE FROM servicio_empleados WHERE servicio_id = ?", [id])

      await connection.execute("DELETE FROM servicios WHERE id = ?", [id])

      await connection.commit()

      res.json({ message: "Servicio eliminado completamente" })
    } catch (error) {
      await connection.rollback()
      console.error("Error en deleteServicio:", error)
      res.status(500).json({ error: "Error interno del servidor" })
    } finally {
      connection.release()
    }
  },

  // Obtener estadísticas de servicios
  getEstadisticas: async (req, res) => {
    try {
      const [stats] = await db.pool.execute(`SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as servicios_hoy,
          SUM(CASE WHEN WEEK(created_at) = WEEK(CURDATE()) THEN 1 ELSE 0 END) as servicios_semana,
          SUM(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END) as servicios_mes
        FROM servicios 
        WHERE activo = true`)

      res.json(stats[0])
    } catch (error) {
      console.error("Error al obtener estadísticas:", error)
      res.status(500).json({ error: "Error interno del servidor" })
    }
  },

  // Obtener servicios por cliente
  getServiciosByCliente: async (req, res) => {
    try {
      const { id } = req.params

      const query = `SELECT s.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.dni as cliente_dni,
               v.patente, v.marca, v.modelo, v.año,
               suc.nombre as sucursal_nombre,
               COUNT(si.id) as items_count
        FROM servicios s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
        LEFT JOIN servicio_items si ON s.id = si.servicio_id
        WHERE s.activo = true AND s.cliente_id = ?
        GROUP BY s.id 
        ORDER BY s.created_at DESC`

      const [servicios] = await db.pool.execute(query, [id])
      res.json(servicios)
    } catch (error) {
      console.error("Error al obtener servicios del cliente:", error)
      res.status(500).json({ error: "Error interno del servidor" })
    }
  },

  // Obtener servicios por vehículo
  getServiciosByVehiculo: async (req, res) => {
    try {
      const { patente } = req.params

      const query = `SELECT s.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.dni as cliente_dni,
               v.patente, v.marca, v.modelo, v.año,
               suc.nombre as sucursal_nombre,
               COUNT(si.id) as items_count
        FROM servicios s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
        LEFT JOIN servicio_items si ON s.id = si.servicio_id
        WHERE s.activo = true AND v.patente = ?
        GROUP BY s.id 
        ORDER BY s.created_at DESC`

      const [servicios] = await db.pool.execute(query, [patente])
      res.json(servicios)
    } catch (error) {
      console.error("Error al obtener servicios del vehículo:", error)
      res.status(500).json({ error: "Error interno del servidor" })
    }
  },

  cancelarServicio: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { id } = req.params
      const { motivo } = req.body
      const usuario_id = req.user?.id

      const [servicio] = await connection.execute("SELECT * FROM servicios WHERE id = ? AND activo = true", [id])

      if (!servicio.length) {
        await connection.rollback()
        connection.release()
        return res.status(404).json({ error: "Servicio no encontrado" })
      }

      if (servicio[0].estado === "CANCELADA") {
        await connection.rollback()
        connection.release()
        return res.status(400).json({ error: "El servicio ya está cancelado" })
      }

      const [sesionCajaServicio] = await connection.execute(
        `SELECT sc.estado FROM sesiones_caja sc 
         WHERE sc.id = ?`,
        [servicio[0].sesion_caja_id],
      )

      if (!sesionCajaServicio.length) {
        await connection.rollback()
        connection.release()
        return res.status(400).json({
          error: "No se puede cancelar: la sesión de caja de este servicio no existe",
        })
      }

      if (sesionCajaServicio[0].estado !== "ABIERTA") {
        await connection.rollback()
        connection.release()
        return res.status(400).json({
          error:
            "No se puede cancelar servicios de sesiones de caja cerradas. Solo se pueden cancelar servicios de la sesión actual.",
        })
      }

      await connection.execute(
        `UPDATE servicios 
         SET estado = 'CANCELADA', 
             cancelado_por = ?, 
             fecha_cancelacion = NOW(),
             observaciones = CONCAT(COALESCE(observaciones, ''), '\n[CANCELADO] ', ?)
         WHERE id = ?`,
        [usuario_id, motivo || "Sin motivo especificado", id],
      )

      const [items] = await connection.execute(`SELECT si.id FROM servicio_items si WHERE si.servicio_id = ?`, [id])

      for (const item of items) {
        const [productos] = await connection.execute(
          `SELECT dsp.producto_id, dsp.cantidad, dsp.unidad_medida, p.nombre, p.stock
           FROM detalle_servicio_productos dsp
           INNER JOIN productos p ON dsp.producto_id = p.id
           WHERE dsp.servicio_item_id = ?`,
          [item.id],
        )

        for (const producto of productos) {
          const stockAnterior = Number.parseFloat(producto.stock)
          const cantidad = Number.parseFloat(producto.cantidad)
          const stockNuevo = stockAnterior + cantidad

          await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [stockNuevo, producto.producto_id])

          await connection.execute(
            `INSERT INTO movimientos_stock 
             (producto_id, tipo, unidad_medida, cantidad, stock_anterior, stock_nuevo, motivo, referencia_tipo, referencia_id, usuario_id)
             VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, 'SERVICIO_CANCELADO', ?, ?)`,
            [
              producto.producto_id,
              producto.unidad_medida,
              cantidad,
              stockAnterior,
              stockNuevo,
              `Devolución por cancelación de servicio ${servicio[0].numero}`,
              id,
              usuario_id,
            ],
          )
        }
      }

      if (servicio[0].tipo_pago !== "CUENTA_CORRIENTE") {
        // Si es pago múltiple, obtener los movimientos originales y crear egresos correspondientes
        if (servicio[0].pago_dividido) {
          const [movimientosOriginales] = await connection.execute(
            `SELECT id, metodo_pago, monto 
             FROM movimientos_caja 
             WHERE referencia_tipo = 'SERVICE' AND referencia_id = ? AND tipo = 'INGRESO' AND estado = 'ACTIVO'`,
            [id],
          )

          for (const mov of movimientosOriginales) {
            // Crear un egreso por cada movimiento de ingreso original
            await connection.execute(
              `INSERT INTO movimientos_caja 
               (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
               VALUES (?, 'EGRESO', ?, ?, ?, 'SERVICIO_CANCELADO', ?, ?, ?)`,
              [
                servicio[0].sesion_caja_id,
                `Cancelación Servicio ${servicio[0].numero} - ${mov.metodo_pago}`,
                mov.monto,
                mov.metodo_pago,
                id,
                usuario_id,
                motivo || "Servicio cancelado",
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
          const montoDevolucion =
            servicio[0].total_con_interes_tarjeta && servicio[0].total_con_interes_tarjeta !== servicio[0].total
              ? servicio[0].total_con_interes_tarjeta
              : servicio[0].total

          await connection.execute(
            `INSERT INTO movimientos_caja 
             (sesion_caja_id, tipo, concepto, monto, metodo_pago, referencia_tipo, referencia_id, usuario_id, observaciones)
             VALUES (?, 'EGRESO', ?, ?, ?, 'SERVICIO_CANCELADO', ?, ?, ?)`,
            [
              servicio[0].sesion_caja_id,
              `Cancelación Servicio ${servicio[0].numero}`,
              montoDevolucion,
              servicio[0].tipo_pago,
              id,
              usuario_id,
              motivo || "Servicio cancelado",
            ],
          )
        }
      }

      if (servicio[0].tipo_pago === "CUENTA_CORRIENTE") {
        const [cuentaCorriente] = await connection.execute(
          "SELECT id, saldo FROM cuentas_corrientes WHERE cliente_id = ? AND activo = true",
          [servicio[0].cliente_id],
        )

        if (cuentaCorriente.length > 0) {
          const saldoAnterior = Number.parseFloat(cuentaCorriente[0].saldo)
          const montoServicio = Number.parseFloat(servicio[0].total)
          const saldoNuevo = saldoAnterior - montoServicio

          await connection.execute("UPDATE cuentas_corrientes SET saldo = ? WHERE id = ?", [
            saldoNuevo,
            cuentaCorriente[0].id,
          ])

          await connection.execute(
            `INSERT INTO movimientos_cuenta_corriente 
             (cuenta_corriente_id, tipo, monto, saldo_anterior, saldo_nuevo, descripcion, referencia_tipo, referencia_id, usuario_id, observaciones)
             VALUES (?, 'PAGO', ?, ?, ?, ?, 'SERVICIO_CANCELADO', ?, ?, ?)`,
            [
              cuentaCorriente[0].id,
              montoServicio,
              saldoAnterior,
              saldoNuevo,
              `Reversión por cancelación de servicio ${servicio[0].numero}`,
              id,
              usuario_id,
              motivo || "Servicio cancelado",
            ],
          )
        }
      }

      await connection.commit()

      const [servicioActualizado] = await connection.execute(
        `SELECT s.*, 
                c.nombre as cliente_nombre, c.apellido as cliente_apellido,
                v.patente, v.marca, v.modelo,
                suc.nombre as sucursal_nombre,
                u.nombre as usuario_nombre,
                uc.nombre as usuario_cancelacion_nombre
         FROM servicios s
         LEFT JOIN clientes c ON s.cliente_id = c.id
         LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
         LEFT JOIN sucursales suc ON s.sucursal_id = suc.id
         LEFT JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN usuarios uc ON s.cancelado_por = uc.id
         WHERE s.id = ?`,
        [id],
      )

      res.json(servicioActualizado[0])
    } catch (error) {
      await connection.rollback()
      console.error("Error al cancelar servicio:", error)
      res.status(500).json({ error: "Error al cancelar el servicio: " + error.message })
    } finally {
      connection.release()
    }
  },
}

module.exports = serviciosController
