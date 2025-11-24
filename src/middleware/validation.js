const { body, param, query, validationResult } = require("express-validator")
const ResponseHelper = require("../utils/responseHelper")

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log("[v0] Validation errors found:")
    console.log("[v0] Request body:", JSON.stringify(req.body, null, 2))
    console.log("[v0] Errors:", JSON.stringify(errors.array(), null, 2))

    const formattedErrors = errors.array().map((error) => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value,
    }))

    console.log("[v0] Formatted errors:", JSON.stringify(formattedErrors, null, 2))

    return ResponseHelper.validationError(res, formattedErrors)
  }
  next()
}

const validateLogin = [
  body("email")
    .isEmail()
    .withMessage("Email inválido")
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage("Email demasiado largo"),
  body("password").isLength({ min: 1 }).withMessage("La contraseña es requerida"),
  handleValidationErrors,
]

const validateRegister = [
  body("email")
    .isEmail()
    .withMessage("Email inválido")
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage("Email demasiado largo"),
  body("password").isLength({ min: 6, max: 50 }).withMessage("La contraseña debe tener entre 6 y 50 caracteres"),
  body("rol").isIn(["ADMIN", "EMPLEADO"]).withMessage("El rol debe ser ADMIN o EMPLEADO"),
  handleValidationErrors,
]

const validateChangePassword = [
  body("currentPassword").isLength({ min: 1 }).withMessage("Contraseña actual es requerida"),
  body("newPassword")
    .isLength({ min: 6, max: 50 })
    .withMessage("La nueva contraseña debe tener entre 6 y 50 caracteres"),
  handleValidationErrors,
]

const validateCliente = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres"),
  body("apellido")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El apellido debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El apellido solo puede contener letras y espacios"),
  body("dni")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 7, max: 8 })
    .withMessage("El DNI debe tener entre 7 y 8 dígitos")
    .matches(/^[0-9]+$/)
    .withMessage("El DNI solo puede contener números"),
  body("telefono")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 })
    .withMessage("El teléfono no puede tener más de 20 caracteres"),
  body("direccion")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 })
    .withMessage("La dirección no puede tener más de 255 caracteres"),
  body("tiene_cuenta_corriente")
    .optional()
    .isBoolean()
    .withMessage("El campo tiene_cuenta_corriente debe ser verdadero o falso"),
  body("limite_credito")
    .optional()
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("El límite de crédito debe ser un número positivo menor a $999,999.99"),
  handleValidationErrors,
]

const validateVehiculo = [
  body("patente")
    .trim()
    .toUpperCase()
    .isLength({ min: 3, max: 10 })
    .withMessage("La patente debe tener entre 3 y 10 caracteres")
    .matches(/^[A-Z0-9]+$/)
    .withMessage("La patente solo puede contener letras y números"),
  body("marca").trim().isLength({ min: 2, max: 50 }).withMessage("La marca debe tener entre 2 y 50 caracteres"),
  body("modelo")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("El modelo debe tener entre 2 y 50 caracteres")
    .matches(/^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\-.]+$/)
    .withMessage("El modelo contiene caracteres inválidos"),
  body("año")
    .isInt({ min: 1900, max: new Date().getFullYear() + 1 })
    .withMessage(`El año debe estar entre 1900 y ${new Date().getFullYear() + 1}`),
  body("clienteId").isInt({ min: 1 }).withMessage("ID de cliente inválido"),
  body("kilometraje")
    .isInt({ min: 0, max: 9999999 })
    .withMessage("El kilometraje debe ser un número entero entre 0 y 9,999,999"),
  body("observaciones")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Las observaciones no pueden tener más de 1000 caracteres"),
  handleValidationErrors,
]

const validateUser = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres"),
  body("email")
    .isEmail()
    .withMessage("Email inválido")
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage("Email demasiado largo"),
  body("password")
    .optional()
    .isLength({ min: 6, max: 50 })
    .withMessage("La contraseña debe tener entre 6 y 50 caracteres"),
  body("rol").isIn(["ADMIN", "EMPLEADO"]).withMessage("El rol debe ser ADMIN o EMPLEADO"),
  handleValidationErrors,
]

const validateId = [
  param("id").isInt({ min: 1 }).withMessage("ID debe ser un número entero positivo"),
  handleValidationErrors,
]

const validateProductoId = [
  param("productoId").isInt({ min: 1 }).withMessage("ID de producto debe ser un número entero positivo"),
  handleValidationErrors,
]

