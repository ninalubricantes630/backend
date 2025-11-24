const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const movimientosStockController = {
  // Obtener movimientos de un producto con paginación
  getMovimientosByProducto: async (req, res) => {
    try {
      const { productoId } = req.params
      let { page = 1, limit = 10 } = req.query

      page = Number.parseInt(page, 10) || 1
      limit = Number.parseInt(limit, 10) || 10
      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      const [movimientos] = await db.pool.execute(
        `SELECT m.*, u.nombre as usuario_nombre
         FROM movimientos_stock m
         LEFT JOIN usuarios u ON m.usuario_id = u.id
         WHERE m.producto_id = ?
         ORDER BY m.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [productoId],
      )

      const [countResult] = await db.pool.execute(
        "SELECT COUNT(*) as total FROM movimientos_stock WHERE producto_id = ?",
        [productoId],
      )
      const total = countResult[0].total

      return ResponseHelper.successWithPagination(
        res,
        movimientos,
        { page, limit, total },
        "Movimientos obtenidos exitosamente",
      )
    } catch (error) {
      return ResponseHelper.error(res, "Error al obtener movimientos", error)
    }
  },

  // Registrar movimiento de stock
  registrarMovimiento: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { producto_id, tipo, cantidad, motivo } = req.body

      if (!req.user || !req.user.id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.error(res, "Usuario no autenticado", null, 401)
      }

      const usuarioId = req.user.id

      // Validar campos requeridos
      if (!producto_id || !tipo || !cantidad) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Faltan campos requeridos")
      }

      // Validar tipo de movimiento
      if (!["ENTRADA", "SALIDA", "AJUSTE"].includes(tipo)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Tipo de movimiento inválido")
      }

      const cantidadNum = Number.parseFloat(cantidad)
      if (isNaN(cantidadNum) || cantidadNum <= 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "La cantidad debe ser un número mayor a 0")
      }

      // Obtener producto actual
      const [productos] = await connection.execute(
        "SELECT id, stock, nombre, unidad_medida FROM productos WHERE id = ? AND activo = true",
        [producto_id],
      )

      if (productos.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      const producto = productos[0]
      const stockAnterior = Number.parseFloat(producto.stock)
      const unidad_medida = producto.unidad_medida || "unidad"

      if (unidad_medida === "unidad" && !Number.isInteger(cantidadNum)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "La cantidad para productos de unidad debe ser un número entero")
      }

      let stockNuevo = stockAnterior

      // Calcular nuevo stock según tipo de movimiento
      switch (tipo) {
        case "ENTRADA":
          stockNuevo = stockAnterior + cantidadNum
          break
        case "SALIDA":
          stockNuevo = stockAnterior - cantidadNum
          if (stockNuevo < 0) {
            await connection.rollback()
            connection.release()
            return ResponseHelper.validationError(res, "Stock insuficiente para realizar la salida")
          }
          break
        case "AJUSTE":
          stockNuevo = cantidadNum // En ajuste, la cantidad es el nuevo stock total
          break
      }

      // Registrar movimiento con unidad_medida
      const [result] = await connection.execute(
        `INSERT INTO movimientos_stock 
         (producto_id, tipo, unidad_medida, cantidad, stock_anterior, stock_nuevo, motivo, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [producto_id, tipo, unidad_medida, cantidadNum, stockAnterior, stockNuevo, motivo || null, usuarioId],
      )

      // Actualizar stock del producto
      await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [stockNuevo, producto_id])

      await connection.commit()
      connection.release()

      // Obtener el movimiento creado con datos del usuario
      const [movimiento] = await db.pool.execute(
        `SELECT m.*, u.nombre as usuario_nombre, p.nombre as producto_nombre
         FROM movimientos_stock m
         LEFT JOIN usuarios u ON m.usuario_id = u.id
         LEFT JOIN productos p ON m.producto_id = p.id
         WHERE m.id = ?`,
        [result.insertId],
      )

      return ResponseHelper.created(res, movimiento[0], "Movimiento registrado exitosamente")
    } catch (error) {
      console.error("Error al registrar movimiento:", error)
      await connection.rollback()
      connection.release()
      return ResponseHelper.error(res, "Error al registrar movimiento", error)
    }
  },

  // Obtener historial completo de movimientos con filtros
  getHistorialMovimientos: async (req, res) => {
    try {
      let { page = 1, limit = 10, tipo, sucursalId, fechaDesde, fechaHasta } = req.query

      page = Number.parseInt(page, 10) || 1
      limit = Number.parseInt(limit, 10) || 10
      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      let query = `SELECT m.*, 
                   p.nombre as producto_nombre, p.codigo as producto_codigo,
                   u.nombre as usuario_nombre,
                   s.nombre as sucursal_nombre
            FROM movimientos_stock m
            LEFT JOIN productos p ON m.producto_id = p.id
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            LEFT JOIN sucursales s ON p.sucursal_id = s.id
            WHERE 1=1`

      let countQuery = `SELECT COUNT(*) as total
                 FROM movimientos_stock m
                 LEFT JOIN productos p ON m.producto_id = p.id
                 WHERE 1=1`

      const queryParams = []
      const countParams = []

      if (tipo) {
        query += " AND m.tipo = ?"
        countQuery += " AND m.tipo = ?"
        queryParams.push(tipo)
        countParams.push(tipo)
      }

      if (sucursalId) {
        query += " AND p.sucursal_id = ?"
        countQuery += " AND p.sucursal_id = ?"
        queryParams.push(sucursalId)
        countParams.push(sucursalId)
      }

      if (fechaDesde) {
        query += " AND DATE(m.created_at) >= ?"
        countQuery += " AND DATE(m.created_at) >= ?"
        queryParams.push(fechaDesde)
        countParams.push(fechaDesde)
      }

      if (fechaHasta) {
        query += " AND DATE(m.created_at) <= ?"
        countQuery += " AND DATE(m.created_at) <= ?"
        queryParams.push(fechaHasta)
        countParams.push(fechaHasta)
      }

      query += ` ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`

      const [movimientos] = await db.pool.execute(query, queryParams)
      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total

      return ResponseHelper.successWithPagination(
        res,
        movimientos,
        { page, limit, total },
        "Historial de movimientos obtenido exitosamente",
      )
    } catch (error) {
      return ResponseHelper.error(res, "Error al obtener historial de movimientos", error)
    }
  },
}

module.exports = movimientosStockController
