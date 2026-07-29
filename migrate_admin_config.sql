-- migrate_admin_config.sql
-- SaaS: un admin por empresa, configs protegidas, perfiles reforzados.
-- Ejecutar después de migrate_multi_tenant.sql
--
-- Si ya corriste la versión corta (solo índice + gst_is_admin), ejecutá:
--   migrate_admin_config_part2.sql

-- ---------------------------------------------------------------------------
-- 1. Un solo administrador por empresa
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS gst_profiles_one_admin_per_business
  ON public.gst_profiles (business_id)
  WHERE role = 'admin';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gst_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.gst_profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Keys operativas (cualquier usuario de la empresa puede escribir)
CREATE OR REPLACE FUNCTION public.gst_config_is_operational(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_key = 'cierre_medios_used';
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger: proteger rol administrador
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gst_profiles_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'admin' AND NEW.id <> auth.uid() THEN
      RAISE EXCEPTION 'No se puede asignar rol administrador manualmente';
    END IF;
    IF NEW.role = 'admin' AND NEW.id = auth.uid() THEN
      IF EXISTS (
        SELECT 1 FROM public.gst_profiles p
        WHERE p.business_id = NEW.business_id
          AND p.role = 'admin'
          AND p.id <> NEW.id
      ) THEN
        RAISE EXCEPTION 'La empresa ya tiene un administrador';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF NEW.role = 'admin' THEN
        RAISE EXCEPTION 'No se puede promover a administrador';
      END IF;
      IF OLD.role = 'admin' AND NOT public.gst_is_admin() THEN
        RAISE EXCEPTION 'No se puede modificar el rol del administrador';
      END IF;
      IF NOT public.gst_is_admin() THEN
        RAISE EXCEPTION 'Solo el administrador puede cambiar roles';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gst_profiles_role_guard ON public.gst_profiles;
CREATE TRIGGER gst_profiles_role_guard
  BEFORE INSERT OR UPDATE ON public.gst_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.gst_profiles_role_guard();

-- ---------------------------------------------------------------------------
-- 4. gst_configs: lectura por empresa; escritura admin (excepto keys operativas)
-- ---------------------------------------------------------------------------
ALTER TABLE public.gst_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gst_tenant_all ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_select ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_insert ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_update ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_delete ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_insert_admin ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_update_admin ON public.gst_configs;
DROP POLICY IF EXISTS gst_configs_delete_admin ON public.gst_configs;

CREATE POLICY gst_configs_select ON public.gst_configs
  FOR SELECT TO authenticated
  USING (business_id = public.gst_current_business_id());

CREATE POLICY gst_configs_insert ON public.gst_configs
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.gst_current_business_id()
    AND (
      public.gst_is_admin()
      OR public.gst_config_is_operational(key)
    )
  );

CREATE POLICY gst_configs_update ON public.gst_configs
  FOR UPDATE TO authenticated
  USING (business_id = public.gst_current_business_id())
  WITH CHECK (
    business_id = public.gst_current_business_id()
    AND (
      public.gst_is_admin()
      OR public.gst_config_is_operational(key)
    )
  );

CREATE POLICY gst_configs_delete ON public.gst_configs
  FOR DELETE TO authenticated
  USING (
    business_id = public.gst_current_business_id()
    AND public.gst_is_admin()
  );

-- ---------------------------------------------------------------------------
-- 5. gst_profiles: alta en signup, alta de empleados por admin, updates restringidos
-- ---------------------------------------------------------------------------
ALTER TABLE public.gst_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gst_profiles_select ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_insert ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_update ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_insert_self ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_insert_admin ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_update_admin ON public.gst_profiles;
DROP POLICY IF EXISTS gst_profiles_update_self ON public.gst_profiles;

CREATE POLICY gst_profiles_select ON public.gst_profiles
  FOR SELECT TO authenticated
  USING (business_id = public.gst_current_business_id() OR id = auth.uid());

CREATE POLICY gst_profiles_insert_self ON public.gst_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY gst_profiles_insert_admin ON public.gst_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.gst_is_admin()
    AND business_id = public.gst_current_business_id()
    AND id <> auth.uid()
    AND COALESCE(role, 'cajero') <> 'admin'
  );

CREATE POLICY gst_profiles_update_admin ON public.gst_profiles
  FOR UPDATE TO authenticated
  USING (business_id = public.gst_current_business_id() AND public.gst_is_admin())
  WITH CHECK (
    business_id = public.gst_current_business_id()
    AND (role <> 'admin' OR id = auth.uid())
  );

CREATE POLICY gst_profiles_update_self ON public.gst_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND business_id = public.gst_current_business_id()
  );

-- ---------------------------------------------------------------------------
-- 6. Terminales: insert solo en la propia empresa (signup ya creó el perfil)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS gst_terminals_insert ON public.gst_terminals;

CREATE POLICY gst_terminals_insert ON public.gst_terminals
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.gst_current_business_id()
    AND (public.gst_is_admin() OR NOT EXISTS (
      SELECT 1 FROM public.gst_terminals t
      WHERE t.business_id = gst_terminals.business_id
    ))
  );

-- ---------------------------------------------------------------------------
-- 7. Migrar flags "used" embebidos → cierre_medios_used (datos existentes)
-- ---------------------------------------------------------------------------
INSERT INTO public.gst_configs (business_id, key, value)
SELECT
  c.business_id,
  'cierre_medios_used',
  (
    SELECT COALESCE(jsonb_object_agg(elem->>'id', true), '{}'::jsonb)
    FROM jsonb_array_elements(c.value) AS elem
    WHERE (elem->>'used')::boolean IS TRUE AND elem->>'id' IS NOT NULL
  )
FROM public.gst_configs c
WHERE c.key = 'cierre_conceptos'
  AND c.value IS NOT NULL
  AND jsonb_typeof(c.value) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM public.gst_configs u
    WHERE u.business_id = c.business_id AND u.key = 'cierre_medios_used'
  );

NOTIFY pgrst, 'reload schema';
