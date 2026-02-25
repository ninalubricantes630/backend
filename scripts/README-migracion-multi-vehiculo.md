# Migración: Múltiples vehículos por servicio

Antes de usar la funcionalidad de **varios vehículos por servicio**, ejecuta la migración SQL contra tu base de datos.

## Pasos

1. Conectarte a tu base de datos MySQL (por ejemplo con MySQL Workbench, DBeaver o `mysql` CLI).
2. Ejecutar el archivo `migracion-servicios-multi-vehiculo.sql` (en el orden indicado dentro del archivo).

Si la columna `servicio_items.vehiculo_id` ya existe (por una ejecución previa), omite los dos `ALTER TABLE` del paso 2 y ejecuta solo los pasos 3 y 4 (UPDATE e INSERT).

## Resumen de cambios en BD

- **servicio_vehiculos**: nueva tabla que relaciona cada servicio con uno o más vehículos.
- **servicio_items.vehiculo_id**: nueva columna que indica a qué vehículo corresponde cada ítem del servicio.
- Los servicios ya existentes quedan con un solo vehículo (el que tenían en `servicios.vehiculo_id`).

Después de la migración, el listado de servicios y el detalle de un servicio mostrarán todos los vehículos cuando corresponda.
