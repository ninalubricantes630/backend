const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const clientesController = {
  // Obtener todos los clientes con paginación y filtros
  getClientes: async (req, res) => {
    try {
      let { page = 1, limit = 10, search = "", searchBy = "", sucursal_id = "", sucursales_ids = "" } = req.query

      page = Number.parseInt(page, 10) || 1
      limit = Number.parseInt(limit, 10) || 10
      page = page < 1 ? 1 : page
      limit = limit < 1 ? 10 : limit
      limit = Math.min(limit, 100)
      const offset = (page - 1) * limit

      let query = `
        SELECT DISTINCT
          c.id, c.nombre, c.apellido, c.dni, c.telefono, c.direccion, 
          c.sucursal_id, s.nombre as sucursal_nombre,
          c.activo, c.created_at, c.updated_at,
          cc.id as cuenta_id,
          cc.saldo as saldo_cuenta,
          cc.limite_credito,
          cc.activo as cuenta_activa,
          GROUP_CONCAT(DISTINCT CONCAT(
            v.id, '|', v.patente, '|', v.marca, '|', v.modelo, '|', 
            COALESCE(v.año, ''), '|', COALESCE(v.kilometraje, '')
          ) SEPARATOR ';;') as vehiculos_data,
          GROUP_CONCAT(DISTINCT CONCAT(
            serv.id, '|', serv.numero, '|', serv.descripcion, '|', 
            DATE_FORMAT(serv.created_at, '%Y-%m-%d'), '|', 
            COALESCE(serv.precio_referencia, ''), '|', v2.patente, '|',
            COALESCE(serv.observaciones, ''), '|', serv.created_at
          ) ORDER BY serv.created_at DESC SEPARATOR ';;') as servicios_data
        FROM clientes c
        LEFT JOIN sucursales s ON c.sucursal_id = s.id
        LEFT JOIN cuentas_corrientes cc ON c.id = cc.cliente_id AND cc.activo = 1
        LEFT JOIN vehiculos v ON c.id = v.cliente_id AND v.activo = true
        LEFT JOIN servicios serv ON c.id = serv.cliente_id AND serv.activo = true
        LEFT JOIN vehiculos v2 ON serv.vehiculo_id = v2.id
        WHERE c.activo = true
      `

      let countQuery = `
        SELECT COUNT(DISTINCT c.id) as total 
        FROM clientes c 
        LEFT JOIN sucursales s ON c.sucursal_id = s.id
        WHERE c.activo = true
      `

      const queryParams = []
      const countParams = []

      if (sucursal_id) {
        query += " AND (c.sucursal_id = ? OR c.sucursal_id IS NULL)"
        countQuery += " AND (c.sucursal_id = ? OR c.sucursal_id IS NULL)"
        queryParams.push(sucursal_id)
        countParams.push(sucursal_id)
      } else if (sucursales_ids) {
        const idsArray = sucursales_ids.split(",").map((id) => id.trim())
        const placeholders = idsArray.map(() => "?").join(",")
        query += ` AND (c.sucursal_id IN (${placeholders}) OR c.sucursal_id IS NULL)`
        countQuery += ` AND (c.sucursal_id IN (${placeholders}) OR c.sucursal_id IS NULL)`
        queryParams.push(...idsArray)
        countParams.push(...idsArray)
      }

      if (search) {
        let searchCondition = ""
        const searchParam = `%${search}%`

        switch (searchBy) {
          case "nombre":
            searchCondition = " AND (c.nombre LIKE ? OR CONCAT(c.nombre, ' ', c.apellido) LIKE ?)"
            queryParams.push(searchParam, searchParam)
            countParams.push(searchParam, searchParam)
            break
          case "apellido":
            searchCondition = " AND c.apellido LIKE ?"
            queryParams.push(searchParam)
            countParams.push(searchParam)
            break
          case "dni":
            searchCondition = " AND c.dni LIKE ?"
            queryParams.push(searchParam)
            countParams.push(searchParam)
            break
          case "telefono":
            searchCondition = " AND c.telefono LIKE ?"
            queryParams.push(searchParam)
            countParams.push(searchParam)
            break
          default:
            searchCondition =
              " AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.dni LIKE ? OR c.telefono LIKE ? OR CONCAT(c.nombre, ' ', c.apellido) LIKE ?)"
            queryParams.push(searchParam, searchParam, searchParam, searchParam, searchParam)
            countParams.push(searchParam, searchParam, searchParam, searchParam, searchParam)
        }

        query += searchCondition
        countQuery += searchCondition
      }

      query += ` GROUP BY c.id ORDER BY c.nombre ASC, c.apellido ASC LIMIT ${limit} OFFSET ${offset}`

      const [clientesRaw] = await db.pool.execute(query, queryParams)
      const [countResult] = await db.pool.execute(countQuery, countParams)
      const total = countResult[0].total

      const clientes = clientesRaw.map((cliente) => {
        const clienteData = {
          id: cliente.id,
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          dni: cliente.dni,
          telefono: cliente.telefono,
          direccion: cliente.direccion,
          sucursal_id: cliente.sucursal_id,
          sucursal_nombre: cliente.sucursal_nombre,
          activo: cliente.activo,
          created_at: cliente.created_at,
          updated_at: cliente.updated_at,
          tiene_cuenta_corriente: cliente.cuenta_activa === 1,
          saldo_cuenta: cliente.saldo_cuenta || 0,
          limite_credito: cliente.limite_credito || 0,
          vehiculos: [],
          servicios: [],
        }

        // Parse vehicles data
        if (cliente.vehiculos_data) {
          clienteData.vehiculos = cliente.vehiculos_data.split(";;").map((vehiculoStr) => {
            const [id, patente, marca, modelo, año, kilometraje] = vehiculoStr.split("|")
            return {
              id: Number.parseInt(id),
              patente,
              marca,
              modelo,
              año: año ? Number.parseInt(año) : null,
              kilometraje: kilometraje ? Number.parseInt(kilometraje) : null,
            }
          })
        }

        // Parse services data
        if (cliente.servicios_data) {
          clienteData.servicios = cliente.servicios_data.split(";;").map((servicioStr) => {
            const [id, numero, descripcion, fecha, precio, vehiculoPatente, observaciones, created_at] =
              servicioStr.split("|")
            return {
              id: Number.parseInt(id),
              numero,
              descripcion,
              fecha,
              precio: precio ? Number.parseFloat(precio) : null,
              vehiculo: vehiculoPatente,
              observaciones: observaciones || null,
              created_at: created_at || null,
              items_count: 1,
            }
          })
        }

        return clienteData
      })

      return ResponseHelper.success(res, {
        data: clientes,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          limit,
        },
      })
    } catch (error) {
      console.error("Error al obtener clientes:", error)
      return ResponseHelper.error(res, "Error al obtener clientes", 500, "DATABASE_ERROR", error)
    }
  },

  // Obtener cliente por ID
  getClienteById: async (req, res) => {
    const connection = await db.getConnection()
    try {
      const { id } = req.params

      const [clientes] = await connection.execute(
        "SELECT c.*, s.nombre as sucursal_nombre FROM clientes c LEFT JOIN sucursales s ON c.sucursal_id = s.id WHERE c.id = ? AND c.activo = true",
        [id],
      )

      if (clientes.length === 0) {
        return ResponseHelper.notFound(res, "Cliente no encontrado", "CLIENT_NOT_FOUND")
      }

      const cliente = clientes[0]
      const [cuentaCorriente] = await connection.execute(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [id],
      )

      if (cuentaCorriente.length > 0) {
        cliente.tiene_cuenta_corriente = true
        cliente.limite_credito = cuentaCorriente[0].limite_credito
        cliente.saldo_actual = cuentaCorriente[0].saldo
      } else {
        cliente.tiene_cuenta_corriente = false
        cliente.limite_credito = 0
        cliente.saldo_actual = 0
      }

      return ResponseHelper.success(res, cliente)
    } catch (error) {
      console.error("Error al obtener cliente:", error)
      return ResponseHelper.error(res, "Error al obtener cliente", 500, "DATABASE_ERROR", error)
    } finally {
      connection.release()
    }
  },

  // Crear nuevo cliente
  createCliente: async (req, res) => {
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()

      const { nombre, apellido, dni, telefono, direccion, tiene_cuenta_corriente, limite_credito, sucursal_id } =
        req.body

      if (dni) {
        const [existingCliente] = await connection.execute("SELECT id FROM clientes WHERE dni = ? AND activo = true", [
          dni,
        ])
        if (existingCliente.length > 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.error(res, "Ya existe un cliente con ese DNI", 400, "DUPLICATE_DNI")
        }
      }

      if (sucursal_id) {
        const [sucursales] = await connection.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
          sucursal_id,
        ])
        if (sucursales.length === 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.error(res, "Sucursal no encontrada o inactiva", 400, "SUCURSAL_NOT_FOUND")
        }
      }

      const [result] = await connection.execute(
        `INSERT INTO clientes (nombre, apellido, dni, telefono, direccion, sucursal_id, activo) 
         VALUES (?, ?, ?, ?, ?, ?, true)`,
        [nombre, apellido, dni || null, telefono || null, direccion || null, sucursal_id || null],
      )

      const clienteId = result.insertId

      if (tiene_cuenta_corriente === true || tiene_cuenta_corriente === "true") {
        const creditLimit = limite_credito ? Number.parseFloat(limite_credito) : 0

        // Check if cuenta corriente already exists
        const [existingCuenta] = await connection.execute("SELECT id FROM cuentas_corrientes WHERE cliente_id = ?", [
          clienteId,
        ])

        if (existingCuenta.length > 0) {
          // Update existing cuenta corriente
          await connection.execute(
            `UPDATE cuentas_corrientes 
             SET limite_credito = ?, activo = 1, updated_at = NOW() 
             WHERE cliente_id = ?`,
            [creditLimit, clienteId],
          )
        } else {
          // Create new cuenta corriente
          await connection.execute(
            `INSERT INTO cuentas_corrientes (cliente_id, saldo, limite_credito, activo) 
             VALUES (?, 0, ?, 1)`,
            [clienteId, creditLimit],
          )
        }
      }

      await connection.commit()

      const [newCliente] = await connection.execute(
        "SELECT c.*, s.nombre as sucursal_nombre FROM clientes c LEFT JOIN sucursales s ON c.sucursal_id = s.id WHERE c.id = ?",
        [clienteId],
      )

      const cliente = newCliente[0]
      if (tiene_cuenta_corriente === true || tiene_cuenta_corriente === "true") {
        const [cuentaCorriente] = await connection.execute(
          "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
          [clienteId],
        )
        if (cuentaCorriente.length > 0) {
          cliente.tiene_cuenta_corriente = true
          cliente.limite_credito = cuentaCorriente[0].limite_credito
          cliente.saldo_actual = cuentaCorriente[0].saldo
        }
      } else {
        cliente.tiene_cuenta_corriente = false
        cliente.limite_credito = 0
        cliente.saldo_actual = 0
      }

      return ResponseHelper.success(res, cliente, "Cliente creado exitosamente", 201)
    } catch (error) {
      await connection.rollback()
      console.error("[v0] Error al crear cliente:", error)
      return ResponseHelper.error(res, "Error al crear cliente", 500, "DATABASE_ERROR", error)
    } finally {
      connection.release()
    }
  },

  // Actualizar cliente
  updateCliente: async (req, res) => {
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()

      const { id } = req.params
      const { nombre, apellido, dni, telefono, direccion, tiene_cuenta_corriente, limite_credito, sucursal_id } =
        req.body

      const [existingCliente] = await connection.execute("SELECT id FROM clientes WHERE id = ? AND activo = true", [id])
      if (existingCliente.length === 0) {
        await connection.rollback()
        connection.release()
        return ResponseHelper.notFound(res, "Cliente no encontrado", "CLIENT_NOT_FOUND")
      }

      if (dni) {
        const [duplicateCliente] = await connection.execute(
          "SELECT id FROM clientes WHERE dni = ? AND id != ? AND activo = true",
          [dni, id],
        )
        if (duplicateCliente.length > 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.error(res, "Ya existe otro cliente con ese DNI", 400, "DUPLICATE_DNI")
        }
      }

      if (sucursal_id) {
        const [sucursales] = await connection.execute("SELECT id FROM sucursales WHERE id = ? AND activo = true", [
          sucursal_id,
        ])
        if (sucursales.length === 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.error(res, "Sucursal no encontrada o inactiva", 400, "SUCURSAL_NOT_FOUND")
        }
      }

      await connection.execute(
        `UPDATE clientes 
         SET nombre = ?, apellido = ?, dni = ?, telefono = ?, direccion = ?, sucursal_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [nombre, apellido, dni || null, telefono || null, direccion || null, sucursal_id || null, id],
      )

      const [cuentaExistente] = await connection.execute("SELECT * FROM cuentas_corrientes WHERE cliente_id = ?", [id])

      const shouldHaveCuenta = tiene_cuenta_corriente === true || tiene_cuenta_corriente === "true"

      if (shouldHaveCuenta) {
        const creditLimit = limite_credito ? Number.parseFloat(limite_credito) : 0

        if (cuentaExistente.length === 0) {
          // Crear nueva cuenta corriente
          await connection.execute(
            `INSERT INTO cuentas_corrientes (cliente_id, saldo, limite_credito, activo) 
             VALUES (?, 0, ?, 1)`,
            [id, creditLimit],
          )
        } else {
          // Actualizar cuenta existente
          await connection.execute(
            `UPDATE cuentas_corrientes 
             SET limite_credito = ?, activo = 1, updated_at = NOW() 
             WHERE cliente_id = ?`,
            [creditLimit, id],
          )
        }
      } else if (cuentaExistente.length > 0) {
        // Verificar que no tenga saldo pendiente antes de desactivar
        if (Number.parseFloat(cuentaExistente[0].saldo) > 0) {
          await connection.rollback()
          connection.release()
          return ResponseHelper.error(
            res,
            "No se puede desactivar la cuenta corriente porque tiene saldo pendiente",
            400,
            "CUENTA_CON_SALDO",
          )
        }
        // Desactivar cuenta corriente
        await connection.execute("UPDATE cuentas_corrientes SET activo = 0, updated_at = NOW() WHERE cliente_id = ?", [
          id,
        ])
      }

      await connection.commit()

      const [updatedCliente] = await connection.execute(
        "SELECT c.*, s.nombre as sucursal_nombre FROM clientes c LEFT JOIN sucursales s ON c.sucursal_id = s.id WHERE c.id = ?",
        [id],
      )

      const cliente = updatedCliente[0]
      const [cuentaCorriente] = await connection.execute(
        "SELECT * FROM cuentas_corrientes WHERE cliente_id = ? AND activo = 1",
        [id],
      )

      if (cuentaCorriente.length > 0) {
        cliente.tiene_cuenta_corriente = true
        cliente.limite_credito = cuentaCorriente[0].limite_credito
        cliente.saldo_actual = cuentaCorriente[0].saldo
      } else {
        cliente.tiene_cuenta_corriente = false
        cliente.limite_credito = 0
        cliente.saldo_actual = 0
      }

      return ResponseHelper.success(res, cliente, "Cliente actualizado exitosamente")
    } catch (error) {
      await connection.rollback()
      console.error("[v0] Error al actualizar cliente:", error)
      return ResponseHelper.error(res, "Error al actualizar cliente", 500, "DATABASE_ERROR", error)
    } finally {
      connection.release()
    }
  },

  // Eliminar cliente (soft delete)
  deleteCliente: async (req, res) => {
    try {
      const { id } = req.params

      if (id === "1") {
        return ResponseHelper.error(
          res,
          "No se puede eliminar el cliente Consumidor Final",
          400,
          "CONSUMIDOR_FINAL_PROTECTED",
        )
      }

      const [existingCliente] = await db.pool.execute(
        "SELECT id, nombre FROM clientes WHERE id = ? AND activo = true",
        [id],
      )
      if (existingCliente.length === 0) {
        return ResponseHelper.notFound(res, "Cliente no encontrado", "CLIENT_NOT_FOUND")
      }

      if (existingCliente[0].nombre?.toLowerCase().includes("consumidor final")) {
        return ResponseHelper.error(
          res,
          "No se puede eliminar el cliente Consumidor Final",
          400,
          "CONSUMIDOR_FINAL_PROTECTED",
        )
      }

      const [vehiculos] = await db.pool.execute("SELECT id FROM vehiculos WHERE cliente_id = ? AND activo = true", [id])
      if (vehiculos.length > 0) {
        return ResponseHelper.error(
          res,
          "No se puede eliminar el cliente porque tiene vehículos asociados",
          400,
          "VEHICLES_ASSOCIATED",
        )
      }

      const [servicios] = await db.pool.execute(
        "SELECT id FROM servicios WHERE cliente_id = ? AND estado IN ('PENDIENTE', 'EN_PROGRESO')",
        [id],
      )
      if (servicios.length > 0) {
        return ResponseHelper.error(
          res,
          "No se puede eliminar el cliente porque tiene servicios pendientes",
          400,
          "SERVICES_PENDING",
        )
      }

      await db.pool.execute("UPDATE clientes SET activo = false WHERE id = ?", [id])

      return ResponseHelper.success(res, { message: "Cliente eliminado correctamente" })
    } catch (error) {
      console.error("Error al eliminar cliente:", error)
      return ResponseHelper.error(res, "Error al eliminar cliente", 500, "DATABASE_ERROR", error)
    }
  },
}

module.exports = clientesController
