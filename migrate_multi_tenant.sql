-- migrate_multi_tenant.sql
-- Multi-empresa: RLS, gst_cliente_movimientos, configs a nivel empresa.
-- Ejecutar en Supabase SQL Editor (una sola vez).

-- ---------------------------------------------------------------------------
-- 1. Tabla faltante: movimientos de cuenta corriente de clientes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gst_cliente_movimientos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.gst_businesses(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.gst_clientes(id) ON DELETE CASCADE,
  fecha timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  concepto text NOT NULL,
  debe numeric(12,2) DEFAULT 0.00 NOT NULL,
  haber numeric(12,2) DEFAULT 0.00 NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS gst_cliente_movimientos_business_idx
  ON public.gst_cliente_movimientos (business_id, cliente_id, fecha DESC);

-- ---------------------------------------------------------------------------
-- 2. Configs: permitir filas solo por empresa (sin terminal obligatoria)
-- ---------------------------------------------------------------------------
ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.gst_configs ADD COLUMN IF NOT EXISTS value jsonb;
ALTER TABLE public.gst_configs ALTER COLUMN terminal_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gst_configs_business_key_idx
  ON public.gst_configs (business_id, key)
  WHERE key IS NOT NULL;

COMMENT ON COLUMN public.gst_configs.key IS 'Config a nivel empresa (enabled_modules, role_permissions, arca, etc.)';
COMMENT ON COLUMN public.gst_configs.value IS 'JSON de configuración por empresa';

-- ---------------------------------------------------------------------------
-- 3. Helper: empresa del usuario autenticado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gst_current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS — aislamiento por empresa
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'gst_clientes',
    'gst_cliente_direcciones',
    'gst_cliente_movimientos',
    'gst_productos',
    'gst_proveedores',
    'gst_compras',
    'gst_personal',
    'gst_empleado_movimientos',
    'gst_proveedor_pagos',
    'gst_cierres_caja',
    'gst_rendiciones',
    'gst_tareas',
    'gst_pedidos',
    'gst_pedido_items',
    'gst_pagos_periodicos',
    'gst_configs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS gst_tenant_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY gst_tenant_all ON public.%I FOR ALL TO authenticated
       USING (business_id = public.gst_current_business_id())
       WITH CHECK (business_id = public.gst_current_business_id())',
      t
    );
  END LOOP;
END $$;

-- gst_businesses: ver solo la propia empresa
ALTER TABLE public.gst_businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_business_select ON public.gst_businesses;
CREATE POLICY gst_business_select ON public.gst_businesses
  FOR SELECT TO authenticated
  USING (id = public.gst_current_business_id());

DROP POLICY IF EXISTS gst_business_insert ON public.gst_businesses;
CREATE POLICY gst_business_insert ON public.gst_businesses
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- gst_profiles: usuarios de la misma empresa + alta propia en signup
ALTER TABLE public.gst_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_profiles_select ON public.gst_profiles;
CREATE POLICY gst_profiles_select ON public.gst_profiles
  FOR SELECT TO authenticated
  USING (business_id = public.gst_current_business_id() OR id = auth.uid());

DROP POLICY IF EXISTS gst_profiles_insert ON public.gst_profiles;
CREATE POLICY gst_profiles_insert ON public.gst_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS gst_profiles_update ON public.gst_profiles;
CREATE POLICY gst_profiles_update ON public.gst_profiles
  FOR UPDATE TO authenticated
  USING (business_id = public.gst_current_business_id())
  WITH CHECK (business_id = public.gst_current_business_id());

-- Terminales: por empresa; alta libre en signup, resto aislado por tenant
ALTER TABLE public.gst_terminals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_tenant_all ON public.gst_terminals;
DROP POLICY IF EXISTS gst_terminals_insert_signup ON public.gst_terminals;
DROP POLICY IF EXISTS gst_terminals_select ON public.gst_terminals;
DROP POLICY IF EXISTS gst_terminals_insert ON public.gst_terminals;
DROP POLICY IF EXISTS gst_terminals_update ON public.gst_terminals;
DROP POLICY IF EXISTS gst_terminals_delete ON public.gst_terminals;

CREATE POLICY gst_terminals_select ON public.gst_terminals
  FOR SELECT TO authenticated
  USING (business_id = public.gst_current_business_id());

CREATE POLICY gst_terminals_insert ON public.gst_terminals
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY gst_terminals_update ON public.gst_terminals
  FOR UPDATE TO authenticated
  USING (business_id = public.gst_current_business_id())
  WITH CHECK (business_id = public.gst_current_business_id());

CREATE POLICY gst_terminals_delete ON public.gst_terminals
  FOR DELETE TO authenticated
  USING (business_id = public.gst_current_business_id());

NOTIFY pgrst, 'reload schema';
