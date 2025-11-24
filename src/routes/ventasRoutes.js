const express = require("express")
const router = express.Router()
const ventasController = require("../controllers/ventasController")
const { authenticateToken } = require("../middleware/auth")
const { validateId, validateVenta } = require("../middleware/validation") // Agregado validateVenta

// Aplicar autenticación a todas las rutas
router.use(authenticateToken)

// Rutas de ventas
router.post("/", validateVenta, ventasController.crearVenta) // Agregado validateVenta middleware
router.get("/", ventasController.obtenerVentas)
router.get("/estadisticas", ventasController.obtenerEstadisticas)
router.get("/:id", validateId, ventasController.obtenerVentaPorId)
router.patch("/:id/cancelar", validateId, ventasController.cancelarVenta)

module.exports = router
