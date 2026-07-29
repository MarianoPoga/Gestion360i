-- fix_gst_configs_upsert.sql
-- Corrige error 400 al guardar configuración en gst_configs (Vercel / Supabase).
-- Ejecutar una vez en Supabase → SQL Editor.

ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS value jsonb;

ALTER TABLE public.gst_configs ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE public.gst_configs ALTER COLUMN config_key DROP NOT NULL;
ALTER TABLE public.gst_configs ALTER COLUMN config_value DROP NOT NULL;

-- Copiar datos legacy a columnas nuevas
UPDATE public.gst_configs
SET key = config_key,
    value = config_value
WHERE key IS NULL
  AND config_key IS NOT NULL;

-- Quitar duplicados (business_id + key), conservar el más reciente
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY business_id, key
           ORDER BY updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.gst_configs
  WHERE key IS NOT NULL
)
DELETE FROM public.gst_configs
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS public.gst_configs_business_key_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gst_configs_business_key_unique'
  ) THEN
    ALTER TABLE public.gst_configs
      ADD CONSTRAINT gst_configs_business_key_unique UNIQUE (business_id, key);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
