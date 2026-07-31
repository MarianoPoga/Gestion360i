-- Vincular pedidos con cajas/turnos de cierre
-- Ejecutar en Supabase → SQL Editor

ALTER TABLE public.gst_pedidos
  ADD COLUMN IF NOT EXISTS turno_caja text,
  ADD COLUMN IF NOT EXISTS caja_cierre text;

CREATE INDEX IF NOT EXISTS gst_pedidos_turno_caja_idx
  ON public.gst_pedidos (business_id, turno_caja, fecha DESC)
  WHERE caja_cierre IS NULL;

COMMENT ON COLUMN public.gst_pedidos.turno_caja IS 'Turno/caja operativa (ej. Delivery, Mañana) asignada al tomar o cobrar el pedido';
COMMENT ON COLUMN public.gst_pedidos.caja_cierre IS 'Etiqueta de cierre de caja cuando el pedido fue incluido en un cierre';