const validateClienteId = [
  param("clienteId")
    .isInt({ min: 1 })
    .withMessage("ID de cliente debe ser un número entero positivo")
    .toInt(), // Convertir a entero automáticamente
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().map((error) => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value,
      }))
      return res.status(400).json({
        error: "Datos de entrada inválidos",
        details: formattedErrors,
      })
    }
    next()
  },
]

const validateServicio = [
  body("cliente_id").isInt({ min: 1 }).withMessage("ID de cliente inválido"),
  body("vehiculo_id").isInt({ min: 1 }).withMessage("ID de vehículo inválido"),
  body("sucursal_id").isInt({ min: 1 }).withMessage("ID de sucursal inválido"),
  body("empleados")
    .optional()
    .isArray()
    .withMessage("Los empleados deben ser un array")
    .custom((empleados) => {
      if (empleados && empleados.length > 0) {
        for (const empleadoId of empleados) {
          if (!Number.isInteger(empleadoId) || empleadoId < 1) {
            throw new Error("Todos los IDs de empleados deben ser números enteros positivos")
          }
        }
      }
      return true
    }),
  body("observaciones")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Las observaciones no pueden tener más de 1000 caracteres"),
  body("precio_referencia")
    .optional()
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("El precio de referencia debe ser un número positivo menor a $999,999.99"),
  body("items").isArray({ min: 1 }).withMessage("Debe incluir al menos un item"),
  body("items.*.tipo_servicio_id").isInt({ min: 1 }).withMessage("ID de tipo de servicio inválido"),
  body("items.*.observaciones")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Las observaciones del item no pueden tener más de 500 caracteres"),
  body("items.*.notas")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Las notas del item no pueden tener más de 500 caracteres"),
  handleValidationErrors,
]

const validateConfiguracion = [
  body("categoria")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("La categoría debe tener entre 2 y 50 caracteres")
    .matches(/^[a-zA-Z_]+$/)
    .withMessage("La categoría solo puede contener letras y guiones bajos"),
  body("clave")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("La clave debe tener entre 2 y 50 caracteres")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("La clave solo puede contener letras, números y guiones bajos"),
  body("valor").trim().isLength({ min: 1, max: 1000 }).withMessage("El valor debe tener entre 1 y 1000 caracteres"),
  body("tipo")
    .isIn(["string", "number", "boolean", "json"])
    .withMessage("Tipo debe ser string, number, boolean o json"),
  body("descripcion")
    .optional()
    .isLength({ max: 200 })
    .withMessage("La descripción no puede tener más de 200 caracteres"),
  handleValidationErrors,
]

const validateConfiguracionUpdate = [
  body("configuraciones").isArray({ min: 1 }).withMessage("Debe proporcionar al menos una configuración"),
  body("configuraciones.*.categoria")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("La categoría debe tener entre 2 y 50 caracteres"),
  body("configuraciones.*.clave")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("La clave debe tener entre 2 y 50 caracteres"),
  body("configuraciones.*.valor")
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("El valor debe tener entre 1 y 1000 caracteres"),
  body("configuraciones.*.tipo")
    .isIn(["string", "number", "boolean", "json"])
    .withMessage("Tipo debe ser string, number, boolean o json"),
  handleValidationErrors,
]

const validatePagination = [
  query("page").optional().isInt({ min: 1, max: 10000 }).withMessage("Página debe ser un número entre 1 y 10,000"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Límite debe ser un número entre 1 y 100"),
  query("search").optional().isLength({ max: 100 }).withMessage("Búsqueda no puede tener más de 100 caracteres"),
  handleValidationErrors,
]

const validateDateRange = [
  query("fecha_desde").optional().isISO8601().withMessage("Fecha desde debe ser una fecha válida (YYYY-MM-DD)"),
  query("fecha_hasta").optional().isISO8601().withMessage("Fecha hasta debe ser una fecha válida (YYYY-MM-DD)"),
  handleValidationErrors,
]

const validateExists = (table, field = "id") => {
  return async (req, res, next) => {
    try {
      const db = require("../config/database")
      const value = req.body[field] || req.params[field]

      if (!value) {
        return next()
      }

      const query = `SELECT id FROM ${table} WHERE ${field} = ? AND activo = 1`
      const results = await db.query(query, [value])

      if (results.length === 0) {
        return ResponseHelper.notFound(res, `${table} no encontrado`, "RESOURCE_NOT_FOUND")
      }

      next()
    } catch (error) {
      console.error(`Error validating ${table} existence:`, error)
      return ResponseHelper.error(res, "Error de validación", 500, "VALIDATION_ERROR", error)
    }
  }
}

const validateTipoServicio = [
  (req, res, next) => {
    next()
  },
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s\-.]+$/)
    .withMessage("El nombre contiene caracteres inválidos"),
  body("descripcion")
    .optional()
    .isLength({ max: 500 })
    .withMessage("La descripción no puede tener más de 500 caracteres"),
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().map((error) => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value,
      }))
      return ResponseHelper.validationError(res, formattedErrors)
    }
    next()
  },
]

