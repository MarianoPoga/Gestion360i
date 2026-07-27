DO $$ 
DECLARE 
    r RECORD;
BEGIN 
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'gst_%') LOOP 
        EXECUTE 'GRANT ALL ON public.' || quote_ident(r.tablename) || ' TO anon'; 
        EXECUTE 'GRANT ALL ON public.' || quote_ident(r.tablename) || ' TO authenticated'; 
    END LOOP; 
END $$;

-- Asegurar que la tabla de pagos a proveedores existe
CREATE TABLE IF NOT EXISTS public.gst_proveedor_pagos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.gst_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.gst_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    proveedor text NOT NULL,
    alias text,
    origen text, 
    monto numeric(12,2) NOT NULL,
    observacion text,
    caja_cierre text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Permisos adicionales para secuencias (si las hubiera, aunque usamos UUID)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Permisos adicionales para secuencias (si las hubiera, aunque usamos UUID)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Notificar para refrescar el cache de Supabase
NOTIFY pgrst, 'reload schema';
