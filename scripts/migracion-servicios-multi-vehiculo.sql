-- Migración: soporte de múltiples vehículos por servicio
-- Ejecutar contra la base de datos antes de desplegar el backend con esta funcionalidad.

-- 1. Tabla de relación servicio <-> vehículos (N:N)
CREATE TABLE IF NOT EXISTS servicio_vehiculos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  servicio_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_servicio_vehiculo (servicio_id, vehiculo_id),
  CONSTRAINT fk_sv_servicio FOREIGN KEY (servicio_id) REFERENCES servicios(id) ON DELETE CASCADE,
  CONSTRAINT fk_sv_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Columna vehiculo_id en servicio_items (para saber a qué vehículo corresponde cada ítem)
-- Si la columna ya existe, omitir estas dos líneas y ejecutar solo pasos 3 y 4.
ALTER TABLE servicio_items ADD COLUMN vehiculo_id INT NULL AFTER servicio_id;
ALTER TABLE servicio_items ADD KEY idx_servicio_items_vehiculo (vehiculo_id);

-- 3. Rellenar vehiculo_id en ítems existentes (un servicio = un vehículo hasta ahora)
UPDATE servicio_items si
INNER JOIN servicios s ON si.servicio_id = s.id
SET si.vehiculo_id = s.vehiculo_id
WHERE si.vehiculo_id IS NULL;

-- 4. Poblar servicio_vehiculos con los vehículos actuales (un registro por servicio)
INSERT IGNORE INTO servicio_vehiculos (servicio_id, vehiculo_id)
SELECT id, vehiculo_id FROM servicios WHERE vehiculo_id IS NOT NULL;
