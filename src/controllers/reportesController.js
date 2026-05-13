const XLSX = require("xlsx")
const db = require("../config/database")
const ResponseHelper = require("../utils/responseHelper")
const logger = require("../config/logger")

const TIPOS_REPORTE = ["ventas", "servicios", "ambos"]
const PERIODOS = ["diario", "mensual", "anual", "personalizado"]

const UI_LIMIT_VENTAS = 500
const UI_LIMIT_SERVICIOS = 500
const UI_LIMIT_DETALLE = 1200

const pad2 = (n) => String(n).padStart(2, "0")

const formatDateTime = (d) => {
  if (!d) return ""
  try {
    const x = new Date(d)
    if (Number.isNaN(x.getTime())) return String(d)
    return x.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
  } catch {
    return String(d)
  }
}

/** Expresión SQL alineada con montoVenta() en JS */
const SQL_MONTO_VENTA =
  "CASE WHEN v.total_con_interes_tarjeta IS NOT NULL AND v.total_con_interes_tarjeta != 0 THEN v.total_con_interes_tarjeta ELSE COALESCE(v.total, 0) END"

const resolveDateRange = (body) => {
  const { periodo_tipo, fecha, anio, mes, fecha_desde, fecha_hasta } = body
  let desde
  let hasta
  let label = ""

  if (periodo_tipo === "diario") {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
      throw new Error("Seleccione una fecha válida para el reporte diario.")
    }
    desde = hasta = String(fecha)
    label = `Día ${desde}`
  } else if (periodo_tipo === "mensual") {
    const y = Number.parseInt(anio, 10)
    const m = Number.parseInt(mes, 10)
    if (!y || m < 1 || m > 12) {
      throw new Error("Seleccione año y mes válidos.")
    }
    desde = `${y}-${pad2(m)}-01`
    const last = new Date(y, m, 0).getDate()
    hasta = `${y}-${pad2(m)}-${pad2(last)}`
    label = `Mes ${pad2(m)}/${y}`
  } else if (periodo_tipo === "anual") {
    const y = Number.parseInt(anio, 10)
    if (!y || y < 2000 || y > 2100) {
      throw new Error("Seleccione un año válido.")
    }
    desde = `${y}-01-01`
    hasta = `${y}-12-31`
    label = `Año ${y}`
  } else if (periodo_tipo === "personalizado") {
    if (!fecha_desde || !fecha_hasta) {
      throw new Error("Indique fecha desde y fecha hasta.")
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_desde)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_hasta))) {
      throw new Error("Las fechas deben tener formato AAAA-MM-DD.")
    }
    if (String(fecha_desde) > String(fecha_hasta)) {
      throw new Error("La fecha desde no puede ser posterior a la fecha hasta.")
    }
    desde = String(fecha_desde)
    hasta = String(fecha_hasta)
    label = `${desde} al ${hasta}`
  } else {
    throw new Error("Tipo de periodo no válido.")
  }

  const d0 = new Date(`${desde}T12:00:00`)
  const d1 = new Date(`${hasta}T12:00:00`)
  const days = Math.floor((d1 - d0) / 86400000) + 1
  if (days > 732) {
    throw new Error("El rango máximo permitido es de 24 meses.")
  }

  return { desde, hasta, label }
}

const assertSucursal = async (pool, usuarioId, rol, sucursalId) => {
  const sid = Number.parseInt(sucursalId, 10)
  if (!sid || Number.isNaN(sid)) {
    return { ok: false, code: "VALIDATION", message: "Debe seleccionar una sucursal." }
  }

  const [sucRows] = await pool.execute("SELECT id, nombre FROM sucursales WHERE id = ? AND activo = 1", [sid])
  const suc = sucRows[0]
  if (!suc) {
    return { ok: false, code: "VALIDATION", message: "Sucursal no encontrada o inactiva." }
  }

  if (rol === "admin") {
    return { ok: true, sucursal: suc }
  }

  const [rows] = await pool.execute(
    "SELECT 1 FROM usuario_sucursales WHERE usuario_id = ? AND sucursal_id = ? LIMIT 1",
    [usuarioId, sid],
  )
  if (!rows.length) {
    return { ok: false, code: "FORBIDDEN", message: "No tienes acceso a esta sucursal." }
  }

  return { ok: true, sucursal: suc }
}

