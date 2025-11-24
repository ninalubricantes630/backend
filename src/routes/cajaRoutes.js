const express = require("express")
const router = express.Router()
const cajaController = require("../controllers/cajaController")
const { authenticateToken } = require("../middleware/auth")

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Obtener sesión activa de caja para la sucursal del usuario
router.get("/sesion-activa", cajaController.obtenerSesionActiva)

// Abrir caja
router.post("/abrir", cajaController.abrirCaja)

// Cerrar caja
router.patch("/:id/cerrar", cajaController.cerrarCaja)

// Obtener historial de sesiones
router.get("/historial", cajaController.obtenerHistorialSesiones)

// Obtener detalles de una sesión específica
router.get("/sesiones/:id", cajaController.obtenerDetalleSesion)

router.get("/sesiones/:id/detalle-ingresos", cajaController.obtenerDetalleIngresos)

// Obtener movimientos de una sesión
router.get("/sesiones/:id/movimientos", cajaController.obtenerMovimientos)

// Registrar movimiento manual
router.post("/movimientos", cajaController.registrarMovimiento)

module.exports = router
