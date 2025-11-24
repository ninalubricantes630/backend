const express = require("express")
const router = express.Router()
const categoriasController = require("../controllers/categoriasController")
const { authenticateToken } = require("../middleware/auth")
const { validateCategoria } = require("../middleware/validation")

// Todas las rutas requieren autenticación
router.use(authenticateToken)

// Rutas de categorías
router.get("/", categoriasController.getCategorias)
router.get("/search", categoriasController.searchCategorias)
router.get("/:id", categoriasController.getCategoriaById)
router.post("/", validateCategoria, categoriasController.createCategoria)
router.put("/:id", validateCategoria, categoriasController.updateCategoria)
router.delete("/:id", categoriasController.deleteCategoria)

module.exports = router
 