const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const crypto = require("crypto")
const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")

const generateToken = async (user, req) => {
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.rol,
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" },
  )

  // Crear hash del token para almacenar en sesiones
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 horas

  // Guardar sesión en base de datos
  try {
    await db.query(
      `INSERT INTO sesiones (usuario_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)`,
      [user.id, tokenHash, req.ip || req.connection.remoteAddress, req.get("User-Agent") || "Unknown", expiresAt],
    )
  } catch (error) {
    console.error("Error saving session:", error)
  }

  return token
}

const login = ResponseHelper.asyncHandler(async (req, res) => {
  const { email, password } = req.body

  // Validar campos requeridos
  if (!email || !password) {
    return ResponseHelper.validationError(res, [
      { field: "email", message: "Email es requerido" },
      { field: "password", message: "Contraseña es requerida" },
    ])
  }

  const userExists = await db.query(
    `
    SELECT 
      u.id, 
      u.nombre, 
      u.email, 
      u.password,
      u.rol, 
      u.activo, 
      u.creado_en, 
      u.ultimo_login,
      GROUP_CONCAT(
        DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
        ORDER BY us.es_principal DESC, s.nombre
        SEPARATOR '|'
      ) as sucursales_info
    FROM usuarios u
    LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
    LEFT JOIN sucursales s ON us.sucursal_id = s.id AND s.activo = 1
    WHERE u.email = ?
    GROUP BY u.id
  `,
    [email],
  )

  if (userExists.length === 0) {
    return ResponseHelper.unauthorized(res, "El usuario no existe o no está registrado", "USER_NOT_FOUND")
  }

  const user = userExists[0]

  if (!user.activo) {
    return ResponseHelper.unauthorized(res, "La cuenta está desactivada. Contacte al administrador", "USER_INACTIVE")
  }

  const isValidPassword = await bcrypt.compare(password, user.password)
  if (!isValidPassword) {
    return ResponseHelper.unauthorized(res, "Contraseña incorrecta. Verifique e intente nuevamente", "INVALID_PASSWORD")
  }

  // Generar token con sesión
  const token = await generateToken(user, req)

  // Actualizar último login
  await db.query("UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?", [user.id])

  const sucursales = []
  if (user.sucursales_info) {
    const sucursalesArray = user.sucursales_info.split("|")
    sucursalesArray.forEach((info) => {
      const [id, nombre, esPrincipal] = info.split(":")
      sucursales.push({
        id: Number.parseInt(id),
        nombre: nombre,
        es_principal: esPrincipal === "1",
      })
    })
  }

  const { password: _, rol, sucursales_info, ...userWithoutPassword } = user
  const userResponse = {
    ...userWithoutPassword,
    role: rol,
    sucursales,
  }

  return ResponseHelper.loginSuccess(res, userResponse, token)
})

const getCurrentUser = ResponseHelper.asyncHandler(async (req, res) => {
  const userId = req.user.id

  const users = await db.query(
    `
    SELECT 
      u.id, 
      u.nombre, 
      u.email, 
      u.rol as role, 
      u.activo, 
      u.creado_en, 
      u.ultimo_login,
      GROUP_CONCAT(
        DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
        ORDER BY us.es_principal DESC, s.nombre
        SEPARATOR '|'
      ) as sucursales_info
    FROM usuarios u
    LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
    LEFT JOIN sucursales s ON us.sucursal_id = s.id AND s.activo = 1
    WHERE u.id = ?
    GROUP BY u.id
  `,
    [userId],
  )

  if (users.length === 0) {
    return ResponseHelper.notFound(res, "Usuario no encontrado", "USER_NOT_FOUND")
  }

  const user = users[0]
  const sucursales = []
  if (user.sucursales_info) {
    const sucursalesArray = user.sucursales_info.split("|")
    sucursalesArray.forEach((info) => {
      const [id, nombre, esPrincipal] = info.split(":")
      sucursales.push({
        id: Number.parseInt(id),
        nombre: nombre,
        es_principal: esPrincipal === "1",
      })
    })
  }

  let permisos = []
  if (user.role === "empleado") {
    try {
      const permisosQuery = `
        SELECT p.id, p.nombre, p.slug, p.modulo
        FROM usuario_permisos up
        JOIN permisos p ON up.permiso_id = p.id
        WHERE up.usuario_id = ?
      `
      const permisosData = await db.query(permisosQuery, [userId])
      console.log("[v0 Backend] Permisos cargados para usuario", userId, ":", permisosData)
      permisos = permisosData.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        slug: p.slug,
        modulo: p.modulo,
      }))
    } catch (error) {
      console.error("[v0 Backend] Error loading user permissions:", error)
      permisos = []
    }
  }

  const userResponse = {
    ...user,
    sucursales,
    sucursales_info: undefined,
    permisos,
  }

  console.log("[v0 Backend] getCurrentUser retornando:", {
    userId,
    role: userResponse.role,
    permisosCount: userResponse.permisos.length,
    permisos: userResponse.permisos,
  })

  return ResponseHelper.success(res, userResponse, "Usuario obtenido exitosamente")
})

