-- migrate_gst_profiles_employee.sql
-- Vincular gst_profiles ↔ gst_personal y permitir cajas asignadas.
-- Ejecutar en Supabase → SQL Editor (una vez).

ALTER TABLE public.gst_profiles
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.gst_personal(id) ON DELETE SET NULL;

ALTER TABLE public.gst_profiles
  ADD COLUMN IF NOT EXISTS assigned_cajas jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS gst_profiles_employee_per_business
  ON public.gst_profiles (business_id, employee_id)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.gst_profiles.employee_id IS 'Empleado (gst_personal) vinculado a este login';
COMMENT ON COLUMN public.gst_profiles.assigned_cajas IS 'Turnos/cajas asignados al usuario';

-- Crear perfil de empleado como admin (evita problemas de RLS en el cliente)
CREATE OR REPLACE FUNCTION public.gst_create_employee_profile(
  p_user_id uuid,
  p_employee_id uuid,
  p_full_name text,
  p_role text DEFAULT 'cajero',
  p_assigned_cajas jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF NOT public.gst_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede crear accesos de empleados';
  END IF;

  v_business_id := public.gst_current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Empresa no configurada para el usuario actual';
  END IF;

  IF COALESCE(p_role, 'cajero') = 'admin' THEN
    RAISE EXCEPTION 'No se puede asignar rol administrador';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No se puede crear un acceso para el propio administrador';
  END IF;

  INSERT INTO public.gst_profiles (
    id,
    business_id,
    employee_id,
    full_name,
    role,
    assigned_cajas
  )
  VALUES (
    p_user_id,
    v_business_id,
    p_employee_id,
    p_full_name,
    COALESCE(p_role, 'cajero'),
    COALESCE(p_assigned_cajas, '[]'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE SET
    business_id = EXCLUDED.business_id,
    employee_id = EXCLUDED.employee_id,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    assigned_cajas = EXCLUDED.assigned_cajas;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gst_create_employee_profile(uuid, uuid, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
