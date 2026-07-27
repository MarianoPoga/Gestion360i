-- SQL script to extend the compras table with advanced tax and perception columns
-- Run this script in your Supabase SQL Editor.

ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS monto_neto_10_5 numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS monto_neto_27 numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS iva_27 numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS monto_exento numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS monto_no_gravado numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS percep_iva numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS percep_iibb numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS iibb_jurisdiccion text;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS percep_ganancias numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS impuestos_internos numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS tasas_municipales numeric(12,2) DEFAULT 0.00;

-- Alias column updates
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS alias text;
ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS alias text;
