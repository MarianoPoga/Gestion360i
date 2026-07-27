-- DEPRECATED: usar gst_proveedor_pagos (ver GST_unified_schema.sql y fix_permissions.sql)
-- Este script se mantiene solo como referencia histórica.

CREATE TABLE IF NOT EXISTS public.gst_proveedor_pagos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.gst_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.gst_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    proveedor text NOT NULL,
    alias text,
    origen text NOT NULL,
    monto numeric(12,2) NOT NULL,
    observacion text,
    caja_cierre text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gst_proveedor_pagos_fecha ON public.gst_proveedor_pagos(fecha);
