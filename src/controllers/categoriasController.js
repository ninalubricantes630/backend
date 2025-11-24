const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const categoriasController = {
  // Obtener todas las categorías
  getCategorias: async (req, res) => {
    try {
      let page = Number.parseInt(req.query.page, 10) || 1
      let limit = Number.parseInt(req.query.limit, 10) || 50
      const search = req.query.search || ""

      // Normalizar valores
      page = page < 1 ? 1 : page
      limit = limit < 1 ? 50 : limit
      limit = Math.min(limit, 100) // máximo 100
      const offset = (page - 1) * limit

      let query = `SELECT * FROM categorias WHERE activo = true`
      let countQuery = "SELECT COUNT(*) as total FROM categorias WHERE activo = true"
      const queryParams = []
      const countParams = []

      // Filtro de búsqueda
      if (search) {
        query += " AND (nombre LIKE ? OR descripcion LIKE ?)"
        countQuery += " AND (nombre LIKE ? OR descripcion LIKE ?)"
        const searchParam = `%${search}%`
        queryParams.push(searchParam, searchParam)
        countParams.push(searchParam, searchParam)
      }

      // Inyectar LIMIT/OFFSET validados directamente
      query += ` ORDER BY nombre ASC LIMIT ${limit} OFFSET ${offset}`

      const [categorias] = await db.pool.execute(query, queryParams)

      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total

      const totalPages = Math.ceil(total / limit)

      return ResponseHelper.success(
        res,
        {
          categorias,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
        "Categorías obtenidas exitosamente",
      )
    } catch (error) {
      console.error("Error al obtener categorías:", error)
      return ResponseHelper.error(res, "Error al obtener categorías", 500)
    }
  },

  // Obtener categoría por ID
  getCategoriaById: async (req, res) => {
    try {
      const { id } = req.params
      const [categorias] = await db.pool.execute("SELECT * FROM categorias WHERE id = ? AND activo = true", [id])

      if (categorias.length === 0) {
        return ResponseHelper.notFound(res, "Categoría no encontrada")
      }

      return ResponseHelper.success(res, categorias[0], "Categoría obtenida exitosamente")
    } catch (error) {
      console.error("Error al obtener categoría:", error)
      return ResponseHelper.error(res, "Error al obtener categoría", 500)
    }
  },

  // Crear nueva categoría
  createCategoria: async (req, res) => {
    try {
      const { nombre, descripcion } = req.body

      if (!nombre || nombre.trim().length === 0) {
        return ResponseHelper.validationError(res, "El nombre es requerido")
      }

      const [existing] = await db.pool.execute("SELECT id FROM categorias WHERE nombre = ? AND activo = true", [nombre])

      if (existing.length > 0) {
        return ResponseHelper.conflict(res, "Ya existe una categoría con ese nombre")
      }

      const [result] = await db.pool.execute(
        "INSERT INTO categorias (nombre, descripcion, activo) VALUES (?, ?, true)",
        [nombre, descripcion || null],
      )

      const [newCategoria] = await db.pool.execute("SELECT * FROM categorias WHERE id = ?", [result.insertId])

      return ResponseHelper.created(res, newCategoria[0], "Categoría creada exitosamente")
    } catch (error) {
      console.error("Error al crear categoría:", error)
      return ResponseHelper.error(res, "Error al crear categoría", 500)
    }
  },

  // Actualizar categoría
  updateCategoria: async (req, res) => {
    try {
      const { id } = req.params
      const { nombre, descripcion } = req.body

      const [existing] = await db.pool.execute("SELECT id FROM categorias WHERE id = ? AND activo = true", [id])
      if (existing.length === 0) {
        return ResponseHelper.notFound(res, "Categoría no encontrada")
      }

      const [duplicate] = await db.pool.execute(
        "SELECT id FROM categorias WHERE nombre = ? AND id != ? AND activo = true",
        [nombre, id],
      )
      if (duplicate.length > 0) {
        return ResponseHelper.conflict(res, "Ya existe otra categoría con ese nombre")
      }

      await db.pool.execute("UPDATE categorias SET nombre = ?, descripcion = ? WHERE id = ?", [nombre, descripcion, id])

      const [updatedCategoria] = await db.pool.execute("SELECT * FROM categorias WHERE id = ?", [id])

      return ResponseHelper.updated(res, updatedCategoria[0], "Categoría actualizada exitosamente")
    } catch (error) {
      console.error("Error al actualizar categoría:", error)
      return ResponseHelper.error(res, "Error al actualizar categoría", 500)
    }
  },

  // Eliminar categoría (soft delete)
  deleteCategoria: async (req, res) => {
    try {
      const { id } = req.params

      const [existing] = await db.pool.execute("SELECT id FROM categorias WHERE id = ? AND activo = true", [id])
      if (existing.length === 0) {
        return ResponseHelper.notFound(res, "Categoría no encontrada")
      }

      const [productosUsando] = await db.pool.execute(
        "SELECT COUNT(*) as count FROM productos WHERE categoria_id = ?",
        [id],
      )
      if (productosUsando[0].count > 0) {
        return ResponseHelper.validationError(res, "No se puede eliminar la categoría porque tiene productos asociados")
      }

      await db.pool.execute("UPDATE categorias SET activo = false WHERE id = ?", [id])

      return ResponseHelper.deleted(res, "Categoría eliminada correctamente")
    } catch (error) {
      console.error("Error al eliminar categoría:", error)
      return ResponseHelper.error(res, "Error al eliminar categoría", 500)
    }
  },

  // Buscar categorías
  searchCategorias: async (req, res) => {
    try {
      const { q = "" } = req.query

      let query = `SELECT * FROM categorias WHERE activo = true`
      const queryParams = []

      if (q) {
        query += " AND (nombre LIKE ? OR descripcion LIKE ?)"
        const searchParam = `%${q}%`
        queryParams.push(searchParam, searchParam)
      }

      query += " ORDER BY nombre ASC LIMIT 20"

      const [categorias] = await db.pool.execute(query, queryParams)
      return ResponseHelper.success(res, categorias, "Búsqueda de categorías exitosa")
    } catch (error) {
      console.error("Error al buscar categorías:", error)
      return ResponseHelper.error(res, "Error al buscar categorías", 500)
    }
  },
}

module.exports = categoriasController
