-- purge_other_businesses.sql
-- ⚠️ IRREVERSIBLE: borra TODAS las empresas y datos excepto la indicada.
-- Ejecutar en Supabase → SQL Editor (como postgres / service role).
--
-- Empresa a CONSERVAR:
--   c09159ba-c6f6-46fb-a22c-e73762220663

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Verificación previa
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  keep_id uuid := 'c09159ba-c6f6-46fb-a22c-e73762220663';
  biz_name text;
  other_biz_count int;
BEGIN
  SELECT name INTO biz_name FROM public.gst_businesses WHERE id = keep_id;
  IF biz_name IS NULL THEN
    RAISE EXCEPTION 'La empresa % no existe. Abortando.', keep_id;
  END IF;

  SELECT count(*) INTO other_biz_count
  FROM public.gst_businesses WHERE id <> keep_id;

  RAISE NOTICE 'Conservar: % (%)', biz_name, keep_id;
  RAISE NOTICE 'Empresas a eliminar: %', other_biz_count;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Usuarios Auth de otras empresas (ANTES de borrar perfiles/datos)
--    gst_profiles.id → auth.users ON DELETE CASCADE
-- ---------------------------------------------------------------------------
DELETE FROM auth.users
WHERE id IN (
  SELECT p.id
  FROM public.gst_profiles p
  WHERE p.business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid
);

-- ---------------------------------------------------------------------------
-- 3. Borrar datos de otras empresas
-- ---------------------------------------------------------------------------
DELETE FROM public.gst_pedido_items
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_pedidos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_cliente_movimientos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_cliente_direcciones
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_clientes
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_empleado_movimientos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_proveedor_pagos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_compras
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_cierres_caja
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_rendiciones
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_tareas
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_pagos_periodicos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_productos
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_proveedores
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_personal
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_configs
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_terminals
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_profiles
WHERE business_id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

DELETE FROM public.gst_businesses
WHERE id IS DISTINCT FROM 'c09159ba-c6f6-46fb-a22c-e73762220663'::uuid;

-- ---------------------------------------------------------------------------
-- 4. Resumen post-limpieza
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  keep_id uuid := 'c09159ba-c6f6-46fb-a22c-e73762220663';
BEGIN
  RAISE NOTICE '--- Resumen ---';
  RAISE NOTICE 'Empresas restantes: %', (SELECT count(*) FROM public.gst_businesses);
  RAISE NOTICE 'Perfiles restantes: %', (SELECT count(*) FROM public.gst_profiles);
  RAISE NOTICE 'Clientes restantes: %', (SELECT count(*) FROM public.gst_clientes WHERE business_id = keep_id);
  RAISE NOTICE 'Terminales restantes: %', (SELECT count(*) FROM public.gst_terminals WHERE business_id = keep_id);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