const montoVenta = (v) => {
  const t = v.total_con_interes_tarjeta
  if (t != null && t !== "" && Number(t) !== 0) {
    return Number(t)
  }
  return Number(v.total || 0)
}

const buildVentasWhere = (sucursalId, desde, hasta, tipoPago, estado, categoriaId) => {
  const where = ["v.sucursal_id = ?", "DATE(v.created_at) >= ?", "DATE(v.created_at) <= ?"]
  const params = [sucursalId, desde, hasta]

  if (tipoPago) {
    where.push("v.tipo_pago = ?")
    params.push(tipoPago)
  }
  if (estado) {
    where.push("v.estado = ?")
    params.push(estado)
  }
  if (categoriaId) {
    where.push(
      `EXISTS (
        SELECT 1 FROM detalle_ventas dv2
        INNER JOIN productos p2 ON p2.id = dv2.producto_id
        WHERE dv2.venta_id = v.id AND p2.categoria_id = ?
      )`,
    )
    params.push(categoriaId)
  }

  return { whereClause: where.join(" AND "), params }
}

const buildServiciosWhere = (sucursalId, desde, hasta, tipoPago, estado) => {
  const where = ["s.activo = true", "s.sucursal_id = ?", "DATE(s.created_at) >= ?", "DATE(s.created_at) <= ?"]
  const params = [sucursalId, desde, hasta]

  if (tipoPago) {
    where.push("s.tipo_pago = ?")
    params.push(tipoPago)
  }
  if (estado) {
    where.push("s.estado = ?")
    params.push(estado)
  }

  return { whereClause: where.join(" AND "), params }
}

const parseReportBody = (body) => {
  const tipo_reporte = String(body.tipo_reporte || "").toLowerCase()
  const periodo_tipo = String(body.periodo_tipo || "").toLowerCase()

  if (!TIPOS_REPORTE.includes(tipo_reporte)) {
    return { error: "tipo_reporte debe ser ventas, servicios o ambos." }
  }
  if (!PERIODOS.includes(periodo_tipo)) {
    return { error: "periodo_tipo no válido." }
  }

  let range
  try {
    range = resolveDateRange(body)
  } catch (e) {
    return { error: e.message }
  }

  const categoria_id = body.categoria_id ? Number.parseInt(body.categoria_id, 10) : null
  const tipo_pago_ventas = body.tipo_pago_ventas ? String(body.tipo_pago_ventas).toUpperCase().trim() : ""
  const estado_ventas = body.estado_ventas ? String(body.estado_ventas).toUpperCase().trim() : ""
  const tipo_pago_servicios = body.tipo_pago_servicios
    ? String(body.tipo_pago_servicios).toUpperCase().trim()
    : ""
  const estado_servicios = body.estado_servicios ? String(body.estado_servicios).toUpperCase().trim() : ""

  return {
    tipo_reporte,
    periodo_tipo,
    range,
    categoria_id: Number.isFinite(categoria_id) ? categoria_id : null,
    tipo_pago_ventas,
    estado_ventas,
    tipo_pago_servicios,
    estado_servicios,
  }
}

async function loadVentasLista(pool, whereClause, params, orderDir, limit) {
  const order = orderDir === "DESC" ? "DESC" : "ASC"
  let sql = `SELECT
      v.id,
      v.numero,
      v.tipo_pago,
      v.subtotal,
      v.descuento,
      v.total,
      v.total_con_interes_tarjeta,
      v.estado,
      v.observaciones,
      v.created_at,
      CONCAT(c.nombre, ' ', IFNULL(c.apellido, '')) AS cliente_nombre
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    WHERE ${whereClause}
    ORDER BY v.created_at ${order}, v.id ${order}`
  const p = [...params]
  if (limit) {
    sql += " LIMIT ?"
    p.push(limit)
  }
  const [rows] = await pool.execute(sql, p)
  return rows
}

