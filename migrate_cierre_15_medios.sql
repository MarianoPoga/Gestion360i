-- Recrea gst_cierres_caja desde cero (15 medios fijos, sin columnas legacy)
-- ⚠️ BORRA todos los cierres existentes. Ejecutar en Supabase SQL Editor.

DROP TABLE IF EXISTS public.gst_cierres_caja CASCADE;

CREATE TABLE public.gst_cierres_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.gst_businesses(id) ON DELETE CASCADE,
  terminal_id uuid REFERENCES public.gst_terminals(id) ON DELETE SET NULL,
  fecha timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  turno text NOT NULL,
  medio_01 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_02 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_03 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_04 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_05 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_06 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_07 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_08 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_09 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_10 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_11 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_12 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_13 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_14 numeric(12,2) NOT NULL DEFAULT 0.00,
  medio_15 numeric(12,2) NOT NULL DEFAULT 0.00,
  adelantos_efectivo numeric(12,2) NOT NULL DEFAULT 0.00,
  adelantos_merc numeric(12,2) NOT NULL DEFAULT 0.00,
  compras numeric(12,2) NOT NULL DEFAULT 0.00,
  total numeric(12,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_gst_cierres_caja_business_fecha
  ON public.gst_cierres_caja (business_id, fecha DESC);

COMMENT ON COLUMN public.gst_cierres_caja.medio_01 IS 'Efectivo';
COMMENT ON TABLE public.gst_cierres_caja IS 'Cierres de caja. medio_01=Efectivo, medio_02..15=configurables.';

ALTER TABLE public.gst_cierres_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cierres_select_own_business"
  ON public.gst_cierres_caja FOR SELECT
  USING (business_id IN (
    SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "cierres_insert_own_business"
  ON public.gst_cierres_caja FOR INSERT
  WITH CHECK (business_id IN (
    SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "cierres_update_own_business"
  ON public.gst_cierres_caja FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "cierres_delete_own_business"
  ON public.gst_cierres_caja FOR DELETE
  USING (business_id IN (
    SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
  ));

GRANT ALL ON public.gst_cierres_caja TO anon;
GRANT ALL ON public.gst_cierres_caja TO authenticated;

NOTIFY pgrst, 'reload schema';
