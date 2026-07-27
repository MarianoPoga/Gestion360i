-- SQL DDL Script to update the empleado_movimientos table for Gestion360i
-- Run this script in your Supabase SQL Editor to support observations.

-- Add observacion column if it does not exist
ALTER TABLE public.empleado_movimientos ADD COLUMN IF NOT EXISTS observacion text;

-- Index for date queries on employee movements
CREATE INDEX IF NOT EXISTS idx_empleado_movimientos_fecha ON public.empleado_movimientos(fecha);
