-- migrate_pedidos_caja_sessions_rls.sql
-- 1) Permite que operarios abran/cierren caja (sync entre terminales).
-- 2) Elimina filas duplicadas de pedidos_caja_sessions.
-- Ejecutar una vez en Supabase → SQL Editor.

CREATE OR REPLACE FUNCTION public.gst_config_is_operational(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_key IN ('cierre_medios_used', 'pedidos_caja_sessions');
$$;

-- Quitar duplicados: conservar la fila más reciente (preferir columna key)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY business_id
           ORDER BY
             CASE WHEN key = 'pedidos_caja_sessions' THEN 0 ELSE 1 END,
             updated_at DESC NULLS LAST,
             id DESC
         ) AS rn
  FROM public.gst_configs
  WHERE key = 'pedidos_caja_sessions'
     OR config_key = 'pedidos_caja_sessions'
)
DELETE FROM public.gst_configs
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Normalizar key/value en filas legacy (solo config_key)
UPDATE public.gst_configs
SET key = 'pedidos_caja_sessions',
    value = COALESCE(value, config_value),
    config_key = 'pedidos_caja_sessions',
    config_value = COALESCE(value, config_value)
WHERE config_key = 'pedidos_caja_sessions'
  AND key IS NULL;

NOTIFY pgrst, 'reload schema';
