import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './resultadosQueries';
import { formatPeriodLabel } from './resultadosPeriod';

export const exportResultadosExcel = async ({
  resumen,
  ventasPorCaja,
  composicionVentas,
  movimientos,
  movimientosCc,
  comprasDetalle,
  range,
}) => {
  const workbook = new ExcelJS.Workbook();
  const period = formatPeriodLabel(range.desde, range.hasta);

  const wsResumen = workbook.addWorksheet('Resumen');
  wsResumen.addRow(['Resultados', period]);
  wsResumen.addRow(['Ventas totales', resumen.ventasTotal]);
  wsResumen.addRow(['Egresos totales', resumen.egresosTotal]);
  wsResumen.addRow(['Resultado operativo', resumen.resultadoOperativo]);
  wsResumen.addRow([]);
  wsResumen.addRow(['Composición ventas (medio)', 'Importe']);
  composicionVentas.medios.forEach((m) => {
    wsResumen.addRow([m.label, m.value]);
  });

  const wsVentas = workbook.addWorksheet('Ventas por caja');
  const header = ['Caja', 'Fecha', 'Total', ...ventasPorCaja.columns.map((c) => c.label)];
  wsVentas.addRow(header);
  ventasPorCaja.rows.forEach((r) => {
    wsVentas.addRow([
      r.turno,
      r.fechaLabel,
      r.total,
      ...ventasPorCaja.columns.map((c) => r.medios[c.id] || 0),
    ]);
  });
  wsVentas.addRow([
    'TOTAL',
    '',
    ventasPorCaja.totales.total,
    ...ventasPorCaja.columns.map((c) => ventasPorCaja.totales.medios[c.id] || 0),
  ]);

  const wsMov = workbook.addWorksheet('Movimientos');
  wsMov.addRow(['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Caja', 'Cliente', 'Ingreso', 'Egreso']);
  movimientos.forEach((m) => {
    wsMov.addRow([
      m.fechaLabel,
      m.tipo,
      m.concepto,
      m.categoria,
      m.caja,
      m.cliente,
      m.ingreso || 0,
      m.egreso || 0,
    ]);
  });

  const wsCc = workbook.addWorksheet('CC Clientes');
  wsCc.addRow(['Fecha', 'Cliente', 'Tipo', 'Concepto', 'Debe', 'Haber']);
  movimientosCc.forEach((m) => {
    wsCc.addRow([m.fechaLabel, m.cliente, m.tipo, m.concepto, m.debe, m.haber]);
  });

  const wsComp = workbook.addWorksheet('Compras');
  wsComp.addRow(['Fecha', 'Proveedor', 'Concepto', 'Categoría', 'Total', 'Factura', 'Caja']);
  comprasDetalle.forEach((c) => {
    wsComp.addRow([
      c.fechaLabel,
      c.proveedor,
      c.concepto,
      c.categoria,
      c.total,
      c.factura,
      c.caja,
    ]);
  });

  [wsResumen, wsVentas, wsMov, wsCc, wsComp].forEach((ws) => {
    ws.getRow(1).font = { bold: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resultados_${range.desde}_${range.hasta}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportResultadosPdf = ({
  resumen,
  ventasPorCaja,
  composicionVentas,
  movimientos,
  range,
  periodLabel,
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const period = periodLabel || formatPeriodLabel(range.desde, range.hasta);

  doc.setFontSize(16);
  doc.text('Resultados', 14, 18);
  doc.setFontSize(10);
  doc.text(`Período: ${period}`, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [['Concepto', 'Importe']],
    body: [
      ['Ventas totales', formatCurrency(resumen.ventasTotal)],
      ['Egresos totales', formatCurrency(resumen.egresosTotal)],
      ['Resultado operativo', formatCurrency(resumen.resultadoOperativo)],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
  });

  let startY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(11);
  doc.text('Composición de ventas por medio', 14, startY);

  autoTable(doc, {
    startY: startY + 4,
    head: [['Medio', 'Importe']],
    body: composicionVentas.medios.map((m) => [m.label, formatCurrency(m.value)]),
    theme: 'striped',
    styles: { fontSize: 8 },
  });

  startY = doc.lastAutoTable.finalY + 8;
  doc.text('Ventas por caja', 14, startY);

  const ventasHead = ['Caja', 'Fecha', 'Total', ...ventasPorCaja.columns.slice(0, 4).map((c) => c.label)];
  const ventasBody = [
    ...ventasPorCaja.rows.map((r) => [
      r.turno,
      r.fechaLabel,
      formatCurrency(r.total),
      ...ventasPorCaja.columns.slice(0, 4).map((c) => formatCurrency(r.medios[c.id] || 0)),
    ]),
    [
      'TOTAL',
      '',
      formatCurrency(ventasPorCaja.totales.total),
      ...ventasPorCaja.columns.slice(0, 4).map((c) =>
        formatCurrency(ventasPorCaja.totales.medios[c.id] || 0)
      ),
    ],
  ];

  autoTable(doc, {
    startY: startY + 4,
    head: [ventasHead],
    body: ventasBody,
    theme: 'striped',
    styles: { fontSize: 7 },
  });

  doc.addPage();
  doc.setFontSize(11);
  doc.text('Movimientos del período', 14, 16);

  autoTable(doc, {
    startY: 22,
    head: [['Fecha', 'Tipo', 'Concepto', 'Ingreso', 'Egreso']],
    body: movimientos.slice(0, 80).map((m) => [
      m.fechaLabel,
      m.tipo,
      String(m.concepto).slice(0, 40),
      m.ingreso ? formatCurrency(m.ingreso) : '',
      m.egreso ? formatCurrency(m.egreso) : '',
    ]),
    theme: 'striped',
    styles: { fontSize: 7 },
  });

  doc.save(`resultados_${range.desde}_${range.hasta}.pdf`);
};
