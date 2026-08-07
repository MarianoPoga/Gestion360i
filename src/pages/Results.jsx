import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MODULE_LABELS } from '../moduleLabels';
import { exportResultadosExcel, exportResultadosPdf } from '../resultados/resultadosExport';
import {
  formatCurrency,
  pctChange,
} from '../resultados/resultadosQueries';
import { PERIOD_PRESETS, RESULTADOS_TABS } from '../resultados/resultadosTypes';
import { useResultados } from '../resultados/useResultados';

const CHART_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#64748b'];

const KpiCard = ({ label, value, previous, accent }) => {
  const delta = pctChange(value, previous);
  const up = delta >= 0;
  return (
    <div className="card border-0 shadow-sm p-3 h-100" style={{ borderRadius: '12px' }}>
      <div className="text-muted small text-uppercase mb-1">{label}</div>
      <div className="fs-4 fw-bold" style={{ color: accent }}>{formatCurrency(value)}</div>
      <div className="small mt-1" style={{ color: up ? '#16a34a' : '#dc2626' }}>
        <i className={`bi bi-arrow-${up ? 'up' : 'down'}-short`}></i>
        {Math.abs(delta).toFixed(1)}% vs período anterior
      </div>
    </div>
  );
};

const SortTh = ({ field, label, sortField, sortAsc, onSort, align = 'left' }) => (
  <th
    style={{ cursor: 'pointer', whiteSpace: 'nowrap', textAlign: align }}
    onClick={() => onSort(field)}
  >
    {label}
    {sortField === field && (sortAsc ? ' ▴' : ' ▾')}
  </th>
);