async function loadDetalleProductos(pool, whereClause, params, limit) {
  let sql = `SELECT
      v.numero AS venta_numero,
      v.created_at AS venta_fecha,
      cat.nombre AS categoria,
      p.codigo AS producto_codigo,
      p.nombre AS producto_nombre,
      dv.cantidad,
      dv.precio_unitario,
      (dv.cantidad * dv.precio_unitario) AS subtotal_linea,
      v.estado AS venta_estado
    FROM detalle_ventas dv
    INNER JOIN ventas v ON v.id = dv.venta_id
    INNER JOIN productos p ON p.id = dv.producto_id
    LEFT JOIN categorias cat ON cat.id = p.categoria_id
    WHERE ${whereClause}
    ORDER BY v.created_at DESC, v.numero ASC, dv.id ASC`
  const p = [...params]
  if (limit) {
    sql += " LIMIT ?"
    p.push(limit)
  }
  const [rows] = await pool.execute(sql, p)
  return rows
}

async function loadServiciosLista(pool, whereClause, params, orderDir, limit) {
  const order = orderDir === "DESC" ? "DESC" : "ASC"
  let sql = `SELECT
      s.numero,
      s.created_at,
      s.tipo_pago,
      s.estado,
      s.total,
      s.observaciones,
      CONCAT(c.nombre, ' ', IFNULL(c.apellido, '')) AS cliente_nombre,
      v.patente AS vehiculo_patente,
      v.marca AS vehiculo_marca,
      v.modelo AS vehiculo_modelo
    FROM servicios s
    LEFT JOIN clientes c ON s.cliente_id = c.id
    LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
    WHERE ${whereClause}
    ORDER BY s.created_at ${order}, s.id ${order}`
  const p = [...params]
  if (limit) {
    sql += " LIMIT ?"
    p.push(limit)
  }
  const [rows] = await pool.execute(sql, p)
  return rows
}

