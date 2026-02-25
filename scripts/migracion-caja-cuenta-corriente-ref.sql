-- Referencia de ventas/servicios en cuenta corriente por sesión de caja (solo visual, no afecta saldo).
-- Ejecutar contra la base de datos antes de usar la funcionalidad.

ALTER TABLE sesiones_caja
  ADD COLUMN total_ventas_cuenta_corriente DECIMAL(12,2) DEFAULT 0 COMMENT 'Suma de totales de ventas en CC en esta sesión (referencia)',
  ADD COLUMN cantidad_ventas_cuenta_corriente INT DEFAULT 0 COMMENT 'Cantidad de ventas en CC en esta sesión',
  ADD COLUMN total_servicios_cuenta_corriente DECIMAL(12,2) DEFAULT 0 COMMENT 'Suma de totales de servicios en CC en esta sesión (referencia)',
  ADD COLUMN cantidad_servicios_cuenta_corriente INT DEFAULT 0 COMMENT 'Cantidad de servicios en CC en esta sesión';
