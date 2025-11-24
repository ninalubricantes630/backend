const db = require("../config/database")

// Verificar si hay una caja abierta para una sucursal
const verificarCajaAbierta = async (sucursal_id) => {
  try {
    const [sesiones] = await db.query(
      `SELECT id, estado FROM sesiones_caja 
       WHERE sucursal_id = ? AND estado = 'ABIERTA' 
       ORDER BY fecha_apertura DESC LIMIT 1`,
      [sucursal_id],
    )

    return sesiones.length > 0 ? sesiones[0] : null
  } catch (error) {
    console.error("[v0] Error verificando caja abierta:", error)
    throw error
  }
}

// Obtener la caja activa de una sucursal
const obtenerCajaActiva = async (sucursal_id) => {
  try {
    const caja = await verificarCajaAbierta(sucursal_id)
    return caja
  } catch (error) {
    console.error("[v0] Error obteniendo caja activa:", error)
    throw error
  }
}

// Validar que exista caja abierta, si no retorna error formateado
const validarCajaAbiertaOThrow = async (sucursal_id, operationType = "VENTA") => {
  const caja = await verificarCajaAbierta(sucursal_id)

  if (!caja) {
    const messages = {
      VENTA: "No hay una caja abierta en esta sucursal. Debe abrir la caja antes de realizar ventas.",
      SERVICIO: "No hay una caja abierta en esta sucursal. Debe abrir la caja antes de realizar servicios.",
      PAGO: "No hay una caja abierta. Debe abrir la caja antes de registrar pagos de cuenta corriente.",
    }

    const error = new Error(messages[operationType] || messages.VENTA)
    error.statusCode = 400
    error.code = "CASH_BOX_CLOSED"
    throw error
  }

  return caja
}

module.exports = {
  verificarCajaAbierta,
  obtenerCajaActiva,
  validarCajaAbiertaOThrow,
}
