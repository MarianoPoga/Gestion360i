-- Diagnóstico: dónde están los datos viejos
SELECT 'gst_businesses' AS tabla, count(*) FROM gst_businesses
UNION ALL SELECT 'gst_profiles', count(*) FROM gst_profiles
UNION ALL SELECT 'gst_clientes', count(*) FROM gst_clientes
UNION ALL SELECT 'clientes (legacy)', count(*) FROM clientes
UNION ALL SELECT 'gst_personal', count(*) FROM gst_personal
UNION ALL SELECT 'personal (legacy)', count(*) FROM personal
UNION ALL SELECT 'gst_proveedores', count(*) FROM gst_proveedores
UNION ALL SELECT 'proveedores (legacy)', count(*) FROM proveedores;

-- Clientes gst por business_id
SELECT business_id, count(*) AS total FROM gst_clientes GROUP BY business_id;

-- Tu business_id según perfil (reemplazar email)
-- SELECT p.business_id, p.full_name, b.name FROM gst_profiles p JOIN gst_businesses b ON b.id = p.business_id;

-- Reasignar TODOS los gst_clientes al único negocio (solo si hay 1 empresa)
-- UPDATE gst_clientes SET business_id = (SELECT id FROM gst_businesses LIMIT 1)
-- WHERE business_id != (SELECT id FROM gst_businesses LIMIT 1);
