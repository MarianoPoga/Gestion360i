-- migrate_listas_precios.sql
-- Listas de precios por empresa + asignación en clientes.
-- Ejecutar en Supabase SQL Editor (una sola vez).

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gst_listas_precios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.gst_businesses(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  es_default boolean DEFAULT false NOT NULL,
  activa boolean DEFAULT true NOT NULL,
  orden smallint DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (business_id, nombre)
);

CREATE UNIQUE INDEX IF NOT EXISTS gst_listas_precios_one_default_idx
  ON public.gst_listas_precios (business_id)
  WHERE es_default = true;

CREATE TABLE IF NOT EXISTS public.gst_lista_precio_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.gst_businesses(id) ON DELETE CASCADE,
  lista_id uuid NOT NULL REFERENCES public.gst_listas_precios(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.gst_productos(id) ON DELETE CASCADE,
  precio numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (lista_id, producto_id)
);

CREATE INDEX IF NOT EXISTS gst_lista_precio_items_lista_idx
  ON public.gst_lista_precio_items (lista_id, producto_id);

ALTER TABLE public.gst_clientes
  ADD COLUMN IF NOT EXISTS lista_precio_id uuid
  REFERENCES public.gst_listas_precios(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.gst_listas_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_lista_precio_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gst_tenant_all ON public.gst_listas_precios;
CREATE POLICY gst_tenant_all ON public.gst_listas_precios
  FOR ALL TO authenticated
  USING (business_id = public.gst_current_business_id())
  WITH CHECK (business_id = public.gst_current_business_id());

DROP POLICY IF EXISTS gst_tenant_all ON public.gst_lista_precio_items;
CREATE POLICY gst_tenant_all ON public.gst_lista_precio_items
  FOR ALL TO authenticated
  USING (business_id = public.gst_current_business_id())
  WITH CHECK (business_id = public.gst_current_business_id());

-- ---------------------------------------------------------------------------
-- 3. Seed: Lista Normal, Lista Empresas, Lista Efectivo (mismos precios base)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  biz record;
  lista_normal_id uuid;
  lista_empresas_id uuid;
  lista_efectivo_id uuid;
BEGIN
  FOR biz IN SELECT id FROM public.gst_businesses LOOP
    SELECT id INTO lista_normal_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Lista Normal'
    LIMIT 1;

    IF lista_normal_id IS NULL THEN
      INSERT INTO public.gst_listas_precios (business_id, nombre, es_default, activa, orden)
      VALUES (biz.id, 'Lista Normal', true, true, 1)
      RETURNING id INTO lista_normal_id;
    ELSE
      UPDATE public.gst_listas_precios
      SET es_default = true, activa = true, orden = 1
      WHERE id = lista_normal_id;
    END IF;

    SELECT id INTO lista_empresas_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Lista Empresas'
    LIMIT 1;

    IF lista_empresas_id IS NULL THEN
      INSERT INTO public.gst_listas_precios (business_id, nombre, es_default, activa, orden)
      VALUES (biz.id, 'Lista Empresas', false, true, 2)
      RETURNING id INTO lista_empresas_id;
    END IF;

    SELECT id INTO lista_efectivo_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Lista Efectivo'
    LIMIT 1;

    IF lista_efectivo_id IS NULL THEN
      INSERT INTO public.gst_listas_precios (business_id, nombre, es_default, activa, orden)
      VALUES (biz.id, 'Lista Efectivo', false, true, 3)
      RETURNING id INTO lista_efectivo_id;
    END IF;

    -- Lista Normal usa gst_productos.precio (sin filas en items).
    -- Empresas y Efectivo: copiar precio base de cada producto.
    INSERT INTO public.gst_lista_precio_items (business_id, lista_id, producto_id, precio)
    SELECT biz.id, lista_empresas_id, p.id, p.precio
    FROM public.gst_productos p
    WHERE p.business_id = biz.id
    ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio = EXCLUDED.precio;

    INSERT INTO public.gst_lista_precio_items (business_id, lista_id, producto_id, precio)
    SELECT biz.id, lista_efectivo_id, p.id, p.precio
    FROM public.gst_productos p
    WHERE p.business_id = biz.id
    ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio = EXCLUDED.precio;
  END LOOP;
END $$;
