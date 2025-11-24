// Nuevo helper para importación robusta de productos
const logger = require("../config/logger")

const importHelper = {
  // Parsear CSV - Articulos sin encabezado en formato específico
  parseCSV: (text) => {
    try {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length === 0) {
        throw new Error("Archivo vacío")
      }

      const productos = []
      console.log("[v0] Total de líneas en CSV:", lines.length)

      // El CSV NO tiene encabezado - comienza directamente con datos
      // Estructura: codigo ; ? ; ? ; id ; nombre ; ? ; stock ; ? ; ? ; ? ; precio ; ? ; ? ; ? ; ? ; ? ; ? ; categoria ; fabricante ; ...
      // Índices: 0=codigo, 3=id, 4=nombre, 6=stock, 10=precio, 16=categoria, 17=fabricante
      // IMPORTANTE: Los códigos pueden estar en notación científica (ej: 7,25E+11)

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue

        try {
          const columns = line.split(";").map((col) => col.trim())

          // Requerir al menos 18 columnas (hasta la categoría)
          if (columns.length < 17) {
            console.log(`[v0] Línea ${i + 1} con menos de 17 columnas, saltando`)
            continue
          }

          const nombre = columns[4] || "" // índice 4 - nombre
          const stockRaw = columns[6] || "0" // índice 6 - stock
          const precioRaw = columns[10] || "0" // índice 10 - precio
          const categoria = (columns[16] || "").trim() // índice 16 - categoría
          const fabricante = (columns[17] || "").trim() // índice 17 - fabricante

          // Validar nombre (campo crítico)
          if (!nombre || nombre.trim() === "") {
            console.log(`[v0] Línea ${i + 1} sin nombre, saltando`)
            continue
          }

          // Parsear valores numéricos (manejar comas como decimales)
          const stock = Number.parseFloat(stockRaw.replace(",", ".")) || 0
          const precio = Number.parseFloat(precioRaw.replace(",", ".")) || 0

          // Normalizar categoría
          let categoriaNormalizada = categoria.trim().toUpperCase()
          if (!categoria || categoria === "" || categoriaNormalizada === "GENERAL") {
            categoriaNormalizada = "" // Dejar vacía para asignar después
          }

          productos.push({
            nombre: nombre.trim(),
            stock: Math.max(0, stock), // No permitir negativos
            precio: Math.max(0, precio), // No permitir negativos
            categoria_nombre: categoriaNormalizada,
            fabricante: fabricante || null,
            lineNumber: i + 1,
          })
        } catch (err) {
          console.log(`[v0] Error parseando línea ${i + 1}: ${err.message}`)
          logger.warn(`Error parseando línea ${i + 1}: ${err.message}`)
          continue
        }
      }

      console.log(`[v0] Total de productos parseados: ${productos.length}`)
      return productos
    } catch (err) {
      logger.error("Error en parseCSV:", err)
      throw err
    }
  },

  // Procesar categorías en batch
  async procesarCategorias(connection, productos) {
    const categoriasUnicas = new Set()
    const categoriasCache = new Map()

    // Recolectar categorías únicas
    productos.forEach((p) => {
      if (p.categoria_nombre && p.categoria_nombre !== "") {
        categoriasUnicas.add(p.categoria_nombre)
      }
    })

    console.log(`[v0] Categorías únicas encontradas: ${categoriasUnicas.size}`)

    // Cargar todas las categorías existentes
    try {
      const [categoriasExistentes] = await connection.execute(
        "SELECT id, nombre, UPPER(nombre) as nombre_upper FROM categorias WHERE activo = true",
      )

      categoriasExistentes.forEach((cat) => {
        categoriasCache.set(cat.nombre_upper, cat.id)
      })

      console.log(`[v0] Categorías existentes en DB: ${categoriasExistentes.length}`)
    } catch (err) {
      logger.error("Error cargando categorías existentes:", err)
      throw err
    }

    // Crear categorías faltantes
    for (const categoriaNombre of categoriasUnicas) {
      if (!categoriasCache.has(categoriaNombre)) {
        try {
          const [result] = await connection.execute(
            "INSERT INTO categorias (nombre, descripcion, activo) VALUES (?, ?, true)",
            [categoriaNombre, `Importada desde Excel - ${new Date().toISOString().split("T")[0]}`],
          )
          categoriasCache.set(categoriaNombre, result.insertId)
          console.log(`[v0] Categoría creada: ${categoriaNombre} con ID ${result.insertId}`)
        } catch (err) {
          if (err.code === "ER_DUP_ENTRY") {
            try {
              const [cat] = await connection.execute(
                "SELECT id FROM categorias WHERE UPPER(nombre) = ? AND activo = true",
                [categoriaNombre],
              )
              if (cat.length > 0) {
                categoriasCache.set(categoriaNombre, cat[0].id)
              }
            } catch (searchErr) {
              logger.warn(`No se pudo encontrar categoría ${categoriaNombre}:`, searchErr)
            }
          } else {
            logger.warn(`Error creando categoría ${categoriaNombre}:`, err)
          }
        }
      }
    }

    // Asegurar que existe categoría GENERAL
    if (!categoriasCache.has("GENERAL")) {
      try {
        const [result] = await connection.execute(
          "INSERT INTO categorias (nombre, descripcion, activo) VALUES ('GENERAL', 'Categoría general', true)",
        )
        categoriasCache.set("GENERAL", result.insertId)
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
          try {
            const [cat] = await connection.execute(
              "SELECT id FROM categorias WHERE UPPER(nombre) = 'GENERAL' AND activo = true",
            )
            if (cat.length > 0) {
              categoriasCache.set("GENERAL", cat[0].id)
            }
          } catch (searchErr) {
            logger.warn("Error buscando GENERAL:", searchErr)
          }
        }
      }
    }

    return categoriasCache
  },

  // Procesar productos en lotes
  async procesarProductosPorLotes(connection, productos, sucursal_id, categoriasCache, userId) {
    const LOTE_SIZE = 100
    let productosCreados = 0
    let productosActualizados = 0
    let productosConError = 0
    const errores = []

    console.log(`[v0] Iniciando procesamiento de ${productos.length} productos en lotes de ${LOTE_SIZE}`)

    for (let loteIndex = 0; loteIndex < productos.length; loteIndex += LOTE_SIZE) {
      const lote = productos.slice(loteIndex, Math.min(loteIndex + LOTE_SIZE, productos.length))
      console.log(`[v0] Procesando lote ${Math.floor(loteIndex / LOTE_SIZE) + 1} (${lote.length} productos)`)

      for (const producto of lote) {
        try {
          const { nombre, stock = 0, precio = 0, categoria_nombre, fabricante, lineNumber } = producto

          // Validar nombre
          if (!nombre || nombre.trim() === "") {
            productosConError++
            errores.push(`Línea ${lineNumber}: Nombre vacío`)
            continue
          }

          // Determinar categoria_id
          let categoria_id = categoriasCache.get("GENERAL")
          if (categoria_nombre && categoria_nombre !== "") {
            const catId = categoriasCache.get(categoria_nombre)
            if (catId) {
              categoria_id = catId
            }
          }

          const stockFinal = Math.max(0, Number(stock) || 0)
          const precioFinal = Math.max(0, Number(precio) || 0)

          let productoExistente = null

          // El nombre es el identificador único para determinar si actualizar o crear
          const [resultadoNombre] = await connection.execute(
            "SELECT id, stock FROM productos WHERE nombre = ? AND sucursal_id = ? AND activo = true LIMIT 1",
            [nombre.trim(), sucursal_id],
          )
          if (resultadoNombre.length > 0) {
            productoExistente = resultadoNombre[0]
          }

          if (productoExistente) {
            // Actualizar si ya existe por nombre
            const productoId = productoExistente.id
            const stockAnterior = Number(productoExistente.stock) || 0

            await connection.execute(
              `UPDATE productos SET 
                nombre = ?, 
                categoria_id = ?, 
                fabricante = ?,
                precio = ?, 
                stock = ?,
                updated_at = NOW()
              WHERE id = ?`,
              [nombre.trim(), categoria_id, fabricante?.trim() || null, precioFinal, stockFinal, productoId],
            )

            // Registrar movimiento si cambió stock
            if (stockFinal !== stockAnterior) {
              await connection.execute(
                `INSERT INTO movimientos_stock (
                  producto_id, tipo, unidad_medida, cantidad, 
                  stock_anterior, stock_nuevo, motivo, usuario_id
                ) VALUES (?, 'AJUSTE', 'unidad', ?, ?, ?, 'Actualización desde importación Excel', ?)`,
                [productoId, Math.abs(stockFinal - stockAnterior), stockAnterior, stockFinal, userId || null],
              )
            }

            productosActualizados++
          } else {
            // Crear nuevo producto - solo si el nombre no existe
            const [result] = await connection.execute(
              `INSERT INTO productos (
                nombre, categoria_id, fabricante, precio, 
                unidad_medida, stock, stock_minimo, sucursal_id, activo
              ) VALUES (?, ?, ?, ?, 'unidad', ?, 0, ?, true)`,
              [nombre.trim(), categoria_id, fabricante?.trim() || null, precioFinal, stockFinal, sucursal_id],
            )

            // Registrar movimiento inicial
            if (stockFinal > 0) {
              await connection.execute(
                `INSERT INTO movimientos_stock (
                  producto_id, tipo, unidad_medida, cantidad, 
                  stock_anterior, stock_nuevo, motivo, usuario_id
                ) VALUES (?, 'ENTRADA', 'unidad', ?, 0, ?, 'Stock inicial desde importación Excel', ?)`,
                [result.insertId, stockFinal, stockFinal, userId || null],
              )
            }

            productosCreados++
          }
        } catch (error) {
          productosConError++
          const mensaje = `Línea ${producto.lineNumber} "${producto.nombre}": ${error.message}`
          errores.push(mensaje)
          logger.error(mensaje, error)
        }
      }
    }

    console.log(
      `[v0] Importación finalizada: ${productosCreados} creados, ${productosActualizados} actualizados, ${productosConError} errores`,
    )
    return {
      productosCreados,
      productosActualizados,
      productosConError,
      errores,
    }
  },
}

module.exports = importHelper