const validateEmpleado = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres"),
  body("apellido")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El apellido debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El apellido solo puede contener letras y espacios"),
  body("cargo").optional().isLength({ max: 100 }).withMessage("El cargo no puede tener más de 100 caracteres"),
  body("sucursal_id").isInt({ min: 1 }).withMessage("ID de sucursal inválido"),
  handleValidationErrors,
]

const validateEmpleadoUpdate = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres"),
  body("apellido")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El apellido debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .withMessage("El apellido solo puede contener letras y espacios"),
  body("cargo").optional().isLength({ max: 100 }).withMessage("El cargo no puede tener más de 100 caracteres"),
  body("sucursal_id").isInt({ min: 1 }).withMessage("ID de sucursal inválido"),
  body("activo").isBoolean().withMessage("El estado activo debe ser verdadero o falso"),
  handleValidationErrors,
]

const validateSucursal = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s\-.]+$/)
    .withMessage("El nombre contiene caracteres inválidos"),
  body("ubicacion").optional().isLength({ max: 255 }).withMessage("La ubicación no puede tener más de 255 caracteres"),
  handleValidationErrors,
]

const validateSucursalUpdate = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s\-.]+$/)
    .withMessage("El nombre contiene caracteres inválidos"),
  body("ubicacion").optional().isLength({ max: 255 }).withMessage("La ubicación no puede tener más de 255 caracteres"),
  body("activo").isBoolean().withMessage("El estado activo debe ser verdadero o falso"),
  handleValidationErrors,
]

const validateCategoria = [
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres")
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s\-.]+$/)
    .withMessage("El nombre contiene caracteres inválidos"),
  body("descripcion")
    .optional()
    .isLength({ max: 500 })
    .withMessage("La descripción no puede tener más de 500 caracteres"),
  handleValidationErrors,
]

const validateProducto = [
  body("codigo").optional().trim().isLength({ max: 50 }).withMessage("El código no puede tener más de 50 caracteres"),
  body("nombre").trim().isLength({ min: 2, max: 200 }).withMessage("El nombre debe tener entre 2 y 200 caracteres"),
  body("descripcion")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("La descripción no puede tener más de 1000 caracteres"),
  body("categoria_id").isInt({ min: 1 }).withMessage("ID de categoría inválido"),
  body("precio")
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("El precio debe ser un número positivo menor a $999,999.99"),
  body("sucursal_id").isInt({ min: 1 }).withMessage("ID de sucursal inválido"),
  body("unidad_medida")
    .optional()
    .isIn(["unidad", "litro"])
    .withMessage("La unidad de medida debe ser 'unidad' o 'litro'"),
  body("stock")
    .optional()
    .custom((value, { req }) => {
      const stockNum = Number.parseFloat(value)
      if (isNaN(stockNum) || stockNum < 0) {
        throw new Error("El stock debe ser un número positivo")
      }
      if (req.body.unidad_medida === "unidad" && !Number.isInteger(stockNum)) {
        throw new Error("El stock para productos de unidad debe ser un número entero")
      }
      return true
    }),
  handleValidationErrors,
]

const validateMovimientoStock = [
  body("producto_id").isInt({ min: 1 }).withMessage("ID de producto inválido"),
  body("tipo")
    .isIn(["ENTRADA", "SALIDA", "AJUSTE"])
    .withMessage("Tipo de movimiento inválido (ENTRADA, SALIDA, AJUSTE)"),
  body("cantidad")
    .custom((value) => {
      const cantidadNum = Number.parseFloat(value)
      if (isNaN(cantidadNum) || cantidadNum <= 0) {
        throw new Error("La cantidad debe ser un número mayor a 0")
      }
      return true
    })
    .withMessage("La cantidad debe ser un número válido mayor a 0"),
  body("motivo").optional().trim().isLength({ max: 500 }).withMessage("El motivo no puede tener más de 500 caracteres"),
  handleValidationErrors,
]

