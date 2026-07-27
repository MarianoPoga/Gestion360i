-- Add nro_factura and no_computar_compra to gst_compras table
ALTER TABLE public.gst_compras ADD COLUMN IF NOT EXISTS nro_factura text;
ALTER TABLE public.gst_compras ADD COLUMN IF NOT EXISTS no_computar_compra boolean DEFAULT false;
