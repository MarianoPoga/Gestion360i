-- SQL script to add the default invoice status column to the proveedores table.
-- Run this script in your Supabase SQL Editor.

ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS factura text;
