const db = require("../config/database")

// Obtener configuración del sistema
const getConfiguracion = async (req, res) => {
  try {
    const query = `
      SELECT * FROM configuracion 
      WHERE activo = 1 
      ORDER BY categoria, clave
    `

    const configuraciones = await db.query(query)

    // Organizar por categorías
    const configPorCategoria = configuraciones.reduce((acc, config) => {
      if (!acc[config.categoria]) {
        acc[config.categoria] = {}
      }
      acc[config.categoria][config.clave] = {
        valor: config.valor,
        tipo: config.tipo,
        descripcion: config.descripcion,
      }
      return acc
    }, {})

    res.json({
      success: true,
      data: configPorCategoria,
    })
  } catch (error) {
    console.error("Error al obtener configuración:", error)
    res.status(500).json({
      success: false,
      message: "Error al obtener la configuración del sistema",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Actualizar configuración
const updateConfiguracion = async (req, res) => {
  let transaction
  try {
    console.log("[v0] Starting configuration update...")
    const { configuraciones } = req.body

    if (!configuraciones || !Array.isArray(configuraciones)) {
      return res.status(400).json({
        success: false,
        message: "Debe proporcionar un array de configuraciones",
      })
    }

    console.log("[v0] Configurations to update:", configuraciones)

    // Create transaction object
    transaction = await db.beginTransaction()

    for (const config of configuraciones) {
      const { categoria, clave, valor, tipo } = config

      console.log(`[v0] Updating ${categoria}.${clave} to:`, valor)

      const updateQuery = `
        UPDATE configuracion 
        SET valor = ?, updated_at = NOW(), updated_by = ?
        WHERE categoria = ? AND clave = ? AND activo = 1
      `

      await transaction.query(updateQuery, [valor, req.user.id, categoria, clave])
    }

    // Commit the transaction
    await transaction.commit()

    console.log("[v0] Configuration updated successfully")

    res.json({
      success: true,
      message: "Configuración actualizada correctamente",
    })
  } catch (error) {
    // Rollback if transaction exists
    if (transaction) {
      await transaction.rollback()
    }
    console.error("[v0] Error updating configuration:", error)
    res.status(500).json({
      success: false,
      message: "Error al actualizar la configuración",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Obtener configuración específica por categoría
const getConfiguracionPorCategoria = async (req, res) => {
  try {
    const { categoria } = req.params

    const query = `
      SELECT clave, valor, tipo, descripcion 
      FROM configuracion 
      WHERE categoria = ? AND activo = 1
      ORDER BY clave
    `

    const configuraciones = await db.query(query, [categoria])

    const configObj = configuraciones.reduce((acc, config) => {
      acc[config.clave] = {
        valor: config.valor,
        tipo: config.tipo,
        descripcion: config.descripcion,
      }
      return acc
    }, {})

    res.json({
      success: true,
      data: configObj,
    })
  } catch (error) {
    console.error("Error al obtener configuración por categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error al obtener la configuración",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Crear nueva configuración
const createConfiguracion = async (req, res) => {
  try {
    const { categoria, clave, valor, tipo, descripcion } = req.body

    // Verificar si ya existe
    const existeQuery = `
      SELECT id FROM configuracion 
      WHERE categoria = ? AND clave = ?
    `
    const existe = await db.query(existeQuery, [categoria, clave])

    if (existe.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Ya existe una configuración con esa categoría y clave",
      })
    }

    const insertQuery = `
      INSERT INTO configuracion (categoria, clave, valor, tipo, descripcion, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `

    const result = await db.query(insertQuery, [categoria, clave, valor, tipo, descripcion, req.user.id])

    res.status(201).json({
      success: true,
      message: "Configuración creada correctamente",
      data: { id: result.insertId },
    })
  } catch (error) {
    console.error("Error al crear configuración:", error)
    res.status(500).json({
      success: false,
      message: "Error al crear la configuración",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Eliminar configuración (soft delete)
const deleteConfiguracion = async (req, res) => {
  try {
    const { id } = req.params

    const updateQuery = `
      UPDATE configuracion 
      SET activo = 0, updated_at = NOW(), updated_by = ?
      WHERE id = ?
    `

    const result = await db.query(updateQuery, [req.user.id, id])

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Configuración no encontrada",
      })
    }

    res.json({
      success: true,
      message: "Configuración eliminada correctamente",
    })
  } catch (error) {
    console.error("Error al eliminar configuración:", error)
    res.status(500).json({
      success: false,
      message: "Error al eliminar la configuración",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

module.exports = {
  getConfiguracion,
  updateConfiguracion,
  getConfiguracionPorCategoria,
  createConfiguracion,
  deleteConfiguracion,
}
