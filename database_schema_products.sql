-- PostgreSQL DDL Script for Gestion360i Supabase Products Table
-- Run this script in the Supabase SQL Editor of your project.

-- TABLA: productos
CREATE TABLE IF NOT EXISTS public.productos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre text NOT NULL UNIQUE,
    rubro text,
    precio numeric(12,2) DEFAULT 0.00 NOT NULL,
    stock numeric(12,2) DEFAULT 0.00 NOT NULL,
    iva numeric(5,2) DEFAULT 21.00 NOT NULL, -- 21.00, 10.50, 0.00, etc.
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Deshabilitar RLS para que se comporte igual que el resto de las tablas públicas del proyecto
ALTER TABLE public.productos DISABLE ROW LEVEL SECURITY;

-- AGREGAR COLUMNA iva_alicuota A pedido_items PARA GUARDAR EL IVA APLICADO AL MOMENTO DEL PEDIDO
ALTER TABLE public.pedido_items ADD COLUMN IF NOT EXISTS iva_alicuota numeric(5,2) DEFAULT 21.00 NOT NULL;
