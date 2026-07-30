-- Agrega columna para motivo de cancelación en pedidos (si no existe)
ALTER TABLE public.gst_pedidos
  ADD COLUMN IF NOT EXISTS motivo_cancelacion text;
