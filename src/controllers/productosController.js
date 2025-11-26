const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")
const importHelper = require("../utils/importHelper")

const productosController = {
  // Obtener todos los productos con filtros y paginación
  getProductos: async (req, res) => {
    try {
      const {
        search,
        categoria_id,
        unidad_medida,
        precio_min,
        precio_max,
        sucursal_id,
        sucursales_ids,
        page = 1,
        limit = 10,
        offset: offsetParam = 0,
      } = req.query

      let query = `
        SELECT p.*, c.nombre as categoria_nombre, s.nombre as sucursal_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN sucursales s ON p.sucursal_id = s.id
        WHERE p.activo = true
      `
      let countQuery = "SELECT COUNT(*) as total FROM productos p WHERE p.activo = true"
      const queryParams = []
      const countParams = []

      // Filtro de búsqueda
      if (search) {
        query += " AND (p.nombre LIKE ? OR p.descripcion LIKE ? OR p.codigo LIKE ? OR p.fabricante LIKE ?)"
        countQuery += " AND (p.nombre LIKE ? OR p.descripcion LIKE ? OR p.codigo LIKE ? OR p.fabricante LIKE ?)"
        const searchParam = `%${search}%`
        queryParams.push(searchParam, searchParam, searchParam, searchParam)
        countParams.push(searchParam, searchParam, searchParam, searchParam)
      }

      // Filtro por categoría
      if (categoria_id) {
        query += " AND p.categoria_id = ?"
        countQuery += " AND p.categoria_id = ?"
        queryParams.push(categoria_id)
        countParams.push(categoria_id)
      }

      // Filtro por unidad de medida
      if (unidad_medida) {
        query += " AND p.unidad_medida = ?"
        countQuery += " AND p.unidad_medida = ?"
        queryParams.push(unidad_medida)
        countParams.push(unidad_medida)
      }

      // Filtro por rango de precio
      if (precio_min) {
        query += " AND p.precio >= ?"
        countQuery += " AND p.precio >= ?"
        queryParams.push(Number.parseFloat(precio_min))
        countParams.push(Number.parseFloat(precio_min))
      }

      if (precio_max) {
        query += " AND p.precio <= ?"
        countQuery += " AND p.precio <= ?"
        queryParams.push(Number.parseFloat(precio_max))
        countParams.push(Number.parseFloat(precio_max))
      }

      if (sucursales_ids) {
        const idsArray = sucursales_ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id)
        if (idsArray.length > 0) {
          const placeholders = idsArray.map(() => "?").join(",")
          query += ` AND p.sucursal_id IN (${placeholders})`
          countQuery += ` AND p.sucursal_id IN (${placeholders})`
          queryParams.push(...idsArray)
          countParams.push(...idsArray)
        }
      } else if (sucursal_id) {
        query += " AND p.sucursal_id = ?"
        countQuery += " AND p.sucursal_id = ?"
        queryParams.push(sucursal_id)
        countParams.push(sucursal_id)
      }

      const limitNum = Math.max(1, Math.min(100, Number.parseInt(limit) || 10))
      const offsetNum = Math.max(
        0,
        Number.parseInt(offsetParam) || Number.parseInt(page > 1 ? (page - 1) * limitNum : 0) || 0,
      )

      query += ` ORDER BY p.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`

      console.log("[v0] Query:", query.substring(0, 100) + "...", "Params count:", queryParams.length)

      const [productos] = await db.pool.execute(query, queryParams)
      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total

      return ResponseHelper.success(res, {
        productos,
        pagination: {
          page: Number.parseInt(page),
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      })
    } catch (error) {
      console.error("[v0] Error al obtener productos:", error.message, error.stack)
      logger.error("Error al obtener productos:", error)
      return ResponseHelper.error(res, "Error al obtener productos", 500)
    }
  },

  // Obtener un producto por ID
  getProductoById: async (req, res) => {
    try {
      const { id } = req.params
      const [productos] = await db.pool.execute(
        `SELECT 
          p.*,
          c.nombre as categoria_nombre,
          s.nombre as sucursal_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN sucursales s ON p.sucursal_id = s.id
        WHERE p.id = ? AND p.activo = true`,
        [id],
      )

      if (productos.length === 0) {
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      return ResponseHelper.success(res, productos[0], "Producto obtenido exitosamente")
    } catch (error) {
      logger.error("Error al obtener producto:", error)
      return ResponseHelper.error(res, "Error al obtener producto", 500)
    }
  },

  // Crear un nuevo producto
  createProducto: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const {
        codigo,
        nombre,
        descripcion,
        categoria_id,
        fabricante,
        precio,
        stock = 0,
        stock_minimo = 0,
        sucursal_id,
        unidad_medida = "unidad",
      } = req.body

      // Validar campos requeridos
      if (!nombre || !categoria_id || precio === undefined || !sucursal_id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(
          res,
          "Faltan campos requeridos: nombre, categoria_id, precio, sucursal_id",
        )
      }

      if (!["unidad", "litro"].includes(unidad_medida)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "La unidad de medida debe ser 'unidad' o 'litro'")
      }

      const stockNum = Number.parseFloat(stock)
      if (isNaN(stockNum) || stockNum < 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "El stock debe ser un número positivo")
      }

      if (unidad_medida === "unidad" && !Number.isInteger(stockNum)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "El stock para productos de unidad debe ser un número entero")
      }

      // Validar que la categoría existe
      const [categorias] = await connection.execute("SELECT id FROM categorias WHERE id = ? AND activo = true", [
        categoria_id,
      ])

      if (categorias.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Categoría no encontrada")
      }

      // Validar que la sucursal existe
      const [sucursales] = await connection.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
        sucursal_id,
      ])

      if (sucursales.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Sucursal no encontrada")
      }

      // Verificar si el código ya existe (si se proporciona)
      if (codigo) {
        const [existingProducto] = await connection.execute(
          "SELECT id FROM productos WHERE codigo = ? AND activo = true",
          [codigo],
        )

        if (existingProducto.length > 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.conflict(res, "El código de producto ya existe")
        }
      }

      const [result] = await connection.execute(
        `INSERT INTO productos (
          codigo, nombre, descripcion, categoria_id, fabricante, precio, 
          unidad_medida, stock, stock_minimo, sucursal_id, activo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
        [
          codigo || null,
          nombre,
          descripcion || null,
          categoria_id,
          fabricante || null,
          precio,
          unidad_medida,
          stockNum,
          stock_minimo,
          sucursal_id,
        ],
      )

      if (stockNum > 0) {
        await connection.execute(
          `INSERT INTO movimientos_stock (
            producto_id, tipo, unidad_medida, cantidad, 
            stock_anterior, stock_nuevo, motivo, usuario_id
          ) VALUES (?, 'ENTRADA', ?, ?, 0, ?, 'Stock inicial', ?)`,
          [result.insertId, unidad_medida, stockNum, stockNum, req.user?.id || null],
        )
      }

      await connection.commit()

      // Obtener el producto creado con sus relaciones
      const [nuevoProducto] = await connection.execute(
        `SELECT 
          p.*,
          c.nombre as categoria_nombre,
          s.nombre as sucursal_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN sucursales s ON p.sucursal_id = s.id
        WHERE p.id = ?`,
        [result.insertId],
      )

      connection.release()

      logger.info(`Producto creado: ${nombre} (ID: ${result.insertId}), unidad: ${unidad_medida}`)
      return ResponseHelper.created(res, nuevoProducto[0], "Producto creado exitosamente")
    } catch (error) {
      await connection.rollback()
      connection.release()
      logger.error("Error al crear producto:", error)
      return ResponseHelper.error(res, `Error al crear producto: ${error.message}`, 500)
    }
  },

  // Actualizar un producto
  updateProducto: async (req, res) => {
    try {
      const { id } = req.params
      const {
        codigo,
        nombre,
        descripcion,
        categoria_id,
        fabricante,
        precio,
        stock_minimo,
        sucursal_id,
        unidad_medida,
      } = req.body

      // Verificar que el producto existe
      const [productos] = await db.pool.execute("SELECT * FROM productos WHERE id = ? AND activo = true", [id])

      if (productos.length === 0) {
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      if (unidad_medida && !["unidad", "litro"].includes(unidad_medida)) {
        return ResponseHelper.validationError(res, "La unidad de medida debe ser 'unidad' o 'litro'")
      }

      // Verificar si el código ya existe en otro producto
      if (codigo && codigo !== productos[0].codigo) {
        const [existingProducto] = await db.pool.execute(
          "SELECT id FROM productos WHERE codigo = ? AND id != ? AND activo = true",
          [codigo, id],
        )

        if (existingProducto.length > 0) {
          return ResponseHelper.conflict(res, "El código de producto ya existe")
        }
      }

      // Validar que la categoría existe
      const [categorias] = await db.pool.execute("SELECT id FROM categorias WHERE id = ? AND activo = true", [
        categoria_id,
      ])

      if (categorias.length === 0) {
        return ResponseHelper.notFound(res, "Categoría no encontrada")
      }

      // Validar que la sucursal existe
      const [sucursales] = await db.pool.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
        sucursal_id,
      ])

      if (sucursales.length === 0) {
        return ResponseHelper.notFound(res, "Sucursal no encontrada")
      }

      const updateFields = []
      const updateValues = []

      updateFields.push(
        "codigo = ?",
        "nombre = ?",
        "descripcion = ?",
        "categoria_id = ?",
        "fabricante = ?",
        "precio = ?",
      )
      updateValues.push(codigo || null, nombre, descripcion || null, categoria_id, fabricante || null, precio)

      if (stock_minimo !== undefined) {
        updateFields.push("stock_minimo = ?")
        updateValues.push(stock_minimo || 0)
      }

      updateFields.push("sucursal_id = ?")
      updateValues.push(sucursal_id)

      if (unidad_medida) {
        const unidadActual = productos[0].unidad_medida
        updateFields.push("unidad_medida = ?")
        updateValues.push(unidad_medida)

        // Si la unidad de medida cambió, poner el stock en cero
        if (unidad_medida !== unidadActual) {
          updateFields.push("stock = ?")
          updateValues.push(0)
        }
      }

      updateValues.push(id)

      await db.pool.execute(`UPDATE productos SET ${updateFields.join(", ")} WHERE id = ?`, updateValues)

      // Obtener el producto actualizado
      const [productoActualizado] = await db.pool.execute(
        `SELECT 
          p.*,
          c.nombre as categoria_nombre,
          s.nombre as sucursal_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN sucursales s ON p.sucursal_id = s.id
        WHERE p.id = ?`,
        [id],
      )

      logger.info(`Producto actualizado: ${nombre} (ID: ${id})`)
      return ResponseHelper.updated(res, productoActualizado[0], "Producto actualizado exitosamente")
    } catch (error) {
      logger.error("Error al actualizar producto:", error)
      return ResponseHelper.error(res, "Error al actualizar producto", 500)
    }
  },

  // Cambiar estado de un producto (activar/desactivar)
  toggleEstadoProducto: async (req, res) => {
    try {
      const { id } = req.params

      const [productos] = await db.pool.execute("SELECT * FROM productos WHERE id = ?", [id])

      if (productos.length === 0) {
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      const nuevoEstado = productos[0].activo ? false : true

      await db.pool.execute("UPDATE productos SET activo = ? WHERE id = ?", [nuevoEstado, id])

      logger.info(`Estado de producto cambiado: ID ${id} -> ${nuevoEstado ? "activo" : "inactivo"}`)
      return ResponseHelper.updated(res, { activo: nuevoEstado }, "Estado del producto actualizado exitosamente")
    } catch (error) {
      logger.error("Error al cambiar estado del producto:", error)
      return ResponseHelper.error(res, "Error al cambiar estado del producto", 500)
    }
  },

  // Eliminar un producto (soft delete)
  deleteProducto: async (req, res) => {
    try {
      const { id } = req.params

      const [productos] = await db.pool.execute("SELECT * FROM productos WHERE id = ? AND activo = true", [id])

      if (productos.length === 0) {
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      await db.pool.execute("UPDATE productos SET activo = false WHERE id = ?", [id])

      logger.info(`Producto eliminado: ID ${id}`)
      return ResponseHelper.deleted(res, "Producto eliminado exitosamente")
    } catch (error) {
      logger.error("Error al eliminar producto:", error)
      return ResponseHelper.error(res, "Error al eliminar producto", 500)
    }
  },

  // Registrar movimiento de stock
  registrarMovimiento: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { id } = req.params
      const { tipo, cantidad, motivo } = req.body

      // Validar tipo de movimiento
      if (!["ENTRADA", "SALIDA", "AJUSTE"].includes(tipo)) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Tipo de movimiento inválido")
      }

      // Obtener producto actual
      const [productos] = await connection.execute("SELECT * FROM productos WHERE id = ? AND activo = true", [id])

      if (productos.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Producto no encontrado")
      }

      const producto = productos[0]
      const stockAnterior = Number.parseFloat(producto.stock)
      const unidad_medida = producto.unidad_medida || "unidad"

      const cantidadNum = Number.parseFloat(cantidad)
      if (isNaN(cantidadNum) || cantidadNum <= 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "La cantidad debe ser un número mayor a 0")
      }

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
            return ResponseHelper.validationError(res, "Stock insuficiente")
          }
          break
        case "AJUSTE":
          stockNuevo = cantidadNum
          break
      }

      // Actualizar stock del producto
      await connection.execute("UPDATE productos SET stock = ? WHERE id = ?", [stockNuevo, id])

      await connection.execute(
        `INSERT INTO movimientos_stock (
          producto_id, tipo, unidad_medida, cantidad, 
          stock_anterior, stock_nuevo, motivo, usuario_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tipo, unidad_medida, cantidadNum, stockAnterior, stockNuevo, motivo || null, req.user?.id || null],
      )

      await connection.commit()

      // Obtener producto actualizado
      const [productoActualizado] = await connection.execute(
        `SELECT 
          p.*,
          c.nombre as categoria_nombre,
          s.nombre as sucursal_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN sucursales s ON p.sucursal_id = s.id
        WHERE p.id = ?`,
        [id],
      )

      connection.release()

      logger.info(
        `Movimiento de stock registrado: Producto ${id}, Tipo: ${tipo}, Cantidad: ${cantidadNum} ${unidad_medida}`,
      )
      return ResponseHelper.success(res, productoActualizado[0], "Movimiento de stock registrado exitosamente")
    } catch (error) {
      await connection.rollback()
      connection.release()
      logger.error("Error al registrar movimiento de stock:", error)
      return ResponseHelper.error(res, "Error al registrar movimiento de stock", 500)
    }
  },

  // Obtener historial de movimientos de un producto
  getMovimientos: async (req, res) => {
    try {
      const { id } = req.params
      let page = Number.parseInt(req.query.page, 10) || 1
      let limit = Number.parseInt(req.query.limit, 10) || 10

      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      const query = `
        SELECT 
          m.*,
          u.nombre as usuario_nombre
        FROM movimientos_stock m
        LEFT JOIN usuarios u ON m.usuario_id = u.id
        WHERE m.producto_id = ?
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      const countQuery = `
        SELECT COUNT(*) as total
        FROM movimientos_stock
        WHERE producto_id = ?
      `

      const [movimientos] = await db.pool.execute(query, [id])
      const [countResult] = await db.pool.execute(countQuery, [id])
      const total = countResult[0].total

      return ResponseHelper.successWithPagination(
        res,
        movimientos,
        { page, limit, total },
        "Movimientos obtenidos exitosamente",
      )
    } catch (error) {
      logger.error("Error al obtener movimientos:", error)
      return ResponseHelper.error(res, "Error al obtener movimientos", 500)
    }
  },

  // Importar productos desde Excel/CSV
  importarProductosExcel: async (req, res) => {
    const connection = await db.pool.getConnection()
    try {
      await connection.beginTransaction()

      const { productos, sucursal_id } = req.body

      if (!productos || !Array.isArray(productos) || productos.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "No se proporcionaron productos para importar")
      }

      if (!sucursal_id) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.validationError(res, "Debe seleccionar una sucursal")
      }

      // Validar que la sucursal existe
      const [sucursales] = await connection.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
        sucursal_id,
      ])

      if (sucursales.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Sucursal no encontrada")
      }

      const categoriasCache = await importHelper.procesarCategorias(connection, productos)

      const resultado = await importHelper.procesarProductosPorLotes(
        connection,
        productos,
        sucursal_id,
        categoriasCache,
        req.user?.id,
      )

      await connection.commit()
      connection.release()

      const { productosCreados, productosActualizados, productosConError, errores } = resultado

      const mensaje = `Importación completada: ${productosCreados} creados, ${productosActualizados} actualizados, ${productosConError} con errores`

      if (productosConError > 0) {
        logger.warn(mensaje)
        logger.warn(`Total de errores en importación: ${errores.length}`)
      } else {
        logger.info(mensaje)
      }

      return ResponseHelper.success(
        res,
        {
          productosCreados,
          productosActualizados,
          productosConError,
          errores: errores.slice(0, 50),
          totalErrores: errores.length,
          totalProcesados: productosCreados + productosActualizados + productosConError,
        },
        mensaje,
      )
    } catch (error) {
      await connection.rollback()
      connection.release()
      logger.error("Error al importar productos desde Excel:", error)
      return ResponseHelper.serverError(res, "Error al importar productos desde Excel")
    }
  },
}

module.exports = productosController