const validateVenta = [
  body("cliente_id")
    .optional({ nullable: true, checkFalsy: true })
    .custom((value) => {
      if (value === null || value === undefined || value === 0 || value === "") {
        return true
      }
      const clienteId = Number.parseInt(value)
      if (!Number.isInteger(clienteId) || clienteId < 1) {
        throw new Error("ID de cliente inválido")
      }
      return true
    }),
  body("sucursal_id")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const sucursalId = Number.parseInt(value)
        if (!Number.isInteger(sucursalId) || sucursalId < 1) {
          throw new Error("ID de sucursal inválido")
        }
      }
      return true
    }),
  body("tipo_pago")
    .notEmpty()
    .withMessage("El tipo de pago es requerido")
    .customSanitizer((value) => {
      return typeof value === "string" ? value.toUpperCase() : value
    })
    .isIn(["EFECTIVO", "TARJETA_CREDITO", "TRANSFERENCIA", "CUENTA_CORRIENTE"])
    .withMessage("Tipo de pago inválido (EFECTIVO, TARJETA_CREDITO, TRANSFERENCIA, CUENTA_CORRIENTE)"),
  body("items").isArray({ min: 1 }).withMessage("Debe incluir al menos un producto"),
  body("items.*.producto_id").isInt({ min: 1 }).withMessage("ID de producto inválido"),
  body("items.*.cantidad").custom((value) => {
    const cantidad = Number.parseFloat(value)
    if (isNaN(cantidad) || cantidad <= 0) {
      throw new Error("La cantidad debe ser mayor a 0")
    }
    return true
  }),
  body("items.*.precio_unitario").custom((value) => {
    const precio = Number.parseFloat(value)
    if (isNaN(precio) || precio < 0) {
      throw new Error("El precio unitario debe ser un número positivo")
    }
    return true
  }),
  body("descuento")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const descuento = Number.parseFloat(value)
        if (isNaN(descuento) || descuento < 0) {
          throw new Error("El descuento debe ser un número positivo")
        }
      }
      return true
    }),
  body("interes_sistema")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const interes = Number.parseFloat(value)
        if (isNaN(interes) || interes < 0) {
          throw new Error("El interés del sistema debe ser un número positivo")
        }
      }
      return true
    }),
  body("total_con_interes")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const total = Number.parseFloat(value)
        if (isNaN(total) || total < 0) {
          throw new Error("El total con interés debe ser un número positivo")
        }
      }
      return true
    }),
  body("tarjeta_id")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const tarjetaId = Number.parseInt(value)
        if (!Number.isInteger(tarjetaId) || tarjetaId < 1) {
          throw new Error("ID de tarjeta inválido")
        }
      }
      return true
    }),
  body("numero_cuotas")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const cuotas = Number.parseInt(value)
        if (!Number.isInteger(cuotas) || cuotas < 1) {
          throw new Error("Número de cuotas inválido")
        }
      }
      return true
    }),
  body("tipo_interes_sistema")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(["porcentaje", "monto", null, ""])
    .withMessage("Tipo de interés del sistema debe ser 'porcentaje', 'monto' o nulo"),
  body("valor_interes_sistema")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const valor = Number.parseFloat(value)
        if (isNaN(valor) || valor < 0) {
          throw new Error("El valor de interés del sistema debe ser un número positivo")
        }
      }
      return true
    }),
  body("total_con_interes_tarjeta")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const total = Number.parseFloat(value)
        if (isNaN(total) || total < 0) {
          throw new Error("El total con interés de tarjeta debe ser un número positivo")
        }
      }
      return true
    }),
  body("interes_tarjeta")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const interes = Number.parseFloat(value)
        if (isNaN(interes) || interes < 0) {
          throw new Error("El interés de tarjeta debe ser un número positivo")
        }
      }
      return true
    }),
  body("tasa_interes_tarjeta")
    .optional({ nullable: true })
    .custom((value) => {
      if (value !== null && value !== undefined) {
        const tasa = Number.parseFloat(value)
        if (isNaN(tasa) || tasa < 0 || tasa > 100) {
          throw new Error("La tasa de interés de tarjeta debe ser un número entre 0 y 100")
        }
      }
      return true
    }),
  body("observaciones")
    .optional({ nullable: true })
    .customSanitizer((value) => {
      return value === null || value === undefined || value === "" ? null : value
    })
    .isLength({ max: 1000 })
    .withMessage("Las observaciones no pueden tener más de 1000 caracteres"),
  handleValidationErrors,
]

module.exports = {
  handleValidationErrors,
  validateLogin,
  validateRegister,
  validateChangePassword,
  validateCliente,
  validateVehiculo,
  validateUser,
  validateId,
  validateProductoId,
  validateClienteId,
  validateServicio,
  validateConfiguracion,
  validateConfiguracionUpdate,
  validatePagination,
  validateDateRange,
  validateExists,
  validateTipoServicio,
  validateEmpleado,
  validateEmpleadoUpdate,
  validateSucursal,
  validateSucursalUpdate,
  validateCategoria,
  validateVenta,
  validateProducto,
  validateMovimientoStock,
}
