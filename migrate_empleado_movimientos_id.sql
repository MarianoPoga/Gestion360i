-- Vincular movimientos de empleados a gst_personal por ID (no solo por nombre).
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE public.gst_empleado_movimientos
  ADD COLUMN IF NOT EXISTS empleado_id uuid REFERENCES public.gst_personal(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gst_empleado_movimientos_empleado_id_idx
  ON public.gst_empleado_movimientos (business_id, empleado_id);

COMMENT ON COLUMN public.gst_empleado_movimientos.empleado_id IS
  'FK a gst_personal. empleado (text) queda como snapshot del nombre al registrar.';

-- Backfill: match exacto por nombre dentro de la misma empresa
UPDATE public.gst_empleado_movimientos m
SET empleado_id = p.id
FROM public.gst_personal p
WHERE m.business_id = p.business_id
  AND m.empleado_id IS NULL
  AND coalesce(trim(m.empleado), '') <> ''
  AND lower(trim(m.empleado)) = lower(trim(p.nombre));

-- Completar snapshot de nombre donde falte pero hay ID
UPDATE public.gst_empleado_movimientos m
SET empleado = p.nombre
FROM public.gst_personal p
WHERE m.empleado_id = p.id
  AND coalesce(trim(m.empleado), '') = '';

-- Diagnóstico: movimientos sin empleado_id (nombres huérfanos)
-- SELECT m.id, m.empleado, m.fecha, m.concepto
-- FROM public.gst_empleado_movimientos m
-- WHERE m.empleado_id IS NULL
-- ORDER BY m.fecha DESC;
