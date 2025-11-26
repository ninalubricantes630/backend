const db = require("../config/database")

// Obtener todos los permisos
const getPermisos = async (req, res) => {
  try {
    const query = `
      SELECT id, codigo, nombre, descripcion, modulo, icono, activo
      FROM permisos
      WHERE activo = TRUE
      ORDER BY modulo, nombre
    `
    const [permisos] = await db.pool.execute(query)

    return res.json({
      success: true,
      data: permisos,
    })
  } catch (error) {
    console.error("Error al obtener permisos:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Obtener permisos de un usuario
const getPermisosUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params

    // Verificar que el usuario existe y es empleado
    const [user] = await db.pool.execute("SELECT id, rol FROM usuarios WHERE id = ?", [usuarioId])

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      })
    }

    if (user[0].rol !== "empleado") {
      return res.status(400).json({
        success: false,
        message: "Solo los empleados pueden tener permisos asignados",
      })
    }

    const query = `
      SELECT 
        p.id,
        p.codigo,
        p.nombre,
        p.descripcion,
        p.modulo,
        p.icono,
        IF(up.id IS NOT NULL, 1, 0) AS asignado
      FROM permisos p
      LEFT JOIN usuario_permisos up ON p.id = up.permiso_id AND up.usuario_id = ?
      WHERE p.activo = TRUE
      ORDER BY p.modulo, p.nombre
    `

    const [permisos] = await db.pool.execute(query, [usuarioId])

    // Agrupar permisos por módulo
    const permisosAgrupados = {}
    permisos.forEach((permiso) => {
      if (!permisosAgrupados[permiso.modulo]) {
        permisosAgrupados[permiso.modulo] = []
      }
      permisosAgrupados[permiso.modulo].push(permiso)
    })

    return res.json({
      success: true,
      data: permisosAgrupados,
    })
  } catch (error) {
    console.error("Error al obtener permisos del usuario:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Asignar/actualizar permisos a un usuario
const actualizarPermisosUsuario = async (req, res) => {
  const connection = await db.pool.getConnection()

  try {
    await connection.beginTransaction()

    const { usuarioId } = req.params
    const { permisos } = req.body // Array de IDs de permisos
    const adminId = req.user.id

    // Validar que el usuario existe y es empleado
    const [user] = await connection.execute("SELECT id, rol FROM usuarios WHERE id = ?", [usuarioId])

    if (user.length === 0) {
      await connection.rollback()
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      })
    }

    if (user[0].rol !== "empleado") {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "Solo los empleados pueden tener permisos asignados",
      })
    }

    // Validar que no se intenta asignar permisos a sí mismo
    if (adminId === usuarioId) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        message: "No puedes modificar tus propios permisos",
      })
    }

    // Eliminar permisos anteriores
    await connection.execute("DELETE FROM usuario_permisos WHERE usuario_id = ?", [usuarioId])

    // Insertar nuevos permisos
    if (Array.isArray(permisos) && permisos.length > 0) {
      for (const permiso_id of permisos) {
        // Validar que el permiso existe
        const [perm] = await connection.execute("SELECT id FROM permisos WHERE id = ? AND activo = TRUE", [permiso_id])

        if (perm.length > 0) {
          await connection.execute(
            `INSERT INTO usuario_permisos (usuario_id, permiso_id, otorgado_por)
             VALUES (?, ?, ?)`,
            [usuarioId, permiso_id, adminId],
          )
        }
      }
    }

    await connection.commit()

    return res.json({
      success: true,
      message: "Permisos actualizados exitosamente",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Error al actualizar permisos:", error)
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  } finally {
    connection.release()
  }
}

module.exports = {
  getPermisos,
  getPermisosUsuario,
  actualizarPermisosUsuario,
}
