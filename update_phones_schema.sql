-- Add celular_repartidor and celular_administracion to gst_proveedores
ALTER TABLE public.gst_proveedores ADD COLUMN IF NOT EXISTS celular_repartidor text;
ALTER TABLE public.gst_proveedores ADD COLUMN IF NOT EXISTS celular_administracion text;
