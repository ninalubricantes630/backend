const express = require("express")
const router = express.Router()
const movimientosStockController = require("../controllers/movimientosStockController")
const { verifyToken } = require("../middleware/auth")
const { validateProductoId } = require("../middleware/validation") // Importando validateProductoId en lugar de validateId

// Aplicar autenticación a todas las rutas
router.use(verifyToken)

// Rutas de movimientos
router.get("/historial", movimientosStockController.getHistorialMovimientos)
router.get("/producto/:productoId", validateProductoId, movimientosStockController.getMovimientosByProducto) // Usando validateProductoId
router.post("/", movimientosStockController.registrarMovimiento)

module.exports = router
