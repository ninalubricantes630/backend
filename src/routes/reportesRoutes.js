const express = require("express")
const router = express.Router()
const { authenticateToken } = require("../middleware/auth")
const reportesController = require("../controllers/reportesController")

router.post("/datos", authenticateToken, reportesController.obtenerDatos)
router.post("/exportar-excel", authenticateToken, reportesController.exportarExcel)

module.exports = router
