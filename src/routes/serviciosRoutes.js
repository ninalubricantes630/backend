const express = require("express")
const router = express.Router()
const serviciosController = require("../controllers/serviciosController")
const { verifyToken } = require("../middleware/auth")
const { validateServicio } = require("../middleware/validation")

// Todas las rutas requieren autenticación
router.use(verifyToken)

// Rutas específicas primero (antes de /:id)
router.get("/", serviciosController.getServicios)
router.get("/estadisticas", serviciosController.getEstadisticas)
router.get("/cliente/:id", serviciosController.getServiciosByCliente)
router.get("/vehiculo/:patente", serviciosController.getServiciosByVehiculo)

// Ruta genérica al final
router.get("/:id", serviciosController.getServicioById)

// Rutas de modificación
router.post("/", validateServicio, serviciosController.createServicio)
router.put("/:id", validateServicio, serviciosController.updateServicio)
router.patch("/:id/cancelar", serviciosController.cancelarServicio)
router.delete("/:id", serviciosController.deleteServicio)

module.exports = router