const register = ResponseHelper.asyncHandler(async (req, res) => {
  const { nombre, email, password, rol } = req.body

  // Validar campos requeridos
  const validationErrors = []
  if (!nombre) validationErrors.push({ field: "nombre", message: "Nombre es requerido" })
  if (!email) validationErrors.push({ field: "email", message: "Email es requerido" })
  if (!password) validationErrors.push({ field: "password", message: "Contraseña es requerida" })
  if (!rol) validationErrors.push({ field: "rol", message: "Rol es requerido" })

  if (validationErrors.length > 0) {
    return ResponseHelper.validationError(res, validationErrors)
  }

  // Verificar si el email ya existe
  const existingUsers = await db.query("SELECT id FROM usuarios WHERE email = ?", [email])

  if (existingUsers.length > 0) {
    return ResponseHelper.conflict(res, "El email ya está registrado", "EMAIL_ALREADY_EXISTS")
  }

  // Encriptar contraseña
  const saltRounds = 12
  const hashedPassword = await bcrypt.hash(password, saltRounds)

  // Crear usuario
  const result = await db.query(
    `INSERT INTO usuarios (nombre, email, password, rol, activo, creado_en) VALUES (?, ?, ?, ?, 1, NOW())`,
    [nombre, email, hashedPassword, rol],
  )

  const newUser = {
    id: result.insertId,
    nombre,
    email,
    role: rol,
  }

  return ResponseHelper.created(res, newUser, "Usuario creado exitosamente")
})

const changePassword = ResponseHelper.asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const userId = req.user.id

  // Validar campos requeridos
  const validationErrors = []
  if (!currentPassword) validationErrors.push({ field: "currentPassword", message: "Contraseña actual es requerida" })
  if (!newPassword) validationErrors.push({ field: "newPassword", message: "Nueva contraseña es requerida" })
  if (newPassword && newPassword.length < 6)
    validationErrors.push({ field: "newPassword", message: "La nueva contraseña debe tener al menos 6 caracteres" })

  if (validationErrors.length > 0) {
    return ResponseHelper.validationError(res, validationErrors)
  }

  // Obtener usuario actual
  const users = await db.query("SELECT password FROM usuarios WHERE id = ?", [userId])

  if (users.length === 0) {
    return ResponseHelper.notFound(res, "Usuario no encontrado", "USER_NOT_FOUND")
  }

  // Verificar contraseña actual
  const isValidPassword = await bcrypt.compare(currentPassword, users[0].password)
  if (!isValidPassword) {
    return ResponseHelper.validationError(res, [{ field: "currentPassword", message: "Contraseña actual incorrecta" }])
  }

  // Encriptar nueva contraseña
  const saltRounds = 12
  const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds)

  // Actualizar contraseña
  await db.query("UPDATE usuarios SET password = ?, actualizado_en = NOW() WHERE id = ?", [hashedNewPassword, userId])

  return ResponseHelper.success(res, null, "Contraseña actualizada exitosamente")
})

const getProfile = ResponseHelper.asyncHandler(async (req, res) => {
  const userId = req.user.id

  const users = await db.query(
    `
    SELECT 
      u.id, 
      u.nombre, 
      u.email, 
      u.rol as role, 
      u.activo, 
      u.creado_en, 
      u.ultimo_login,
      GROUP_CONCAT(
        DISTINCT CONCAT(us.sucursal_id, ':', s.nombre, ':', IF(us.es_principal, '1', '0'))
        ORDER BY us.es_principal DESC, s.nombre
        SEPARATOR '|'
      ) as sucursales_info
    FROM usuarios u
    LEFT JOIN usuario_sucursales us ON u.id = us.usuario_id
    LEFT JOIN sucursales s ON us.sucursal_id = s.id AND s.activo = 1
    WHERE u.id = ?
    GROUP BY u.id
  `,
    [userId],
  )

  if (users.length === 0) {
    return ResponseHelper.notFound(res, "Usuario no encontrado", "USER_NOT_FOUND")
  }

  const user = users[0]
  const sucursales = []
  if (user.sucursales_info) {
    const sucursalesArray = user.sucursales_info.split("|")
    sucursalesArray.forEach((info) => {
      const [id, nombre, esPrincipal] = info.split(":")
      sucursales.push({
        id: Number.parseInt(id),
        nombre: nombre,
        es_principal: esPrincipal === "1",
      })
    })
  }

  let permisos = []
  if (user.role === "empleado") {
    try {
      const permisosQuery = `
        SELECT p.id, p.nombre, p.slug, p.modulo
        FROM usuario_permisos up
        JOIN permisos p ON up.permiso_id = p.id
        WHERE up.usuario_id = ?
      `
      const permisosData = await db.query(permisosQuery, [userId])
      console.log("[v0 Backend] Permisos cargados para usuario", userId, ":", permisosData)
      permisos = permisosData.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        slug: p.slug,
        modulo: p.modulo,
      }))
    } catch (error) {
      console.error("[v0 Backend] Error loading user permissions:", error)
      permisos = []
    }
  }

  const userResponse = {
    ...user,
    sucursales,
    sucursales_info: undefined,
    permisos,
  }

  console.log("[v0 Backend] getProfile retornando:", {
    userId,
    role: userResponse.role,
    permisosCount: userResponse.permisos.length,
    permisos: userResponse.permisos,
  })

  return ResponseHelper.success(res, userResponse, "Perfil obtenido exitosamente")
})

const logout = ResponseHelper.asyncHandler(async (req, res) => {
  const authHeader = req.header("Authorization")
  const token = authHeader?.replace("Bearer ", "")

  if (token) {
    // Invalidar sesión
    const { invalidateSession } = require("../middleware/auth")
    await invalidateSession(token)
  }

  return ResponseHelper.logoutSuccess(res)
})

module.exports = {
  login,
  register,
  changePassword,
  getProfile,
  getCurrentUser,
  logout,
}
