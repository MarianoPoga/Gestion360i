import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../supabaseClient';
import { MODULE_LABELS, DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels';
import PeriodicPayments from './PeriodicPayments';

function PagoImpuestos({ navigate, navState, accentColor }) {
  const [section, setSection] = useState('register');

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME,
    allow_pagos: true,
  });

  const [selectedPeriodicId, setSelectedPeriodicId] = useState('');
  const [pagoOrigen, setPagoOrigen] = useState('');
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoObservacion, setPagoObservacion] = useState('');
  const [pagoFecha, setPagoFecha] = useState(new Date().toISOString().substring(0, 10));

  const [periodicPayments, setPeriodicPayments] = useState([]);
  const [registeredPayments, setRegisteredPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [shiftsAvailableState, setShiftsAvailableState] = useState([]);
  const [paymentsSort, setPaymentsSort] = useState({ column: 'fecha', direction: 'desc' });

  const pagoMontoInputRef = useRef(null);
  const accent = accentColor || '#0ea5e9';

  const noInvoiceOptions = useMemo(
    () =>
      periodicPayments.filter(
        (p) => String(p.tipo_factura || '').toLowerCase() === 'sin factura' && p.activo !== false
      ),
    [periodicPayments]
  );

  const applyPeriodicPrefill = (payment) => {
    if (!payment) return;
    const { id, monto, fecha_sugerida } = payment;
    setSelectedPeriodicId(id || '');
    setPagoMonto(monto != null ? String(monto) : '');
    if (payment.observaciones) setPagoObservacion(payment.observaciones);
    if (fecha_sugerida) setPagoFecha(fecha_sugerida.substring(0, 10));
    setSection('register');
    setTimeout(() => pagoMontoInputRef.current?.focus(), 100);
  };

  useEffect(() => {
    const rawConfig = localStorage.getItem('adelantos_config');
    let loadedConfig = { cajas_posibles: [] };
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        loadedConfig = {
          cajas_posibles: parsed.cajas_posibles || [],
        };
      } catch (e) {
        console.error('Error parsing settings:', e);
      }
    }

    const setupShifts = async () => {
      const shifts = loadedConfig.cajas_posibles.length > 0 ? loadedConfig.cajas_posibles : await db.getCierreTurnoNames();
      setShiftsAvailableState(shifts || []);
      const loadedRendConfig = JSON.parse(
        localStorage.getItem('rendiciones_config') ||
          `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}","allow_pagos":true}`
      );
      setRendConfig(loadedRendConfig);

      if (shifts && shifts.length > 0) {
        setPagoOrigen(shifts[0]);
      } else {
        setPagoOrigen(loadedRendConfig.allow_pagos ? 'Rendición' : '');
      }
    };

    setupShifts();
    loadData();
  }, []);

  useEffect(() => {
    if (navState?.openSection === 'calendar') setSection('calendar');
    if (navState?.openSection === 'list') setSection('list');
    if (navState?.periodicPayment) {
      applyPeriodicPrefill(navState.periodicPayment);
    }
  }, [navState]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [periodics, allCompras] = await Promise.all([db.getPagosPeriodicos(), db.getCompras(90)]);

      setPeriodicPayments(periodics || []);

      const taxPayments = (allCompras || []).filter((mov) => mov.proveedor === 'Pago Periódico');
      setRegisteredPayments(taxPayments);
    } catch (err) {
      console.error('Error loading Pagos data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPeriodicChange = (e) => {
    const id = e.target.value;
    setSelectedPeriodicId(id);
    const selected = noInvoiceOptions.find((p) => p.id === id);
    if (selected) {
      setPagoMonto(selected.monto_mensual || '');
      setPagoObservacion(selected.observaciones || '');
      pagoMontoInputRef.current?.focus();
    } else {
      setPagoMonto('');
      setPagoObservacion('');
    }
  };

  const handleSavePagoImpuesto = async (e) => {
    e.preventDefault();
    if (!selectedPeriodicId) {
      alert('Por favor seleccione el concepto a pagar.');
      return;
    }
    const val = parseFloat(pagoMonto);
    if (isNaN(val) || val <= 0) {
      alert('El monto debe ser mayor que 0.');
      return;
    }

    if (!pagoOrigen) {
      alert('Por favor seleccione el origen del dinero.');
      return;
    }

    const selectedService = noInvoiceOptions.find((p) => p.id === selectedPeriodicId);
    if (!selectedService) {
      alert('El concepto seleccionado no es válido.');
      return;
    }

    setSaveStatus('saving');
    setSaveError('');

    try {
      const isRendicion = pagoOrigen.toLowerCase().includes('rendic');
      const paymentMethod = isRendicion ? 'Rendición' : 'Efectivo';
      const cajaCierre = isRendicion ? 'Rendición' : pagoOrigen;

      const now = new Date();
      const selectedDate = new Date(pagoFecha);
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      const finalIsoDate = selectedDate.toISOString();

      const res = await db.saveCompra({
        fecha: finalIsoDate,
        proveedor: 'Pago Periódico',
        tipo: 'Gasto General',
        detalle: selectedService.nombre,
        monto_neto: val,
        iva_21: 0,
        total: val,
        pago: paymentMethod,
        caja_cierre: cajaCierre,
        factura: 'Sin factura',
        nro_factura: 'S/F-' + Date.now().toString().slice(-6),
      });

      if (res.success) {
        await db.updatePagoPeriodicoStatus(selectedPeriodicId, {
          ultimo_pago_fecha: finalIsoDate,
        });

        setSaveStatus('success');
        setSelectedPeriodicId('');
        setPagoMonto('');
        setPagoObservacion('');
        setPagoFecha(new Date().toISOString().substring(0, 10));
        loadData();
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        throw new Error(res.error || 'No se pudo registrar el pago.');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setSaveError(err.message || 'Error al guardar el pago.');
    }
  };

  const handleNumericKeyDown = (e) => {
    if (e.key === ',' || e.key === '.') {
      const expectsDot = (() => {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = '1.1';
        return !!input.value;
      })();
      if (e.key === ',' && expectsDot) {
        e.preventDefault();
        document.execCommand('insertText', false, '.');
      } else if (e.key === '.' && !expectsDot) {
        e.preventDefault();
        document.execCommand('insertText', false, ',');
      }
    }
  };

  const formatMoney = (val) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val || 0);

  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return (
      d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    );
  };

  const sortedPayments = useMemo(() => {
    const list = [...registeredPayments];
    list.sort((a, b) => {
      let valA = a[paymentsSort.column];
      let valB = b[paymentsSort.column];
      if (paymentsSort.column === 'fecha') {
        valA = new Date(valA || 0).getTime();
        valB = new Date(valB || 0).getTime();
      }
      if (valA < valB) return paymentsSort.direction === 'asc' ? -1 : 1;
      if (valA > valB) return paymentsSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [registeredPayments, paymentsSort]);

  const requestSortPayments = (col) => {
    setPaymentsSort((prev) => ({
      column: col,
      direction: prev.column === col && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const tabButtonStyle = (active) => ({
    backgroundColor: active ? accent : 'transparent',
    color: active ? '#ffffff' : accent,
    border: '1px solid ' + accent,
  });

  return (
    <div className="page-card animate__animated animate__fadeIn" style={{ borderLeft: '5px solid ' + accent }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1.5px solid var(--border-color)',
          paddingBottom: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="bi bi-wallet2" style={{ color: accent }}></i>
            {MODULE_LABELS['pago-impuestos']}
          </h2>
          <p className="text-muted small mb-0">Pagos regulares sin factura de proveedor</p>
        </div>

        <div className="flex-row-group" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn-new-task" style={tabButtonStyle(section === 'register')} onClick={() => setSection('register')}>
            <i className="bi bi-plus-circle me-1"></i> Cargar pago
          </button>
          <button type="button" className="btn-new-task" style={tabButtonStyle(section === 'list')} onClick={() => setSection('list')}>
            <i className="bi bi-list-ul me-1"></i> Ver lista
          </button>
          <button type="button" className="btn-new-task" style={tabButtonStyle(section === 'calendar')} onClick={() => setSection('calendar')}>
            <i className="bi bi-calendar3 me-1"></i> Ver calendario
          </button>
        </div>
      </div>

      {section === 'register' && (
        <div className="row g-4">
          <div className="col-12 col-lg-6 mx-auto">
            <div className="page-card shadow-sm" style={{ borderLeft: '4px solid ' + accent, padding: '20px' }}>
              <h5 className="section-title mb-3">Registrar pago</h5>
              <form onSubmit={handleSavePagoImpuesto}>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Concepto (sin factura)</label>
                  <select className="form-select" value={selectedPeriodicId} onChange={handleSelectPeriodicChange} required>
                    <option value="">Seleccionar concepto...</option>
                    {noInvoiceOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre} ({item.subgrupo ? item.subgrupo.split('. ')[1] || item.subgrupo : 'Sin grupo'})
                      </option>
                    ))}
                  </select>
                  <small className="text-muted" style={{ fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                    Conceptos marcados como &quot;Sin Factura&quot; en el calendario de pagos.
                  </small>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-bold">Origen del dinero</label>
                  <select className="form-select" value={pagoOrigen} onChange={(e) => setPagoOrigen(e.target.value)} required>
                    <option value="">Seleccionar...</option>
                    {shiftsAvailableState.map((s, i) => (
                      <option key={i} value={s}>
                        {s}
                      </option>
                    ))}
                    {rendConfig.allow_pagos && <option value="Rendición">Rendición (Caja Fuerte)</option>}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-bold">Fecha de pago</label>
                  <input type="date" className="form-control" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)} required />
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-bold">Monto pagado</label>
                  <div className="input-group input-group-lg">
                    <span className="input-group-text bg-success text-white border-0">$</span>
                    <input
                      ref={pagoMontoInputRef}
                      type="number"
                      step="any"
                      className="form-control border-0 bg-light"
                      placeholder="0.00"
                      value={pagoMonto}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) => setPagoMonto(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-bold">Observaciones</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    placeholder="Ej: Pago cuota mes corriente..."
                    value={pagoObservacion}
                    onChange={(e) => setPagoObservacion(e.target.value)}
                  ></textarea>
                </div>

                <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>Registrando...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check2-circle me-2"></i>Registrar pago
                    </>
                  )}
                </button>

                {saveStatus === 'success' && (
                  <div className="alert alert-success mt-3 py-2 small d-flex align-items-center">
                    <i className="bi bi-check-circle-fill me-2"></i> Pago registrado correctamente.
                  </div>
                )}
                {saveStatus === 'error' && (
                  <div className="alert alert-danger mt-3 py-2 small">
                    <i className="bi bi-exclamation-triangle-fill me-2"></i> {saveError}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {section === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="page-card shadow-sm" style={{ borderLeft: '4px solid ' + accent, padding: '16px' }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-title mb-0">Pagos registrados</h5>
              <span className="badge bg-light text-dark border">{registeredPayments.length} registros</span>
            </div>
            <div className="table-responsive" style={{ maxHeight: '320px' }}>
              <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.85rem' }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('fecha')}>
                      Fecha {paymentsSort.column === 'fecha' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('detalle')}>
                      Concepto {paymentsSort.column === 'detalle' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Medio</th>
                    <th className="text-end" style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('total')}>
                      Monto {paymentsSort.column === 'total' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="4" className="text-center py-4 text-muted">
                        <span className="spinner-border spinner-border-sm me-2"></span>Cargando...
                      </td>
                    </tr>
                  ) : sortedPayments.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="text-center py-4 text-muted">
                        <i className="bi bi-inbox me-2"></i>No hay pagos registrados
                      </td>
                    </tr>
                  ) : (
                    sortedPayments.map((mov) => (
                      <tr key={mov.id}>
                        <td className="text-nowrap">{formatDate(mov.fecha)}</td>
                        <td className="fw-bold">{mov.detalle}</td>
                        <td>
                          <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '0.65rem' }}>
                            {mov.caja_cierre || mov.pago}
                          </span>
                        </td>
                        <td className="text-end fw-bold text-success">{formatMoney(mov.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <PeriodicPayments
            navigate={navigate}
            accentColor={accent}
            embedded
            hideHeader
            viewMode="list"
            onRegisterPayment={applyPeriodicPrefill}
          />
        </div>
      )}

      {section === 'calendar' && (
        <PeriodicPayments
          navigate={navigate}
          accentColor={accent}
          embedded
          hideHeader
          viewMode="simulation"
          onRegisterPayment={applyPeriodicPrefill}
        />
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .section-title {
          font-weight: 800;
          color: #2d3748;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-size: 0.9rem;
        }
        .table-hover tbody tr:hover {
          background-color: #f7fafc;
        }
      `,
        }}
      />
    </div>
  );
}

export default PagoImpuestos;
