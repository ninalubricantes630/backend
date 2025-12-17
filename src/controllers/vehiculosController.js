const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const vehiculosController = {
  // Obtener todos los vehículos con paginación y filtros
  getVehiculos: async (req, res) => {
    try {
      let {
        page = 1,
        limit = 10,
        search = "",
        searchCriteria = "patente",
        clienteId = "",
        sucursal_id = "",
        sucursales_ids = "",
      } = req.query

      page = Number.parseInt(page, 10) || 1
      limit = Number.parseInt(limit, 10) || 10
      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      let query = `SELECT v.id, v.patente, v.marca, v.modelo, v.año, 
               v.kilometraje, v.observaciones,
               v.cliente_id, v.sucursal_id, s.nombre as sucursal_nombre,
               v.activo, v.created_at, v.updated_at,
               CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre,
               c.dni as cliente_dni, c.telefono as cliente_telefono, c.direccion as cliente_direccion,
               GROUP_CONCAT(
                 DISTINCT CONCAT(
                   serv.id, '|',
                   serv.numero, '|',
                   COALESCE(serv.descripcion, ''), '|',
                   COALESCE(serv.total, 0), '|',
                   COALESCE(serv.created_at, ''), '|',
                   COALESCE(serv.estado, ''), '|',
                   COALESCE(serv.interes_sistema_monto, 0), '|',
                   COALESCE(serv.interes_tarjeta_monto, 0), '|',
                   COALESCE(serv.total_con_interes_tarjeta, 0)
                 ) ORDER BY serv.created_at DESC SEPARATOR ';;'
               ) as servicios_data
        FROM vehiculos v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN sucursales s ON v.sucursal_id = s.id
        LEFT JOIN servicios serv ON v.id = serv.vehiculo_id
        WHERE v.activo = true`

      let countQuery = `
        SELECT COUNT(DISTINCT v.id) as total 
        FROM vehiculos v 
        LEFT JOIN clientes c ON v.cliente_id = c.id 
        LEFT JOIN sucursales s ON v.sucursal_id = s.id
        WHERE v.activo = true
      `

      const queryParams = []
      const countParams = []

      if (sucursal_id) {
        query += " AND (v.sucursal_id = ? OR v.sucursal_id IS NULL)"
        countQuery += " AND (v.sucursal_id = ? OR v.sucursal_id IS NULL)"
        queryParams.push(sucursal_id)
        countParams.push(sucursal_id)
      } else if (sucursales_ids) {
        const idsArray = sucursales_ids.split(",").map((id) => id.trim())
        const placeholders = idsArray.map(() => "?").join(",")
        query += ` AND (v.sucursal_id IN (${placeholders}) OR v.sucursal_id IS NULL)`
        countQuery += ` AND (v.sucursal_id IN (${placeholders}) OR v.sucursal_id IS NULL)`
        queryParams.push(...idsArray)
        countParams.push(...idsArray)
      }

      // Filtro por cliente específico
      if (clienteId) {
        query += " AND v.cliente_id = ?"
        countQuery += " AND v.cliente_id = ?"
        queryParams.push(clienteId)
        countParams.push(clienteId)
      }

      if (search) {
        let searchCondition = ""
        const searchParam = `%${search}%`

        switch (searchCriteria) {
          case "patente":
            searchCondition = " AND v.patente LIKE ?"
            queryParams.push(searchParam)
            countParams.push(searchParam)
            break
          case "marca_modelo":
            searchCondition = " AND (v.marca LIKE ? OR v.modelo LIKE ? OR CONCAT(v.marca, ' ', v.modelo) LIKE ?)"
            queryParams.push(searchParam, searchParam, searchParam)
            countParams.push(searchParam, searchParam, searchParam)
            break
          case "cliente":
            searchCondition = " AND (CONCAT(c.nombre, ' ', c.apellido) LIKE ? OR c.nombre LIKE ? OR c.apellido LIKE ?)"
            queryParams.push(searchParam, searchParam, searchParam)
            countParams.push(searchParam, searchParam, searchParam)
            break
          default:
            searchCondition =
              " AND (v.patente LIKE ? OR v.marca LIKE ? OR v.modelo LIKE ? OR CONCAT(c.nombre, ' ', c.apellido) LIKE ?)"
            queryParams.push(searchParam, searchParam, searchParam, searchParam)
            countParams.push(searchParam, searchParam, searchParam, searchParam)
        }

        query += searchCondition
        countQuery += searchCondition
      }

      query += `
        GROUP BY v.id, v.patente, v.marca, v.modelo, v.año, v.kilometraje, v.observaciones, 
                 v.cliente_id, v.sucursal_id, v.activo, v.created_at, v.updated_at, 
                 c.nombre, c.apellido, c.dni, c.telefono, c.direccion, s.nombre
        ORDER BY v.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      const [vehiculos] = await db.pool.execute(query, queryParams)
      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total

      const processedVehiculos = vehiculos.map((vehiculo) => {
        const servicios = []

        if (vehiculo.servicios_data) {
          const serviciosArray = vehiculo.servicios_data.split(";;")
          for (const servicioStr of serviciosArray) {
            if (servicioStr.trim()) {
              const [
                id,
                numero,
                descripcion,
                total,
                created_at,
                estado,
                interes_sistema_monto,
                interes_tarjeta_monto,
                total_con_interes_tarjeta,
              ] = servicioStr.split("|")

              const totalBase = Number.parseFloat(total) || 0
              const interesSistema = Number.parseFloat(interes_sistema_monto) || 0
              const interesTarjeta = Number.parseFloat(interes_tarjeta_monto) || 0
              const totalConInteresTarjeta = Number.parseFloat(total_con_interes_tarjeta) || 0

              // Calcular totales según la misma lógica que en reportes
              const total_con_interes = interesSistema > 0 ? totalBase : null
              const total_con_interes_tarjeta_final = totalConInteresTarjeta > 0 ? totalConInteresTarjeta : null

              servicios.push({
                id: Number.parseInt(id) || 0,
                numero: numero || "",
                descripcion: descripcion || "",
                total: totalBase,
                total_con_interes: total_con_interes,
                total_con_interes_tarjeta: total_con_interes_tarjeta_final,
                fecha_creacion: created_at || "",
                estado: estado || "",
              })
            }
          }
        }

        const { servicios_data, ...vehiculoData } = vehiculo
        return {
          ...vehiculoData,
          servicios,
        }
      })

      const totalPages = Math.ceil(total / limit)
      const pagination = {
        page,
        limit,
        total,
        totalPages,
      }

      return ResponseHelper.success(res, {
        vehiculos: processedVehiculos,
        pagination,
      })
    } catch (error) {
      console.error("Error al obtener vehículos:", error)
      return ResponseHelper.error(res, "Error al obtener vehículos", 500)
    }
  },

  // Obtener vehículo por ID
  getVehiculoById: async (req, res) => {
    try {
      const { id } = req.params

      const [vehiculos] = await db.pool.execute(
        `SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre, s.nombre as sucursal_nombre
         FROM vehiculos v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         LEFT JOIN sucursales s ON v.sucursal_id = s.id
         WHERE v.id = ? AND v.activo = true`,
        [id],
      )

      if (vehiculos.length === 0) {
        return ResponseHelper.error(res, "Vehículo no encontrado", 404)
      }

      return ResponseHelper.success(res, vehiculos[0])
    } catch (error) {
      console.error("Error al obtener vehículo:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Crear nuevo vehículo
  createVehiculo: async (req, res) => {
    try {
      const { clienteId, patente, marca, modelo, año, kilometraje, observaciones, sucursal_id } = req.body

      const [cliente] = await db.pool.execute("SELECT id FROM clientes WHERE id = ? AND activo = true", [clienteId])
      if (cliente.length === 0) {
        return ResponseHelper.error(res, "Cliente no encontrado", 400)
      }

      if (sucursal_id) {
        const [sucursales] = await db.pool.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
          sucursal_id,
        ])
        if (sucursales.length === 0) {
          return ResponseHelper.error(res, "Sucursal no encontrada o inactiva", 400)
        }
      }

      const [existingVehiculo] = await db.pool.execute("SELECT id FROM vehiculos WHERE patente = ? AND activo = true", [
        patente,
      ])
      if (existingVehiculo.length > 0) {
        return ResponseHelper.error(res, "Ya existe un vehículo con esa patente", 400)
      }

      const [result] = await db.pool.execute(
        `INSERT INTO vehiculos (
          cliente_id, patente, marca, modelo, año, kilometraje, observaciones, sucursal_id, activo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)`,
        [clienteId, patente, marca, modelo, año, kilometraje, observaciones, sucursal_id || null],
      )

      const [newVehiculo] = await db.pool.execute(
        `SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre, s.nombre as sucursal_nombre
         FROM vehiculos v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         LEFT JOIN sucursales s ON v.sucursal_id = s.id
         WHERE v.id = ?`,
        [result.insertId],
      )

      return ResponseHelper.success(res, newVehiculo[0], 201)
    } catch (error) {
      console.error("Error al crear vehículo:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Actualizar vehículo
  updateVehiculo: async (req, res) => {
    try {
      const { id } = req.params
      const { clienteId, patente, marca, modelo, año, kilometraje, observaciones, sucursal_id } = req.body

      const [existingVehiculo] = await db.pool.execute("SELECT id FROM vehiculos WHERE id = ? AND activo = true", [id])
      if (existingVehiculo.length === 0) {
        return ResponseHelper.error(res, "Vehículo no encontrado", 404)
      }

      const [cliente] = await db.pool.execute("SELECT id FROM clientes WHERE id = ? AND activo = true", [clienteId])
      if (cliente.length === 0) {
        return ResponseHelper.error(res, "Cliente no encontrado", 400)
      }

      if (sucursal_id) {
        const [sucursales] = await db.pool.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
          sucursal_id,
        ])
        if (sucursales.length === 0) {
          return ResponseHelper.error(res, "Sucursal no encontrada o inactiva", 400)
        }
      }

      const [duplicateVehiculo] = await db.pool.execute(
        "SELECT id FROM vehiculos WHERE patente = ? AND id != ? AND activo = true",
        [patente, id],
      )
      if (duplicateVehiculo.length > 0) {
        return ResponseHelper.error(res, "Ya existe otro vehículo con esa patente", 400)
      }

      await db.pool.execute(
        `UPDATE vehiculos 
         SET cliente_id = ?, patente = ?, marca = ?, modelo = ?, año = ?, 
             kilometraje = ?, observaciones = ?, sucursal_id = ?
         WHERE id = ?`,
        [clienteId, patente, marca, modelo, año, kilometraje, observaciones, sucursal_id || null, id],
      )

      const [updatedVehiculo] = await db.pool.execute(
        `SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre, s.nombre as sucursal_nombre
         FROM vehiculos v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         LEFT JOIN sucursales s ON v.sucursal_id = s.id
         WHERE v.id = ?`,
        [id],
      )

      return ResponseHelper.success(res, updatedVehiculo[0])
    } catch (error) {
      console.error("Error al actualizar vehículo:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Eliminar vehículo (soft delete)
  deleteVehiculo: async (req, res) => {
    try {
      const { id } = req.params

      const [existingVehiculo] = await db.pool.execute("SELECT id FROM vehiculos WHERE id = ? AND activo = true", [id])
      if (existingVehiculo.length === 0) {
        return ResponseHelper.error(res, "Vehículo no encontrado", 404)
      }

      const [servicios] = await db.pool.execute(
        "SELECT id FROM servicios WHERE vehiculo_id = ? AND estado IN ('PENDIENTE', 'EN_PROGRESO')",
        [id],
      )
      if (servicios.length > 0) {
        return ResponseHelper.error(res, "No se puede eliminar el vehículo porque tiene servicios pendientes", 400)
      }

      await db.pool.execute("UPDATE vehiculos SET activo = false WHERE id = ?", [id])

      return ResponseHelper.success(res, { message: "Vehículo eliminado correctamente" })
    } catch (error) {
      console.error("Error al eliminar vehículo:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Obtener vehículos por cliente
  getVehiculosByCliente: async (req, res) => {
    try {
      const { clienteId } = req.params
      const clienteIdNum = Number.parseInt(clienteId, 10)
      if (isNaN(clienteIdNum) || clienteIdNum <= 0) {
        return ResponseHelper.error(res, "ID de cliente inválido", 400)
      }

      const [vehiculos] = await db.pool.execute(
        `SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre, s.nombre as sucursal_nombre
         FROM vehiculos v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         LEFT JOIN sucursales s ON v.sucursal_id = s.id
         WHERE v.cliente_id = ? AND v.activo = true
         ORDER BY v.patente ASC`,
        [clienteIdNum],
      )

      return ResponseHelper.success(res, { data: vehiculos })
    } catch (error) {
      console.error("Error al obtener vehículos del cliente:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },

  // Actualizar kilometraje
  actualizarKilometraje: async (req, res) => {
    try {
      const { id } = req.params
      const { kilometraje } = req.body

      const [existingVehiculo] = await db.pool.execute(
        "SELECT kilometraje FROM vehiculos WHERE id = ? AND activo = true",
        [id],
      )
      if (existingVehiculo.length === 0) {
        return ResponseHelper.error(res, "Vehículo no encontrado", 404)
      }

      const kilometrajeAnterior = existingVehiculo[0].kilometraje
      if (kilometraje < kilometrajeAnterior) {
        return ResponseHelper.error(res, "El nuevo kilometraje no puede ser menor al actual", 400)
      }

      await db.pool.execute("UPDATE vehiculos SET kilometraje = ? WHERE id = ?", [kilometraje, id])

      const [updatedVehiculo] = await db.pool.execute(
        `SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) as cliente_nombre, s.nombre as sucursal_nombre
         FROM vehiculos v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         LEFT JOIN sucursales s ON v.sucursal_id = s.id
         WHERE v.id = ?`,
        [id],
      )

      return ResponseHelper.success(res, updatedVehiculo[0])
    } catch (error) {
      console.error("Error al actualizar kilometraje:", error)
      return ResponseHelper.error(res, "Error interno del servidor", 500)
    }
  },
}

module.exports = vehiculosController
