-- Restablece saldos de clientes a $0 y limpia movimientos de CC.
-- NO elimina pedidos. Ejecutar en Supabase SQL Editor.

-- Opción A: solo tu empresa (reemplazá el UUID)
-- UPDATE public.gst_clientes SET saldo = 0 WHERE business_id = 'TU_BUSINESS_ID'::uuid;
-- DELETE FROM public.gst_cliente_movimientos WHERE business_id = 'TU_BUSINESS_ID'::uuid;

-- Opción B: todas las empresas (usar con cuidado)
UPDATE public.gst_clientes SET saldo = 0;
DELETE FROM public.gst_cliente_movimientos;
