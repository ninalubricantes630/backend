const express = require("express")
const { getPermisos, getPermisosUsuario, actualizarPermisosUsuario } = require("../controllers/permisosController")
const { authenticateToken, requireAdmin } = require("../middleware/auth")

const router = express.Router()

// Obtener todos los permisos (solo admin)
router.get("/", authenticateToken, requireAdmin, getPermisos)

// Obtener permisos de un usuario (solo admin)
router.get("/:usuarioId", authenticateToken, requireAdmin, getPermisosUsuario)

// Actualizar permisos de un usuario (solo admin)
router.put("/:usuarioId", authenticateToken, requireAdmin, actualizarPermisosUsuario)

module.exports = router
