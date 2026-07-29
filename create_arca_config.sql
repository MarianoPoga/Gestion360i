-- Config ARCA por empresa (business_id) en gst_configs
-- Ejecutar en Supabase SQL Editor si falla el upsert con key/value

ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS value jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS gst_configs_business_key_idx
  ON public.gst_configs (business_id, key)
  WHERE key IS NOT NULL;

COMMENT ON COLUMN public.gst_configs.key IS 'Clave de config a nivel empresa (ej: arca, compras_categorias)';
COMMENT ON COLUMN public.gst_configs.value IS 'JSON de configuración por empresa';

NOTIFY pgrst, 'reload schema';
