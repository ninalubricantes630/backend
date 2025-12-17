const express = require("express")
const router = express.Router()
const productosController = require("../controllers/productosController")
const { verifyToken } = require("../middleware/auth")
const { validateId } = require("../middleware/validation")

// Aplicar autenticación a todas las rutas
router.use(verifyToken)

// Rutas CRUD
router.get("/", productosController.getProductos)
router.post("/", productosController.createProducto)
router.get("/:id", validateId, productosController.getProductoById)
router.put("/:id", validateId, productosController.updateProducto)
router.delete("/:id", validateId, productosController.deleteProducto)
router.patch("/:id/toggle-estado", validateId, productosController.toggleEstadoProducto)

router.post("/:id/movimientos", validateId, productosController.registrarMovimiento)

router.get("/exportar/excel", productosController.exportarProductosExcel)
router.post("/importar-excel", productosController.importarProductosExcel)

module.exports = router
