import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTIFICATIONS_CONFIG_KEY = 'notifications';

type ProviderResult = { provider: string; ok: boolean; error?: string };

const emptyNotificationsConfig = () => ({
  version: 1,
  events: { cierre_caja: true },
  providers: {
    pushover: { enabled: false, userKey: '' },
    webhook: { enabled: false, url: '', secret: '' },
    internal_app: { enabled: false },
  },
});

const normalizeNotificationsConfig = (raw: unknown) => {
  const base = emptyNotificationsConfig();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Record<string, unknown>;
  const events = { ...base.events, ...((input.events as Record<string, boolean>) || {}) };
  const providers = { ...base.providers };
  const rawProviders = (input.providers as Record<string, Record<string, unknown>>) || {};
  for (const key of Object.keys(base.providers)) {
    if (rawProviders[key]) {
      providers[key as keyof typeof providers] = {
        ...base.providers[key as keyof typeof providers],
        ...rawProviders[key],
      } as never;
    }
  }
  return { version: 1, events, providers };
};

const buildEnvelope = (
  event: string,
  businessId: string,
  title: string,
  message: string,
  data: Record<string, unknown>,
) => ({
  version: 1,
  event,
  businessId,
  title,
  message,
  data,
  occurredAt: new Date().toISOString(),
});

async function sendPushover(
  config: { userKey?: string },
  title: string,
  message: string,
): Promise<ProviderResult> {
  const token = Deno.env.get('PUSHOVER_APP_TOKEN') || '';
  const userKey = String(config.userKey || '').trim();
  if (!token) {
    return { provider: 'pushover', ok: false, error: 'PUSHOVER_APP_TOKEN no configurado en Supabase' };
  }
  if (!userKey) {
    return { provider: 'pushover', ok: false, error: 'User Key de Pushover no configurado' };
  }

  const response = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      user: userKey,
      title,
      message,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { provider: 'pushover', ok: false, error: text || `HTTP ${response.status}` };
  }

  return { provider: 'pushover', ok: true };
}

async function sendWebhook(
  config: { url?: string; secret?: string },
  envelope: ReturnType<typeof buildEnvelope>,
): Promise<ProviderResult> {
  const url = String(config.url || '').trim();
  if (!url) {
    return { provider: 'webhook', ok: false, error: 'URL de webhook vacía' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Gestion360i-Notifications/1.0',
  };
  const secret = String(config.secret || '').trim();
  if (secret) headers['X-Gestion360i-Secret'] = secret;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    const text = await response.text();
    return { provider: 'webhook', ok: false, error: text || `HTTP ${response.status}` };
  }

  return { provider: 'webhook', ok: true };
}

async function persistOutbox(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  envelope: ReturnType<typeof buildEnvelope>,
): Promise<ProviderResult> {
  const { error } = await admin.from('gst_notification_outbox').insert([{
    business_id: businessId,
    event_type: envelope.event,
    title: envelope.title,
    message: envelope.message,
    payload: envelope,
    status: 'pending',
  }]);

  if (error) {
    if (String(error.message || '').includes('gst_notification_outbox')) {
      return { provider: 'internal_app', ok: false, error: 'Tabla gst_notification_outbox no existe (ejecutá migrate_notifications.sql)' };
    }
    return { provider: 'internal_app', ok: false, error: error.message };
  }

  return { provider: 'internal_app', ok: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Supabase no configurado en la Edge Function');
    }

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error: profileError } = await admin
      .from('gst_profiles')
      .select('business_id')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || !profile?.business_id) {
      throw new Error('No se pudo resolver la empresa del usuario');
    }

    const businessId = profile.business_id as string;
    const body = await req.json();
    const event = String(body?.event || '').trim();
    const payload = (body?.payload && typeof body.payload === 'object') ? body.payload : {};
    const title = String(body?.title || payload?.title || '').trim();
    const message = String(body?.message || payload?.message || '').trim();

    if (!event || !title || !message) {
      throw new Error('event, title y message son obligatorios');
    }

    const { data: configRow } = await admin
      .from('gst_configs')
      .select('value, config_value')
      .eq('business_id', businessId)
      .eq('key', NOTIFICATIONS_CONFIG_KEY)
      .maybeSingle();

    const rawConfig = configRow?.value ?? configRow?.config_value ?? null;
    const notificationsConfig = normalizeNotificationsConfig(rawConfig);

    if (notificationsConfig.events[event as keyof typeof notificationsConfig.events] !== true) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'event_disabled' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const envelope = buildEnvelope(event, businessId, title, message, payload);
    const results: ProviderResult[] = [];

    if (notificationsConfig.providers.pushover.enabled) {
      results.push(await sendPushover(notificationsConfig.providers.pushover, title, message));
    }

    if (notificationsConfig.providers.webhook.enabled) {
      results.push(await sendWebhook(notificationsConfig.providers.webhook, envelope));
    }

    if (notificationsConfig.providers.internal_app.enabled) {
      results.push(await persistOutbox(admin, businessId, envelope));
    }

    const delivered = results.some((r) => r.ok);
    if (!results.length) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: 'no_providers_enabled',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: delivered,
      results,
    }), {
      status: delivered ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[send-notification]', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
