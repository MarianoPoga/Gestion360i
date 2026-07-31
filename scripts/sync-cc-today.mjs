#!/usr/bin/env node
/**
 * Sincroniza CC para pedidos finalizados HOY (Argentina).
 *
 * Uso:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-cc-today.mjs
 *   # o con anon key + business_id si no tenés service role:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... GST_BUSINESS_ID=... node scripts/sync-cc-today.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const businessIdFilter = process.env.GST_BUSINESS_ID || null;

if (!url || !key) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o VITE_SUPABASE_ANON_KEY).');
  process.exit(1);
}

const supabase = createClient(url, key);

const hasPaymentMedio = (medio) => !!medio && String(medio).trim() !== '';
const isMedioCtaCte = (medio) => {
  const n = String(medio || '').trim().toLowerCase();
  return n === 'cta cte' || n === 'cuenta corriente (deuda)' || n === 'cuenta corriente';
};
const getOrderRef = (id) => String(id).substring(0, 6);
const isFinalizado = (e) => ['finalizado', 'cobrado'].includes(String(e || '').toLowerCase());

const getArgentinaDayBounds = () => {
  const dayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const startUtc = new Date(`${dayStr}T03:00:00.000Z`);
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);
  return { dayStr, startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
};

const inBounds = (order, startIso, endIso) => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return [order.fecha, order.created_at]
    .filter(Boolean)
    .some((ts) => {
      const t = new Date(ts).getTime();
      return t >= start && t < end;
    });
};

const buildFlags = (movs, ref) => ({
  hasPedido: movs.some((m) => /^Pedido #/.test(m.concepto) && m.concepto.includes(`#${ref}`)),
  hasCredit: movs.some((m) => m.concepto.includes(`Crédito Pedido #${ref}`) || m.concepto.includes(`Anticipo Pedido #${ref}`)),
  hasCobro: movs.some((m) => m.concepto.includes(`Cobro Pedido #${ref}`) && !m.concepto.includes('Reversión')),
});

const buildInserts = (order, movs) => {
  const ref = getOrderRef(order.id);
  const total = parseFloat(order.total || 0);
  const medio = order.medio_pago || '';
  const flags = buildFlags(movs, ref);
  const inserts = [];
  const fecha = order.fecha || order.created_at || new Date().toISOString();

  if (!flags.hasPedido) {
    inserts.push({ concepto: `Pedido #${ref}`, debe: total, haber: 0, fecha });
  }
  if (!flags.hasCredit && hasPaymentMedio(medio) && !isMedioCtaCte(medio) && !flags.hasCobro) {
    inserts.push({ concepto: `Cobro Pedido #${ref} (${medio})`, debe: 0, haber: total, fecha });
  }
  return inserts;
};

const { dayStr, startIso, endIso } = getArgentinaDayBounds();
console.log(`Sincronizando pedidos finalizados del ${dayStr} (Argentina)...`);

let ordersQuery = supabase.from('gst_pedidos').select('*');
if (businessIdFilter) ordersQuery = ordersQuery.eq('business_id', businessIdFilter);
const { data: orders, error: ordersErr } = await ordersQuery;
if (ordersErr) throw ordersErr;

const todayFinalized = (orders || []).filter(
  (o) => isFinalizado(o.estado) && inBounds(o, startIso, endIso)
);
console.log(`Pedidos finalizados hoy: ${todayFinalized.length}`);

await supabase.from('gst_cliente_movimientos').delete().ilike('concepto', 'Aplicación anticipo Pedido #%');

let fixed = 0;
for (const order of todayFinalized) {
  const ref = getOrderRef(order.id);
  const { data: movs } = await supabase
    .from('gst_cliente_movimientos')
    .select('concepto')
    .eq('business_id', order.business_id)
    .eq('cliente_id', order.cliente_id)
    .ilike('concepto', `%#${ref}%`);

  const inserts = buildInserts(order, movs || []);
  if (!inserts.length) continue;

  for (const mov of inserts) {
    const { error } = await supabase.from('gst_cliente_movimientos').insert([{
      business_id: order.business_id,
      cliente_id: order.cliente_id,
      concepto: mov.concepto,
      debe: mov.debe,
      haber: mov.haber,
      fecha: mov.fecha,
    }]);
    if (error) throw error;
    console.log(`  + ${order.cliente_id} | ${mov.concepto} | debe=${mov.debe} haber=${mov.haber}`);
  }
  fixed += 1;
}

const clientIds = [...new Set(todayFinalized.map((o) => o.cliente_id))];
for (const clienteId of clientIds) {
  const order = todayFinalized.find((o) => o.cliente_id === clienteId);
  const { data: allMovs } = await supabase
    .from('gst_cliente_movimientos')
    .select('debe, haber')
    .eq('business_id', order.business_id)
    .eq('cliente_id', clienteId);

  const saldo = (allMovs || []).reduce((s, m) => s + parseFloat(m.debe || 0) - parseFloat(m.haber || 0), 0);
  await supabase
    .from('gst_clientes')
    .update({ saldo: Math.round((saldo + Number.EPSILON) * 100) / 100 })
    .eq('id', clienteId)
    .eq('business_id', order.business_id);
}

console.log(`Listo. Pedidos corregidos: ${fixed}/${todayFinalized.length}`);
