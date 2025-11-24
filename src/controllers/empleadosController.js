const db = require("../config/database")
const { validationResult } = require("express-validator")
const responseHelper = require("../utils/responseHelper")

const empleadosController = {
  // Obtener todos los empleados con paginación y filtros
  async getEmpleados(req, res) {
    try {

      let page = Number.parseInt(req.query.page, 10) || 1
      let limit = Number.parseInt(req.query.limit, 10) || 10
      const search = req.query.search || ""
      const activo = req.query.activo

      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      let whereClause = "WHERE 1=1"
      const queryParams = []

      if (search) {
        whereClause += " AND (e.nombre LIKE ? OR e.apellido LIKE ? OR s.nombre LIKE ?)"
        const searchTerm = `%${search}%`
        queryParams.push(searchTerm, searchTerm, searchTerm)
      }

      if (activo !== undefined) {
        whereClause += " AND e.activo = ?"
        queryParams.push(activo === "true" ? 1 : 0)
      }

      const empleadosQuery = `
        SELECT 
          e.id,
          e.nombre,
          e.apellido,
          e.telefono,
          e.cargo,
          e.sucursal_id,
          s.nombre as sucursal_nombre,
          e.activo,
          e.created_at,
          e.updated_at
        FROM empleados e
        LEFT JOIN sucursales s ON e.sucursal_id = s.id
        ${whereClause}
        ORDER BY e.nombre ASC, e.apellido ASC
        LIMIT ${limit} OFFSET ${offset}
      `

      const countQuery = `
        SELECT COUNT(*) as total
        FROM empleados e
        LEFT JOIN sucursales s ON e.sucursal_id = s.id
        ${whereClause}
      `


      const [empleados] = await db.pool.execute(empleadosQuery, queryParams)
      const [countResult] = await db.pool.execute(countQuery, queryParams)


      const total = countResult[0]?.total || 0
      const totalPages = Math.ceil(total / limit)

      res.json({
        success: true,
        data: {
          empleados,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      })
    } catch (error) {
      console.error("[v0] Error al obtener empleados:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Obtener empleado por ID
  async getEmpleadoById(req, res) {
    try {
      const { id } = req.params

      const query = `
        SELECT 
          e.id,
          e.nombre,
          e.apellido,
          e.telefono,
          e.cargo,
          e.sucursal_id,
          s.nombre as sucursal_nombre,
          e.activo,
          e.created_at,
          e.updated_at
        FROM empleados e
        LEFT JOIN sucursales s ON e.sucursal_id = s.id
        WHERE e.id = ?
      `

      const [empleados] = await db.pool.execute(query, [id])

      if (empleados.length === 0) {
        return responseHelper.error(res, "Empleado no encontrado", 404)
      }

      responseHelper.success(res, empleados[0])
    } catch (error) {
      console.error("Error al obtener empleado:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Crear nuevo empleado
  async createEmpleado(req, res) {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return responseHelper.error(res, "Datos inválidos", 400, errors.array())
      }

      const { nombre, apellido, telefono, cargo, sucursal_id } = req.body

      // Verificar si la sucursal existe
      const [sucursalExists] = await db.pool.execute("SELECT id FROM sucursales WHERE id = ? AND activo = 1", [
        sucursal_id,
      ])

      if (sucursalExists.length === 0) {
        return responseHelper.error(res, "La sucursal especificada no existe", 400)
      }

      const query = `
        INSERT INTO empleados (nombre, apellido, telefono, cargo, sucursal_id, activo)
        VALUES (?, ?, ?, ?, ?, 1)
      `

      const [result] = await db.pool.execute(query, [nombre, apellido, telefono || null, cargo || null, sucursal_id])

      responseHelper.success(
        res,
        {
          id: result.insertId,
          nombre,
          apellido,
          telefono,
          cargo,
          sucursal_id,
          activo: true,
        },
        "Empleado creado exitosamente",
        201,
      )
    } catch (error) {
      console.error("Error al crear empleado:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Actualizar empleado
  async updateEmpleado(req, res) {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return responseHelper.error(res, "Datos inválidos", 400, errors.array())
      }

      const { id } = req.params
      const { nombre, apellido, telefono, cargo, sucursal_id, activo } = req.body

      const [existingEmpleado] = await db.pool.execute("SELECT id FROM empleados WHERE id = ?", [id])

      if (existingEmpleado.length === 0) {
        return responseHelper.error(res, "Empleado no encontrado", 404)
      }

      const [sucursalExists] = await db.pool.execute("SELECT id FROM sucursales WHERE id = ? AND activo = 1", [
        sucursal_id,
      ])

      if (sucursalExists.length === 0) {
        return responseHelper.error(res, "La sucursal especificada no existe", 400)
      }

      const query = `
        UPDATE empleados 
        SET nombre = ?, apellido = ?, telefono = ?, cargo = ?, sucursal_id = ?, activo = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `

      await db.pool.execute(query, [nombre, apellido, telefono || null, cargo || null, sucursal_id, activo, id])

      responseHelper.success(
        res,
        {
          id: Number.parseInt(id),
          nombre,
          apellido,
          telefono,
          cargo,
          sucursal_id,
          activo,
        },
        "Empleado actualizado exitosamente",
      )
    } catch (error) {
      console.error("Error al actualizar empleado:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Eliminar empleado (soft delete)
  async deleteEmpleado(req, res) {
    try {
      const { id } = req.params

      const [existingEmpleado] = await db.pool.execute("SELECT id FROM empleados WHERE id = ? AND activo = 1", [id])

      if (existingEmpleado.length === 0) {
        return responseHelper.error(res, "Empleado no encontrado", 404)
      }

      const [serviciosAsociados] = await db.pool.execute(
        "SELECT COUNT(*) as count FROM servicio_empleados WHERE empleado_id = ?",
        [id],
      )

      if (serviciosAsociados[0].count > 0) {
        return responseHelper.error(res, "No se puede eliminar el empleado porque tiene servicios asociados", 400)
      }

      await db.pool.execute("UPDATE empleados SET activo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id])

      responseHelper.success(res, null, "Empleado eliminado exitosamente")
    } catch (error) {
      console.error("Error al eliminar empleado:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Obtener empleados activos (para selects)
  async getEmpleadosActivos(req, res) {
    try {
      const query = `
        SELECT 
          e.id,
          CONCAT(e.nombre, ' ', e.apellido) as nombre_completo,
          e.nombre,
          e.apellido,
          e.cargo,
          e.sucursal_id,
          s.nombre as sucursal_nombre
        FROM empleados e
        LEFT JOIN sucursales s ON e.sucursal_id = s.id
        WHERE e.activo = 1 
        ORDER BY e.nombre ASC, e.apellido ASC
      `

      const [empleados] = await db.pool.execute(query)

      responseHelper.success(res, empleados)
    } catch (error) {
      console.error("Error al obtener empleados activos:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  async getEmpleadosBySucursal(req, res) {
    try {
      const { sucursalId } = req.params

      const query = `
        SELECT 
          e.id,
          CONCAT(e.nombre, ' ', e.apellido) as nombre_completo,
          e.nombre,
          e.apellido,
          e.cargo,
          e.sucursal_id,
          s.nombre as sucursal_nombre
        FROM empleados e
        LEFT JOIN sucursales s ON e.sucursal_id = s.id
        WHERE e.activo = 1 AND e.sucursal_id = ?
        ORDER BY e.nombre ASC, e.apellido ASC
      `

      const [empleados] = await db.pool.execute(query, [sucursalId])

      responseHelper.success(res, empleados)
    } catch (error) {
      console.error("Error al obtener empleados por sucursal:", error)
      responseHelper.error(res, "Error interno del servidor", 500)
    }
  },
}

module.exports = empleadosController
