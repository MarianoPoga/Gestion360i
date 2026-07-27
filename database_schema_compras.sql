-- SQL script to update the compras table and create the proveedores table
-- Run this script in your Supabase SQL Editor.

-- Update compras table with missing tax and payment columns
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS cuit text;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS monto_neto numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS iva_10_5 numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS iva_21 numeric(12,2) DEFAULT 0.00;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS pago text;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS factura text;

-- Create proveedores table for supplier defaults autocomplete
CREATE TABLE IF NOT EXISTS public.proveedores (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre text NOT NULL UNIQUE,
    cuit text,
    tipo text,
    detalle text,
    pago text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