function Results() {
  const {
    preset,
    setPreset,
    customDesde,
    setCustomDesde,
    customHasta,
    setCustomHasta,
    turnoFilter,
    setTurnoFilter,
    activeTab,
    setActiveTab,
    searchText,
    setSearchText,
    sortField,
    sortAsc,
    toggleSort,
    loading,
    error,
    reload,
    range,
    periodLabel,
    computed,
    filteredMovimientos,
  } = useResultados();

  const [exporting, setExporting] = useState(false);

  const handleExportExcel = async () => {
    if (!computed) return;
    setExporting(true);
    try {
      await exportResultadosExcel({
        resumen: computed.resumen,
        ventasPorCaja: computed.ventasPorCaja,
        composicionVentas: computed.composicionVentas,
        movimientos: computed.movimientos,
        movimientosCc: computed.movimientosCc,
        comprasDetalle: computed.comprasDetalle,
        range,
      });
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = () => {
    if (!computed) return;
    setExporting(true);
    try {
      exportResultadosPdf({
        resumen: computed.resumen,
        ventasPorCaja: computed.ventasPorCaja,
        composicionVentas: computed.composicionVentas,
        movimientos: computed.movimientos,
        range,
        periodLabel,
      });
    } finally {
      setExporting(false);
    }
  };

  const { resumen, ventasPorCaja, composicionVentas, egresosPorCategoria, ingresosEgresosDiarios } =
    computed || {};

  return (
    <div className="page-container p-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h2 className="page-title mb-1">
            <i className="bi bi-graph-up text-primary me-2"></i>
            {MODULE_LABELS.resultados}
          </h2>
          <div className="text-muted small">{periodLabel}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-success btn-sm" disabled={loading || exporting || !computed} onClick={handleExportExcel}>
            <i className="bi bi-file-earmark-excel me-1"></i> Excel
          </button>
          <button type="button" className="btn btn-outline-danger btn-sm" disabled={loading || exporting || !computed} onClick={handleExportPdf}>
            <i className="bi bi-file-earmark-pdf me-1"></i> PDF
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading} onClick={reload}>
            <i className="bi bi-arrow-clockwise"></i>
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card border-0 shadow-sm p-3 mb-3" style={{ borderRadius: '12px' }}>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          {[
            [PERIOD_PRESETS.TODAY, 'Hoy'],
            [PERIOD_PRESETS.WEEK, 'Semana'],
            [PERIOD_PRESETS.MONTH, 'Mes'],
            [PERIOD_PRESETS.PREV_MONTH, 'Mes ant.'],
            [PERIOD_PRESETS.CUSTOM, 'Custom'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-sm ${preset === id ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setPreset(id)}
            >
              {label}
            </button>
          ))}
          <select
            className="form-select form-select-sm"
            style={{ width: 'auto', minWidth: '140px' }}
            value={turnoFilter}
            onChange={(e) => setTurnoFilter(e.target.value)}
          >
            <option value="">Todas las cajas</option>
            {(computed?.turnos || []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {preset === PERIOD_PRESETS.CUSTOM && (
          <div className="d-flex flex-wrap gap-2 mt-2">
            <input type="date" className="form-control form-control-sm" style={{ width: 'auto' }} value={customDesde} onChange={(e) => setCustomDesde(e.target.value)} />
            <input type="date" className="form-control form-control-sm" style={{ width: 'auto' }} value={customHasta} onChange={(e) => setCustomHasta(e.target.value)} />
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {loading && (
        <div className="text-center py-5 text-muted">
          <div className="spinner-border text-primary mb-2" role="status"></div>
          <div>Cargando resultados…</div>
        </div>
      )}

      {!loading && computed && (
        <>
          {/* KPIs */}
          <div className="row g-3 mb-3">
            <div className="col-md-4">
              <KpiCard label="Ventas totales" value={resumen.ventasTotal} previous={resumen.ventasAnterior} accent="#16a34a" />
            </div>
            <div className="col-md-4">
              <KpiCard label="Egresos (compras)" value={resumen.egresosTotal} previous={resumen.egresosAnterior} accent="#dc2626" />
            </div>
            <div className="col-md-4">
              <KpiCard label="Resultado operativo" value={resumen.resultadoOperativo} previous={resumen.resultadoAnterior} accent="#2563eb" />
            </div>
          </div>

          {/* Ventas por caja */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white border-0 pt-3 pb-0">
              <h6 className="mb-0 fw-bold">Ventas por caja</h6>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>Caja</th>
                      <th>Fecha</th>
                      <th className="text-end">Total</th>
                      {ventasPorCaja.columns.map((c) => (
                        <th key={c.id} className="text-end">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ventasPorCaja.rows.length === 0 && (
                      <tr><td colSpan={3 + ventasPorCaja.columns.length} className="text-center text-muted py-4">Sin cierres en el período</td></tr>
                    )}
                    {ventasPorCaja.rows.map((r) => (
                      <tr key={r.id}>
                        <td><span className="badge bg-secondary">{r.turno}</span></td>
                        <td>{r.fechaLabel}</td>
                        <td className="text-end fw-semibold">{formatCurrency(r.total)}</td>
                        {ventasPorCaja.columns.map((c) => (
                          <td key={c.id} className="text-end text-muted">
                            {r.medios[c.id] > 0 ? formatCurrency(r.medios[c.id]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {ventasPorCaja.rows.length > 0 && (
                      <tr className="table-light fw-bold">
                        <td>TOTAL</td>
                        <td></td>
                        <td className="text-end">{formatCurrency(ventasPorCaja.totales.total)}</td>
                        {ventasPorCaja.columns.map((c) => (
                          <td key={c.id} className="text-end">
                            {formatCurrency(ventasPorCaja.totales.medios[c.id] || 0)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Gráficos */}
          <div className="row g-3 mb-3">
            <div className="col-lg-7">
              <div className="card border-0 shadow-sm p-3 h-100" style={{ borderRadius: '12px' }}>
                <h6 className="fw-bold mb-3">Ingresos vs egresos por día</h6>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={ingresosEgresosDiarios}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Legend />
                    <Bar dataKey="ingresos" name="Ventas" fill="#16a34a" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="egresos" name="Compras" fill="#dc2626" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="col-lg-5">
              <div className="card border-0 shadow-sm p-3 h-100" style={{ borderRadius: '12px' }}>
                <h6 className="fw-bold mb-3">Composición de ventas</h6>
                {composicionVentas.medios.length === 0 ? (
                  <div className="text-muted text-center py-5">Sin ventas en el período</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={composicionVentas.medios}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ label, percent }) => `${label} ${(percent * 100).toFixed(0)}%`}
                      >
                        {composicionVentas.medios.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {egresosPorCategoria.length > 0 && (
            <div className="card border-0 shadow-sm p-3 mb-3" style={{ borderRadius: '12px' }}>
              <h6 className="fw-bold mb-3">Egresos por categoría (compras)</h6>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={egresosPorCategoria}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {egresosPorCategoria.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabs detalle */}
          <div className="card border-0 shadow-sm" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white border-bottom-0 pt-3">
              <ul className="nav nav-tabs card-header-tabs">
                {[
                  [RESULTADOS_TABS.MOVIMIENTOS, 'Movimientos'],
                  [RESULTADOS_TABS.VENTAS, 'Ventas / cierres'],
                  [RESULTADOS_TABS.COMPRAS, 'Compras'],
                  [RESULTADOS_TABS.CC, 'CC clientes'],
                ].map(([id, label]) => (
                  <li className="nav-item" key={id}>
                    <button
                      type="button"
                      className={`nav-link ${activeTab === id ? 'active' : ''}`}
                      onClick={() => setActiveTab(id)}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-body">
              {activeTab === RESULTADOS_TABS.MOVIMIENTOS && (
                <>
                  <input
                    type="search"
                    className="form-control form-control-sm mb-3"
                    placeholder="Buscar concepto, cliente, categoría…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    style={{ maxWidth: '320px' }}
                  />
                  <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <SortTh field="fecha" label="Fecha" sortField={sortField} sortAsc={sortAsc} onSort={toggleSort} />
                          <th>Tipo</th>
                          <SortTh field="concepto" label="Concepto" sortField={sortField} sortAsc={sortAsc} onSort={toggleSort} />
                          <th>Categoría</th>
                          <th>Caja</th>
                          <th>Cliente</th>
                          <SortTh field="ingreso" label="Ingreso" sortField={sortField} sortAsc={sortAsc} onSort={toggleSort} align="right" />
                          <SortTh field="egreso" label="Egreso" sortField={sortField} sortAsc={sortAsc} onSort={toggleSort} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMovimientos.length === 0 && (
                          <tr><td colSpan={8} className="text-center text-muted py-4">Sin movimientos</td></tr>
                        )}
                        {filteredMovimientos.map((m) => (
                          <tr key={m.id}>
                            <td>{m.fechaLabel}</td>
                            <td><span className="badge bg-light text-dark border">{m.tipo}</span></td>
                            <td>{m.concepto}</td>
                            <td className="text-muted small">{m.categoria}</td>
                            <td>{m.caja || '—'}</td>
                            <td className="small">{m.cliente || '—'}</td>
                            <td className="text-end text-success">{m.ingreso ? formatCurrency(m.ingreso) : ''}</td>
                            <td className="text-end text-danger">{m.egreso ? formatCurrency(m.egreso) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {activeTab === RESULTADOS_TABS.VENTAS && (
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Fecha</th>
                        <th>Caja</th>
                        <th className="text-end">Total</th>
                        <th className="text-end">Compras turno</th>
                        <th className="text-end">Adelantos</th>
                        {ventasPorCaja.columns.map((c) => (
                          <th key={c.id} className="text-end">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ventasPorCaja.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.fechaLabel}</td>
                          <td>{r.turno}</td>
                          <td className="text-end fw-semibold">{formatCurrency(r.total)}</td>
                          <td className="text-end">{formatCurrency(r.comprasTurno)}</td>
                          <td className="text-end">{formatCurrency(r.adelantos)}</td>
                          {ventasPorCaja.columns.map((c) => (
                            <td key={c.id} className="text-end">{formatCurrency(r.medios[c.id] || 0)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === RESULTADOS_TABS.COMPRAS && (
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Fecha</th>
                        <th>Proveedor</th>
                        <th>Concepto</th>
                        <th>Categoría</th>
                        <th className="text-end">Total</th>
                        <th>Factura</th>
                        <th>Caja</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computed.comprasDetalle.map((c) => (
                        <tr key={c.id}>
                          <td>{c.fechaLabel}</td>
                          <td>{c.proveedor}</td>
                          <td>{c.concepto}</td>
                          <td>{c.categoria}</td>
                          <td className="text-end">{formatCurrency(c.total)}</td>
                          <td>{c.factura}</td>
                          <td>{c.caja || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === RESULTADOS_TABS.CC && (
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Fecha</th>
                        <th>Cliente</th>
                        <th>Tipo</th>
                        <th>Concepto</th>
                        <th className="text-end">Debe</th>
                        <th className="text-end">Haber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computed.movimientosCc.length === 0 && (
                        <tr><td colSpan={6} className="text-center text-muted py-4">Sin movimientos CC en el período</td></tr>
                      )}
                      {computed.movimientosCc.map((m) => (
                        <tr key={m.id}>
                          <td>{m.fechaLabel}</td>
                          <td>{m.cliente}</td>
                          <td><span className="badge bg-light text-dark border">{m.tipo}</span></td>
                          <td className="small">{m.concepto}</td>
                          <td className="text-end text-danger">{m.debe ? formatCurrency(m.debe) : ''}</td>
                          <td className="text-end text-success">{m.haber ? formatCurrency(m.haber) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Results;