const exportarExcel = async (req, res) => {
  try {
    const parsed = parseReportBody(req.body || {})
    if (parsed.error) {
      return ResponseHelper.validationError(res, parsed.error)
    }

    const check = await assertSucursal(db.pool, req.user.id, req.user.rol, req.body.sucursal_id)
    if (!check.ok) {
      if (check.code === "FORBIDDEN") {
        return ResponseHelper.forbidden(res, check.message)
      }
      return ResponseHelper.validationError(res, check.message)
    }

    const sucursal_id = Number.parseInt(req.body.sucursal_id, 10)
    const {
      tipo_reporte,
      range,
      categoria_id,
      tipo_pago_ventas,
      estado_ventas,
      tipo_pago_servicios,
      estado_servicios,
    } = parsed
    const { desde, hasta, label } = range

    const wb = XLSX.utils.book_new()

    let ventas = []
    let servicios = []
    let detalleProductos = []

    if (tipo_reporte === "ventas" || tipo_reporte === "ambos") {
      const { whereClause, params } = buildVentasWhere(
        sucursal_id,
        desde,
        hasta,
        tipo_pago_ventas,
        estado_ventas,
        categoria_id,
      )
      ventas = await loadVentasLista(db.pool, whereClause, params, "ASC", null)
      detalleProductos = await loadDetalleProductos(db.pool, whereClause, params, null)
    }

    if (tipo_reporte === "servicios" || tipo_reporte === "ambos") {
      const { whereClause, params } = buildServiciosWhere(
        sucursal_id,
        desde,
        hasta,
        tipo_pago_servicios,
        estado_servicios,
      )
      servicios = await loadServiciosLista(db.pool, whereClause, params, "ASC", null)
    }

    const totalVentasMonto = ventas.reduce((acc, v) => acc + montoVenta(v), 0)
    const totalServiciosMonto = servicios.reduce((acc, s) => acc + Number(s.total || 0), 0)

    const resumenRows = [
      ["Niña Lubricantes — Reporte operativo"],
      [],
      ["Generado", formatDateTime(new Date())],
      ["Usuario", req.user.nombre || String(req.user.id)],
      ["Sucursal", check.sucursal.nombre],
      ["Periodo", label],
      ["Desde (fecha)", desde],
      ["Hasta (fecha)", hasta],
      ["Tipo de reporte", tipo_reporte],
      [],
      ["Indicadores"],
      ["Ventas — cantidad de comprobantes", tipo_reporte === "servicios" ? "—" : ventas.length],
      ["Ventas — total (según total / interés tarjeta)", tipo_reporte === "servicios" ? "—" : totalVentasMonto],
      ["Servicios — cantidad", tipo_reporte === "ventas" ? "—" : servicios.length],
      ["Servicios — total", tipo_reporte === "ventas" ? "—" : totalServiciosMonto],
      ["Total combinado (ventas + servicios)", tipo_reporte === "ambos" ? totalVentasMonto + totalServiciosMonto : "—"],
    ]

    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows)
    wsResumen["!cols"] = [{ wch: 28 }, { wch: 42 }]
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen")

    if (tipo_reporte === "ventas" || tipo_reporte === "ambos") {
      const ventasJson = ventas.map((v) => ({
        Numero: v.numero,
        Fecha: formatDateTime(v.created_at),
        Cliente: (v.cliente_nombre || "").trim() || "—",
        Tipo_pago: v.tipo_pago,
        Estado: v.estado,
        Subtotal: Number(v.subtotal || 0),
        Descuento: Number(v.descuento || 0),
        Total: montoVenta(v),
        Observaciones: v.observaciones || "",
      }))
      const wsV = XLSX.utils.json_to_sheet(ventasJson.length ? ventasJson : [{ Numero: "Sin registros" }])
      XLSX.utils.book_append_sheet(wb, wsV, "Ventas")

      const detJson = detalleProductos.map((r) => ({
        Venta: r.venta_numero,
        Fecha_venta: formatDateTime(r.venta_fecha),
        Categoria: r.categoria || "—",
        Codigo_producto: r.producto_codigo || "",
        Producto: r.producto_nombre,
        Cantidad: Number(r.cantidad || 0),
        Precio_unitario: Number(r.precio_unitario || 0),
        Subtotal_linea: Number(r.subtotal_linea || 0),
        Estado_venta: r.venta_estado,
      }))
      const wsD = XLSX.utils.json_to_sheet(detJson.length ? detJson : [{ Venta: "Sin líneas de detalle" }])
      XLSX.utils.book_append_sheet(wb, wsD, "Ventas detalle productos")
    }

    if (tipo_reporte === "servicios" || tipo_reporte === "ambos") {
      const servJson = servicios.map((s) => ({
        Numero: s.numero,
        Fecha: formatDateTime(s.created_at),
        Cliente: (s.cliente_nombre || "").trim() || "—",
        Patente: s.vehiculo_patente || "—",
        Vehiculo: [s.vehiculo_marca, s.vehiculo_modelo].filter(Boolean).join(" ") || "—",
        Tipo_pago: s.tipo_pago,
        Estado: s.estado,
        Total: Number(s.total || 0),
        Observaciones: s.observaciones || "",
      }))
      const wsS = XLSX.utils.json_to_sheet(servJson.length ? servJson : [{ Numero: "Sin registros" }])
      XLSX.utils.book_append_sheet(wb, wsS, "Servicios")
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
    const safeName = (check.sucursal.nombre || "sucursal")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 40)
    const fname = `Reporte_${safeName}_${desde}_${hasta}.xlsx`

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`)
    return res.status(200).send(Buffer.from(buf))
  } catch (error) {
    logger.error("Error exportarExcel reportes", { message: error.message, stack: error.stack })
    return ResponseHelper.error(res, "Error al generar el reporte.", 500)
  }
}

const obtenerDatos = async (req, res) => {
  try {
    const parsed = parseReportBody(req.body || {})
    if (parsed.error) {
      return ResponseHelper.validationError(res, parsed.error)
    }

    const check = await assertSucursal(db.pool, req.user.id, req.user.rol, req.body.sucursal_id)
    if (!check.ok) {
      if (check.code === "FORBIDDEN") {
        return ResponseHelper.forbidden(res, check.message)
      }
      return ResponseHelper.validationError(res, check.message)
    }

    const sucursal_id = Number.parseInt(req.body.sucursal_id, 10)
    const {
      tipo_reporte,
      periodo_tipo,
      range,
      categoria_id,
      tipo_pago_ventas,
      estado_ventas,
      tipo_pago_servicios,
      estado_servicios,
    } = parsed
    const { desde, hasta, label } = range

    let ventas = []
    let servicios = []
    let detalleProductos = []
    let ventasTotalCount = 0
    let serviciosTotalCount = 0
    let ventasPorDia = []
    let serviciosPorDia = []
    let ventasPorTipoPago = []
    let serviciosPorTipoPago = []
    let ventasPorCategoria = []

    if (tipo_reporte === "ventas" || tipo_reporte === "ambos") {
      const base = buildVentasWhere(sucursal_id, desde, hasta, tipo_pago_ventas, estado_ventas, categoria_id)
      const { whereClause, params } = base

      const [cV] = await db.pool.execute(`SELECT COUNT(*) AS n FROM ventas v WHERE ${whereClause}`, params)
      ventasTotalCount = Number(cV[0]?.n || 0)

      const [vpd] = await db.pool.execute(
        `SELECT DATE(v.created_at) AS fecha, COUNT(*) AS cantidad, SUM(${SQL_MONTO_VENTA}) AS total
         FROM ventas v WHERE ${whereClause}
         GROUP BY DATE(v.created_at) ORDER BY fecha ASC`,
        params,
      )
      ventasPorDia = vpd.map((r) => ({
        fecha:
          r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10),
        cantidad: Number(r.cantidad || 0),
        total: Number(r.total || 0),
      }))

      const [vpp] = await db.pool.execute(
        `SELECT v.tipo_pago AS tipo_pago, COUNT(*) AS cantidad, SUM(${SQL_MONTO_VENTA}) AS total
         FROM ventas v WHERE ${whereClause}
         GROUP BY v.tipo_pago ORDER BY total DESC`,
        params,
      )
      ventasPorTipoPago = vpp.map((r) => ({
        tipo_pago: r.tipo_pago || "—",
        cantidad: Number(r.cantidad || 0),
        total: Number(r.total || 0),
      }))

      const [vpc] = await db.pool.execute(
        `SELECT COALESCE(cat.nombre, 'Sin categoría') AS categoria,
                SUM(dv.cantidad * dv.precio_unitario) AS total,
                SUM(dv.cantidad) AS unidades
         FROM detalle_ventas dv
         INNER JOIN ventas v ON v.id = dv.venta_id
         INNER JOIN productos p ON p.id = dv.producto_id
         LEFT JOIN categorias cat ON cat.id = p.categoria_id
         WHERE ${whereClause}
         GROUP BY cat.id, cat.nombre
         ORDER BY total DESC
         LIMIT 15`,
        params,
      )
      ventasPorCategoria = vpc.map((r) => ({
        categoria: r.categoria,
        total: Number(r.total || 0),
        unidades: Number(r.unidades || 0),
      }))

      ventas = await loadVentasLista(db.pool, whereClause, params, "DESC", UI_LIMIT_VENTAS)
      detalleProductos = await loadDetalleProductos(db.pool, whereClause, params, UI_LIMIT_DETALLE)
    }

    if (tipo_reporte === "servicios" || tipo_reporte === "ambos") {
      const { whereClause, params } = buildServiciosWhere(
        sucursal_id,
        desde,
        hasta,
        tipo_pago_servicios,
        estado_servicios,
      )

      const [cS] = await db.pool.execute(`SELECT COUNT(*) AS n FROM servicios s WHERE ${whereClause}`, params)
      serviciosTotalCount = Number(cS[0]?.n || 0)

      const [spd] = await db.pool.execute(
        `SELECT DATE(s.created_at) AS fecha, COUNT(*) AS cantidad, SUM(COALESCE(s.total, 0)) AS total
         FROM servicios s WHERE ${whereClause}
         GROUP BY DATE(s.created_at) ORDER BY fecha ASC`,
        params,
      )
      serviciosPorDia = spd.map((r) => ({
        fecha:
          r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10),
        cantidad: Number(r.cantidad || 0),
        total: Number(r.total || 0),
      }))

      const [spp] = await db.pool.execute(
        `SELECT s.tipo_pago AS tipo_pago, COUNT(*) AS cantidad, SUM(COALESCE(s.total, 0)) AS total
         FROM servicios s WHERE ${whereClause}
         GROUP BY s.tipo_pago ORDER BY total DESC`,
        params,
      )
      serviciosPorTipoPago = spp.map((r) => ({
        tipo_pago: r.tipo_pago || "—",
        cantidad: Number(r.cantidad || 0),
        total: Number(r.total || 0),
      }))

      servicios = await loadServiciosLista(db.pool, whereClause, params, "DESC", UI_LIMIT_SERVICIOS)
    }

    let ventasMontoPeriodo = 0
    let serviciosMontoPeriodo = 0
    if (tipo_reporte === "ventas" || tipo_reporte === "ambos") {
      const { whereClause, params } = buildVentasWhere(
        sucursal_id,
        desde,
        hasta,
        tipo_pago_ventas,
        estado_ventas,
        categoria_id,
      )
      const [sumV] = await db.pool.execute(
        `SELECT SUM(${SQL_MONTO_VENTA}) AS total FROM ventas v WHERE ${whereClause}`,
        params,
      )
      ventasMontoPeriodo = Number(sumV[0]?.total || 0)
    }
    if (tipo_reporte === "servicios" || tipo_reporte === "ambos") {
      const { whereClause, params } = buildServiciosWhere(
        sucursal_id,
        desde,
        hasta,
        tipo_pago_servicios,
        estado_servicios,
      )
      const [sumS] = await db.pool.execute(
        `SELECT SUM(COALESCE(s.total, 0)) AS total FROM servicios s WHERE ${whereClause}`,
        params,
      )
      serviciosMontoPeriodo = Number(sumS[0]?.total || 0)
    }

    const combinadoMonto =
      tipo_reporte === "ambos" ? ventasMontoPeriodo + serviciosMontoPeriodo : null

    const data = {
      meta: {
        sucursal: check.sucursal,
        periodo_label: label,
        fecha_desde: desde,
        fecha_hasta: hasta,
        periodo_tipo,
        tipo_reporte,
        generado_at: new Date().toISOString(),
        usuario: { id: req.user.id, nombre: req.user.nombre },
        limites: {
          ventas_lista: UI_LIMIT_VENTAS,
          servicios_lista: UI_LIMIT_SERVICIOS,
          detalle_lineas: UI_LIMIT_DETALLE,
        },
      },
      resumen: {
        ventas_total_count: tipo_reporte === "servicios" ? 0 : ventasTotalCount,
        ventas_total_monto: tipo_reporte === "servicios" ? 0 : ventasMontoPeriodo,
        ventas_lista_count: ventas.length,
        ventas_truncado: tipo_reporte !== "servicios" && ventasTotalCount > ventas.length,
        servicios_total_count: tipo_reporte === "ventas" ? 0 : serviciosTotalCount,
        servicios_total_monto: tipo_reporte === "ventas" ? 0 : serviciosMontoPeriodo,
        servicios_lista_count: servicios.length,
        servicios_truncado: tipo_reporte !== "ventas" && serviciosTotalCount > servicios.length,
        detalle_lineas_count: detalleProductos.length,
        detalle_truncado: tipo_reporte !== "servicios" && detalleProductos.length >= UI_LIMIT_DETALLE,
        combinado_monto: combinadoMonto,
      },
      series: {
        ventas_por_dia: tipo_reporte === "servicios" ? [] : ventasPorDia,
        servicios_por_dia: tipo_reporte === "ventas" ? [] : serviciosPorDia,
      },
      distribucion: {
        ventas_por_tipo_pago: tipo_reporte === "servicios" ? [] : ventasPorTipoPago,
        servicios_por_tipo_pago: tipo_reporte === "ventas" ? [] : serviciosPorTipoPago,
        ventas_por_categoria: tipo_reporte === "servicios" ? [] : ventasPorCategoria,
      },
      listas: {
        ventas: tipo_reporte === "servicios" ? [] : ventas,
        servicios: tipo_reporte === "ventas" ? [] : servicios,
        detalle_productos: tipo_reporte === "servicios" ? [] : detalleProductos,
      },
    }

    return ResponseHelper.success(res, data, "Reporte obtenido correctamente")
  } catch (error) {
    logger.error("Error obtenerDatos reportes", { message: error.message, stack: error.stack })
    return ResponseHelper.error(res, "Error al obtener el reporte.", 500)
  }
}

module.exports = {
  exportarExcel,
  obtenerDatos,
}
