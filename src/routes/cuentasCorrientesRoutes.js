const express = require("express")
const router = express.Router()
const cuentasCorrientesController = require("../controllers/cuentasCorrientesController")
const { authenticateToken } = require("../middleware/auth")
const { validateClienteId } = require("../middleware/validation")

// Aplicar autenticación a todas las rutas
router.use(authenticateToken)

// Rutas de cuentas corrientes
router.get("/clientes", cuentasCorrientesController.getClientesConCuentaCorriente)
router.get("/cliente/:clienteId", validateClienteId, cuentasCorrientesController.getSaldoCliente)
router.get("/cliente/:clienteId/movimientos", validateClienteId, cuentasCorrientesController.getMovimientos)
router.post("/cliente/:clienteId/pago", validateClienteId, cuentasCorrientesController.registrarPago)
router.post("/movimiento/:movimientoId/cancelar", cuentasCorrientesController.cancelarPago)
router.put("/cliente/:clienteId", validateClienteId, cuentasCorrientesController.createOrUpdateCuentaCorriente)

module.exports = router
