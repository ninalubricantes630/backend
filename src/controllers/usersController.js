const bcrypt = require("bcrypt")
const db = require("../config/database")

// Obtener todos los usuarios (solo admin)
const getUsers = async (req, res) => {
  try {
    // Parseo y validación estricta de los parámetros de paginación
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    let limit = Number.parseInt(req.query.limit, 10)
    if (!Number.isInteger(limit) || limit <= 0) {
      limit = 10
    }
    limit = Math.max(1, Math.min(100, limit)) // entre 1 y 100
    const offset = (page - 1) * limit

    // Forzar tipos seguros
    const limitInt = Number(limit)
    const offsetInt = Number(offset >= 0 ? offset : 0)

    const search = (req.query.search || "").toString().trim()
    const rol = (req.query.rol || "").toString().trim()

    let whereClause = "WHERE 1=1"
    const params = []

    // Filtro por búsqueda (nombre o email)
    if (search) {
      whereClause += " AND (u.nombre LIKE ? OR u.email LIKE ?)"
      params.push(`%${search}%`, `%${search}%`)
    }

    // Filtro por rol
    if (rol) {
      whereClause += " AND u.rol = ?"
      params.push(rol)
    }

    const usersSql = `
      SELECT 
        u.id, 
        u.nombre, 
        u.email, 
        u.rol, 
        u.activo, 
        u.creado_en, 
        u.ultimo_login,
        GROUP_CONCAT(
          DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
          ORDER BY us.es_principal DESC, s.nombre
          SEPARATOR '|'
        ) as sucursales_info
      FROM usuarios u
      LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
      LEFT JOIN sucursales s ON us.sucursal_id = s.id AND s.activo = 1
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.creado_en DESC
      LIMIT ${limitInt} OFFSET ${offsetInt}
    `

    // Ejecutar consulta de usuarios (params solo para los filtros)
    const [users] = await db.pool.execute(usersSql, params)

    const usersWithSucursales = users.map((user) => {
      const sucursales = []
      if (user.sucursales_info) {
        const sucursalesArray = user.sucursales_info.split("|")
        sucursalesArray.forEach((info) => {
          const [id, nombre, esPrincipal] = info.split(":")
          sucursales.push({
            id: Number.parseInt(id),
            nombre: nombre,
            es_principal: esPrincipal === "1",
          })
        })
      }

      return {
        ...user,
        sucursales,
        sucursales_info: undefined, // Eliminar el campo temporal
      }
    })

    // Consulta para total de registros (usa los mismos params de filtro)
    const countSql = `SELECT COUNT(*) as total FROM usuarios u ${whereClause}`
    const [totalResult] = await db.pool.execute(countSql, params)

    const total = totalResult && totalResult[0] ? Number(totalResult[0].total) : 0
    const totalPages = limitInt > 0 ? Math.ceil(total / limitInt) : 0

    return res.json({
      success: true,
      data: {
        users: usersWithSucursales,
        pagination: {
          page,
          limit: limitInt,
          total,
          totalPages,
        },
      },
    })
  } catch (error) {
    // Logueo más informativo en development, y mínimo en producción
    if (process.env.NODE_ENV === "development") {
      console.error("Error al obtener usuarios:", error)
    } else {
      console.error("Error al obtener usuarios:", error.message)
    }

    // Responder con error genérico al cliente
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Crear usuario (solo admin)
const createUser = async (req, res) => {
  const connection = await db.pool.getConnection()

  try {
    await connection.beginTransaction()

    const { nombre, email, password, rol, sucursales } = req.body

    // Validar campos requeridos
    if (!nombre || !email || !password || !rol) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "Todos los campos son requeridos",
      })
    }

    if (!sucursales || !Array.isArray(sucursales) || sucursales.length === 0) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "Debe asignar al menos una sucursal al usuario",
      })
    }

    // Verificar si el email ya existe
    const [existingUsers] = await connection.execute("SELECT id FROM usuarios WHERE email = ?", [email])

    if (existingUsers.length > 0) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "El email ya está registrado",
      })
    }

    // Encriptar contraseña
    const saltRounds = 12
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Crear usuario
    const [result] = await connection.execute(
      `INSERT INTO usuarios (nombre, email, password, rol, activo, creado_en)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [nombre, email, hashedPassword, rol],
    )

    const userId = result.insertId

    for (const sucursal of sucursales) {
      await connection.execute(
        `INSERT INTO usuario_sucursales (usuario_id, sucursal_id, es_principal)
         VALUES (?, ?, ?)`,
        [userId, sucursal.sucursal_id, sucursal.es_principal || false],
      )
    }

    await connection.commit()

    // Obtener el usuario creado con sus sucursales
    const [newUser] = await connection.execute(
      `SELECT 
        u.id, u.nombre, u.email, u.rol, u.activo, u.creado_en,
        GROUP_CONCAT(
          DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
          ORDER BY us.es_principal DESC, s.nombre
          SEPARATOR '|'
        ) as sucursales_info
      FROM usuarios u
      LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
      LEFT JOIN sucursales s ON us.sucursal_id = s.id
      WHERE u.id = ?
      GROUP BY u.id`,
      [userId],
    )

    // Procesar sucursales
    const user = newUser[0]
    const sucursalesArray = []
    if (user.sucursales_info) {
      const sucursalesInfoArray = user.sucursales_info.split("|")
      sucursalesInfoArray.forEach((info) => {
        const [id, nombre, esPrincipal] = info.split(":")
        sucursalesArray.push({
          id: Number.parseInt(id),
          nombre: nombre,
          es_principal: esPrincipal === "1",
        })
      })
    }

    return res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente",
      data: {
        ...user,
        sucursales: sucursalesArray,
        sucursales_info: undefined,
      },
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al crear usuario:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  } finally {
    connection.release()
  }
}

// Actualizar usuario (solo admin)
const updateUser = async (req, res) => {
  const connection = await db.pool.getConnection()

  try {
    await connection.beginTransaction()

    const { id } = req.params
    const { nombre, email, password, rol, activo, sucursales } = req.body

    // Validar campos requeridos
    if (!nombre || !email || !rol) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "Nombre, email y rol son requeridos",
      })
    }

    if (!sucursales || !Array.isArray(sucursales) || sucursales.length === 0) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "Debe asignar al menos una sucursal al usuario",
      })
    }

    // Verificar si el usuario existe
    const [existingUsers] = await connection.execute("SELECT id FROM usuarios WHERE id = ?", [id])

    if (existingUsers.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      })
    }

    // Verificar si el email ya existe en otro usuario
    const [emailCheck] = await connection.execute("SELECT id FROM usuarios WHERE email = ? AND id != ?", [email, id])

    if (emailCheck.length > 0) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "El email ya está registrado por otro usuario",
      })
    }

    // Normalizar activo a 0/1
    const activoValue = activo === undefined ? 1 : activo ? 1 : 0

    if (password && password.trim() !== "") {
      const saltRounds = 12
      const hashedPassword = await bcrypt.hash(password, saltRounds)

      await connection.execute(
        `UPDATE usuarios
         SET nombre = ?, email = ?, password = ?, rol = ?, activo = ?, actualizado_en = NOW()
         WHERE id = ?`,
        [nombre, email, hashedPassword, rol, activoValue, id],
      )
    } else {
      await connection.execute(
        `UPDATE usuarios
         SET nombre = ?, email = ?, rol = ?, activo = ?, actualizado_en = NOW()
         WHERE id = ?`,
        [nombre, email, rol, activoValue, id],
      )
    }

    await connection.execute("DELETE FROM usuario_sucursales WHERE usuario_id = ?", [id])

    for (const sucursal of sucursales) {
      await connection.execute(
        `INSERT INTO usuario_sucursales (usuario_id, sucursal_id, es_principal)
         VALUES (?, ?, ?)`,
        [id, sucursal.sucursal_id, sucursal.es_principal || false],
      )
    }

    await connection.commit()

    // Obtener el usuario actualizado con sus sucursales
    const [updatedUser] = await connection.execute(
      `SELECT 
        u.id, u.nombre, u.email, u.rol, u.activo, u.creado_en, u.actualizado_en,
        GROUP_CONCAT(
          DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
          ORDER BY us.es_principal DESC, s.nombre
          SEPARATOR '|'
        ) as sucursales_info
      FROM usuarios u
      LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
      LEFT JOIN sucursales s ON us.sucursal_id = s.id
      WHERE u.id = ?
      GROUP BY u.id`,
      [id],
    )

    // Procesar sucursales
    const user = updatedUser[0]
    const sucursalesArray = []
    if (user.sucursales_info) {
      const sucursalesInfoArray = user.sucursales_info.split("|")
      sucursalesInfoArray.forEach((info) => {
        const [sucId, nombre, esPrincipal] = info.split(":")
        sucursalesArray.push({
          id: Number.parseInt(sucId),
          nombre: nombre,
          es_principal: esPrincipal === "1",
        })
      })
    }

    return res.json({
      success: true,
      message: "Usuario actualizado exitosamente",
      data: {
        ...user,
        sucursales: sucursalesArray,
        sucursales_info: undefined,
      },
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar usuario:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  } finally {
    connection.release()
  }
}

// Eliminar usuario (solo admin)
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params

    // No permitir eliminar al usuario actual
    if (Number.parseInt(id, 10) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "No puedes eliminar tu propio usuario",
      })
    }

    // Verificar si el usuario existe
    const [existingUsers] = await db.pool.execute("SELECT id FROM usuarios WHERE id = ?", [id])

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      })
    }

    // Soft delete - marcar como inactivo
    await db.pool.execute("UPDATE usuarios SET activo = 0, actualizado_en = NOW() WHERE id = ?", [id])

    return res.json({
      success: true,
      message: "Usuario eliminado exitosamente",
    })
  } catch (error) {
    console.error("Error al eliminar usuario:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
}
