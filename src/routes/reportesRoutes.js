const express = require("express")
const router = express.Router()
const { authenticateToken } = require("../middleware/auth")
const reportesController = require("../controllers/reportesController")

router.post("/exportar-excel", authenticateToken, reportesController.exportarExcel)

module.exports = router
