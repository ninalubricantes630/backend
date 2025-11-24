const express = require("express")
const router = express.Router()
const tarjetasController = require("../controllers/tarjetasController")
const { authenticateToken, requireAdmin } = require("../middleware/auth")
const { validateId } = require("../middleware/validation")

// Rutas públicas (solo autenticadas)
router.get("/venta/todas", authenticateToken, tarjetasController.obtenerTarjetasParaVenta)
router.get("/venta/:tarjeta_id/cuotas", authenticateToken, tarjetasController.obtenerCuotasPorTarjeta)

// Rutas de administración (solo admin)
router.use(authenticateToken, requireAdmin)

router.get("/", tarjetasController.obtenerTarjetasPaginadas)
router.get("/:id", validateId, tarjetasController.obtenerTarjetaPorId)
router.post("/", tarjetasController.crearTarjeta)
router.put("/:id", validateId, tarjetasController.actualizarTarjeta)
router.delete("/:id", validateId, tarjetasController.eliminarTarjeta)

module.exports = router
