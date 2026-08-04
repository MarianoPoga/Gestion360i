#!/usr/bin/env node
/**
 * Audita cuenta corriente de todos los clientes.
 *
 * Uso:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-cc-all-clients.mjs
 *   # o con anon key:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... GST_BUSINESS_ID=... node scripts/audit-cc-all-clients.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const businessIdFilter = process.env.GST_BUSINESS_ID || null;

if (!url || !key || key === 'tu_anon_key_aqui') {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o VITE_SUPABASE_ANON_KEY).');
  process.exit(1);
}

const supabase = createClient(url, key);

const roundMoney = (value) =>
  Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;

const getOrderRef = (id) => String(id).substring(0, 6);

const isFinalizado = (e) => ['finalizado', 'cobrado'].includes(String(e || '').toLowerCase());
const isCancelled = (e) => ['cancelado', 'cancelada', 'cancelled'].includes(String(e || '').toLowerCase());
const isPedidoCharge = (m) => /^Pedido #/.test(String(m.concepto || '')) && parseFloat(m.debe || 0) > 0;
const isUnlinkedPayment = (c) => String(c || '').startsWith('Pago cuenta corriente');

const dedupePedidoCharges = (movs) => {
  let seen = false;
  return movs.filter((m) => {
    if (!isPedidoCharge(m)) return true;
    if (seen) return false;
    seen = true;
    return true;
  });
};

const netFromMovements = (movs, dedupe = false) => {
  const list = dedupe ? dedupePedidoCharges(movs) : movs;
  return roundMoney(list.reduce((s, m) => s + parseFloat(m.debe || 0) - parseFloat(m.haber || 0), 0));
};

const fetchAll = async (table, select, applyFilter) => {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (applyFilter) q = applyFilter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
};

console.log('Auditando cuenta corriente...\n');

const clientsQuery = (q) => (businessIdFilter ? q.eq('business_id', businessIdFilter) : q);
const clients = await fetchAll('gst_clientes', 'id, nombre, saldo, business_id', clientsQuery);
const movements = await fetchAll(
  'gst_cliente_movimientos',
  'id, cliente_id, concepto, debe, haber, fecha, business_id',
  clientsQuery,
);
const orders = await fetchAll(
  'gst_pedidos',
  'id, cliente_id, total, estado, medio_pago, fecha, created_at, business_id',
  clientsQuery,
);

const movsByClient = new Map();
for (const m of movements) {
  if (!movsByClient.has(m.cliente_id)) movsByClient.set(m.cliente_id, []);
  movsByClient.get(m.cliente_id).push(m);
}

const ordersByClient = new Map();
for (const o of orders) {
  if (!ordersByClient.has(o.cliente_id)) ordersByClient.set(o.cliente_id, []);
  ordersByClient.get(o.cliente_id).push(o);
}

const issues = [];
let okCount = 0;

for (const client of clients) {
  const clientMovs = movsByClient.get(client.id) || [];
  const clientOrders = ordersByClient.get(client.id) || [];
  const clientIssues = [];

  const storedSaldo = roundMoney(client.saldo);
  const rawNet = netFromMovements(clientMovs, false);
  const dedupedNet = netFromMovements(clientMovs, true);
  const expectedSaldo = dedupedNet;

  if (Math.abs(storedSaldo - expectedSaldo) > 0.02) {
    clientIssues.push({
      type: 'saldo_mismatch',
      stored: storedSaldo,
      computed: expectedSaldo,
      rawNet,
    });
  }

  if (Math.abs(rawNet - dedupedNet) > 0.02) {
    clientIssues.push({
      type: 'duplicate_pedido_charges',
      rawNet,
      dedupedNet,
      diff: roundMoney(rawNet - dedupedNet),
    });
  }

  const byRef = new Map();
  for (const m of clientMovs) {
    const match = String(m.concepto || '').match(/#([A-Za-z0-9_]+)/);
    if (!match) continue;
    const ref = match[1];
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(m);
  }

  for (const [ref, refMovs] of byRef) {
    const pedidoCharges = refMovs.filter(isPedidoCharge);
    if (pedidoCharges.length > 1) {
      clientIssues.push({
        type: 'duplicate_pedido_per_ref',
        orderRef: ref,
        count: pedidoCharges.length,
        amounts: pedidoCharges.map((m) => roundMoney(m.debe)),
      });
    }
  }

  const finalizedOrders = clientOrders.filter((o) => isFinalizado(o.estado) && !isCancelled(o.estado));
  for (const order of finalizedOrders) {
    const ref = getOrderRef(order.id);
    const refMovs = byRef.get(ref) || [];
    const deduped = dedupePedidoCharges(refMovs);
    const hasPedido = deduped.some(isPedidoCharge);
    const hasCobro = deduped.some((m) => m.concepto.includes(`Cobro Pedido #${ref}`) && !m.concepto.includes('Reversión'));
    const pending = Math.max(0, netFromMovements(deduped, true));

    if (!hasPedido && parseFloat(order.total || 0) > 0) {
      clientIssues.push({
        type: 'missing_pedido_movement',
        orderRef: ref,
        orderId: order.id,
        total: roundMoney(order.total),
      });
    }

    const medio = String(order.medio_pago || '').toLowerCase();
    const isCtaCte = medio.includes('cta cte') || medio.includes('cuenta corriente');
    if (hasPedido && !isCtaCte && !hasCobro && pending > 0.02) {
      clientIssues.push({
        type: 'missing_cobro_on_paid_order',
        orderRef: ref,
        medio: order.medio_pago,
        pending,
      });
    }
  }

  const unlinked = clientMovs.filter((m) => isUnlinkedPayment(m.concepto));
  if (unlinked.length > 0) {
    const totalUnlinked = roundMoney(unlinked.reduce((s, m) => s + parseFloat(m.haber || 0), 0));
    clientIssues.push({
      type: 'legacy_unlinked_payments',
      count: unlinked.length,
      totalHaber: totalUnlinked,
    });
  }

  if (clientIssues.length === 0) {
    okCount += 1;
  } else {
    issues.push({ clientId: client.id, nombre: client.nombre, saldo: storedSaldo, issues: clientIssues });
  }
}

console.log(`Clientes auditados: ${clients.length}`);
console.log(`OK: ${okCount}`);
console.log(`Con observaciones: ${issues.length}\n`);

if (issues.length === 0) {
  console.log('Todo consistente.');
  process.exit(0);
}

for (const row of issues) {
  console.log(`— ${row.nombre} (saldo $${row.saldo.toLocaleString('es-AR')})`);
  for (const issue of row.issues) {
    switch (issue.type) {
      case 'saldo_mismatch':
        console.log(`  • Saldo distinto: guardado $${issue.stored} vs calculado $${issue.computed} (raw $${issue.rawNet})`);
        break;
      case 'duplicate_pedido_charges':
        console.log(`  • Deuda inflada por Pedido # duplicados: +$${issue.diff} (raw $${issue.rawNet} → $${issue.dedupedNet})`);
        break;
      case 'duplicate_pedido_per_ref':
        console.log(`  • Compra #${issue.orderRef}: ${issue.count} movimientos Pedido # (${issue.amounts.join(', ')})`);
        break;
      case 'missing_pedido_movement':
        console.log(`  • Falta movimiento Pedido #${issue.orderRef} (pedido ${issue.orderId}, $${issue.total})`);
        break;
      case 'missing_cobro_on_paid_order':
        console.log(`  • Compra #${issue.orderRef} pagada (${issue.medio}) sin Cobro Pedido # (pendiente $${issue.pending})`);
        break;
      case 'legacy_unlinked_payments':
        console.log(`  • ${issue.count} pago(s) legacy sin compra (${issue.totalHaber} haber total)`);
        break;
      default:
        console.log(`  • ${issue.type}`, issue);
    }
  }
  console.log('');
}

process.exit(issues.some((r) => r.issues.some((i) => i.type === 'saldo_mismatch' || i.type === 'duplicate_pedido_per_ref')) ? 1 : 0);
