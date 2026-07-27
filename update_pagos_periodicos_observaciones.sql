-- Add observaciones column to gst_pagos_periodicos
ALTER TABLE public.gst_pagos_periodicos ADD COLUMN IF NOT EXISTS observaciones text;
