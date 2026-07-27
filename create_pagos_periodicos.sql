-- Create gst_pagos_periodicos table
CREATE TABLE IF NOT EXISTS public.gst_pagos_periodicos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.gst_businesses(id) ON DELETE CASCADE NOT NULL,
    subgrupo text NOT NULL,          -- Ej: '2.1. Personal', '2.3. Servicios'
    nombre text NOT NULL,            -- Ej: 'Alquiler Local', 'Edesur'
    monto_mensual numeric(12,2),     -- Se copia del mes anterior automáticamente
    estado_valor text DEFAULT 'VALOR ESTIMADO', -- 'VALOR ESTIMADO' o 'VALOR CORROBORADO'
    periodicidad text DEFAULT 'Mensual',
    dia_vencimiento integer,
    tipo_factura text,               -- A, B, C, etc.
    iva_alicuota numeric(5,2) DEFAULT 21.00,
    medio_pago text,                 -- Caja, Banco, Rendición, etc.
    ultimo_pago_fecha date,          -- Para saber si ya se liquidó este mes
    observaciones text,              -- Notas adicionales
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.gst_pagos_periodicos ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to see only their business data
CREATE POLICY "Users can only access their business periodic payments" ON public.gst_pagos_periodicos
FOR ALL USING (business_id = (SELECT business_id FROM gst_profiles WHERE id = auth.uid()));
