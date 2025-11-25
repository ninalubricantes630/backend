const express = require("express")
const router = express.Router()
const authController = require("../controllers/authController")
const { verifyToken } = require("../middleware/auth")
const { validateLogin } = require("../middleware/validation")

// Rutas públicas
router.post("/login", validateLogin, authController.login)

// Rutas protegidas
router.use(verifyToken)
router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logout exitoso" })
})
router.post("/change-password", authController.changePassword)
router.get("/me", authController.getCurrentUser)
router.get("/profile", authController.getProfile)

module.exports = router
