export const NOTIFICATION_EVENTS = {
  CIERRE_CAJA: 'cierre_caja',
};

export const NOTIFICATION_PROVIDERS = {
  PUSHOVER: 'pushover',
  WEBHOOK: 'webhook',
  INTERNAL_APP: 'internal_app',
};

export const emptyNotificationsConfig = () => ({
  version: 1,
  events: {
    [NOTIFICATION_EVENTS.CIERRE_CAJA]: true,
  },
  providers: {
    [NOTIFICATION_PROVIDERS.PUSHOVER]: {
      enabled: false,
      userKey: '',
    },
    [NOTIFICATION_PROVIDERS.WEBHOOK]: {
      enabled: false,
      url: '',
      secret: '',
    },
    [NOTIFICATION_PROVIDERS.INTERNAL_APP]: {
      enabled: false,
    },
  },
});

export const normalizeNotificationsConfig = (raw) => {
  const base = emptyNotificationsConfig();
  if (!raw || typeof raw !== 'object') return base;

  const events = { ...base.events, ...(raw.events || {}) };
  const providers = { ...base.providers };

  Object.keys(base.providers).forEach((providerId) => {
    const current = raw.providers?.[providerId];
    if (!current || typeof current !== 'object') return;
    providers[providerId] = {
      ...base.providers[providerId],
      ...current,
    };
  });

  return {
    version: 1,
    events,
    providers,
  };
};

const formatCurrencyForNotification = (amount) =>
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(amount) || 0);

const formatCierreFecha = (fechaLocal) => {
  if (!fechaLocal) return '';
  const parts = String(fechaLocal).split('-');
  if (parts.length !== 3) return fechaLocal;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

/** Arma título y cuerpo estilo sistema legacy (Pushover). */
export const buildCierreCajaNotification = ({
  fecha,
  turno,
  total,
  medioLines = [],
}) => {
  const totalFormato = formatCurrencyForNotification(total);
  const fechaLabel = formatCierreFecha(fecha);
  const turnoLabel = String(turno || '').trim() || 'Caja';

  const title = `$${totalFormato} - ${fechaLabel} - ${turnoLabel}`;
  const lines = (medioLines || [])
    .filter((line) => (parseFloat(line.amount) || 0) > 0)
    .map((line) => `${line.label}: $${formatCurrencyForNotification(line.amount)}`);

  const body = [
    'CIERRE REGISTRADO:',
    ...lines,
    '',
    `TOTAL FINAL: $${totalFormato}`,
  ].join('\n');

  return { title, body };
};

export const buildCierreMedioLines = (medioValues = {}, cierreConceptos = []) => {
  const active = (cierreConceptos || []).filter((m) => m?.enabled !== false && String(m?.label || '').trim());
  const lines = active.map((medio) => ({
    label: medio.label,
    amount: parseFloat(medioValues[medio.id] || 0) || 0,
  }));

  if (!lines.length) {
    return Object.entries(medioValues || {})
      .filter(([, amount]) => (parseFloat(amount) || 0) > 0)
      .map(([id, amount]) => ({ label: id, amount: parseFloat(amount) || 0 }));
  }

  return lines;
};

export const notificationsConfigToForm = (config) => {
  const normalized = normalizeNotificationsConfig(config);
  return {
    cierreCajaEnabled: normalized.events[NOTIFICATION_EVENTS.CIERRE_CAJA] === true,
    pushoverEnabled: normalized.providers.pushover.enabled === true,
    pushoverUserKey: normalized.providers.pushover.userKey || '',
    webhookEnabled: normalized.providers.webhook.enabled === true,
    webhookUrl: normalized.providers.webhook.url || '',
    webhookSecret: normalized.providers.webhook.secret || '',
    internalAppEnabled: normalized.providers.internal_app.enabled === true,
  };
};

export const notificationsFormToConfig = (form) => ({
  version: 1,
  events: {
    [NOTIFICATION_EVENTS.CIERRE_CAJA]: form.cierreCajaEnabled === true,
  },
  providers: {
    pushover: {
      enabled: form.pushoverEnabled === true,
      userKey: String(form.pushoverUserKey || '').trim(),
    },
    webhook: {
      enabled: form.webhookEnabled === true,
      url: String(form.webhookUrl || '').trim(),
      secret: String(form.webhookSecret || '').trim(),
    },
    internal_app: {
      enabled: form.internalAppEnabled === true,
    },
  },
});
