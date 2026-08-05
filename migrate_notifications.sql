-- Outbox de notificaciones para app propia / integraciones futuras.
-- Ejecutar en Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.gst_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.gst_businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_gst_notification_outbox_business_created
  ON public.gst_notification_outbox (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gst_notification_outbox_status
  ON public.gst_notification_outbox (status, created_at DESC);

ALTER TABLE public.gst_notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gst_notification_outbox_select ON public.gst_notification_outbox;
CREATE POLICY gst_notification_outbox_select ON public.gst_notification_outbox
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS gst_notification_outbox_update ON public.gst_notification_outbox;
CREATE POLICY gst_notification_outbox_update ON public.gst_notification_outbox
  FOR UPDATE USING (
    business_id IN (
      SELECT business_id FROM public.gst_profiles WHERE id = auth.uid()
    )
  );

COMMENT ON TABLE public.gst_notification_outbox IS
  'Cola de notificaciones para app móvil propia o integraciones. Pushover/webhook se envían desde Edge Function.';
