import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../supabaseClient';

function PagoImpuestos({ navigate, modules, navState, accentColor }) {
  // Config state (same boxes as Pagos/Adelantos)
  const [config, setConfig] = useState({
    allow_pagos_proveedores: true,
    cajas_posibles: [],
    monto_maximo: null
  });

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: 'Caja fuerte',
    allow_pagos: true
  });

  // Form states
  const [selectedPeriodicId, setSelectedPeriodicId] = useState('');
  const [pagoOrigen, setPagoOrigen] = useState(''); // Shift name or 'Rendición'
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoObservacion, setPagoObservacion] = useState('');
  const [pagoFecha, setPagoFecha] = useState(new Date().toISOString().substring(0, 10));

  // UI state lists
  const [periodicPayments, setPeriodicPayments] = useState([]);
  const [todayPayments, setTodayPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saving' | 'success' | 'error'
  const [saveError, setSaveError] = useState('');
  const [shiftsAvailableState, setShiftsAvailableState] = useState([]);

  // Sorting state
  const [paymentsSort, setPaymentsSort] = useState({ column: 'fecha', direction: 'desc' });

  // Refs
  const pagoMontoInputRef = useRef(null);

  // Filter periodic payments that are "Sin Factura"
  const noInvoiceOptions = useMemo(() => {
    return periodicPayments.filter(p => p.tipo_factura === 'Sin Factura' && p.activo !== false);
  }, [periodicPayments]);

  useEffect(() => {
    const rawConfig = localStorage.getItem('adelantos_config');
    let loadedConfig = { allow_pagos_proveedores: true, cajas_posibles: [], monto_maximo: null };
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        loadedConfig = {
          allow_pagos_proveedores: parsed.allow_pagos_proveedores !== false,
          cajas_posibles: parsed.cajas_posibles || [],
          monto_maximo: parsed.monto_maximo ? parseFloat(parsed.monto_maximo) : null
        };
        setConfig(loadedConfig);
      } catch (e) {
        console.error("Error parsing settings:", e);
      }
    }

    const setupShifts = async () => {
      const shifts = loadedConfig.cajas_posibles.length > 0 ? loadedConfig.cajas_posibles : await db.getCierreTurnos();
      setShiftsAvailableState(shifts || []);
      const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || '{"caja_nombre":"Caja fuerte","allow_pagos":true}');
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

  // Handle incoming redirect state (from PeriodicPayments.jsx)
  useEffect(() => {
    if (navState?.periodicPayment) {
      const { id, monto, fecha_sugerida } = navState.periodicPayment;
      setSelectedPeriodicId(id || '');
      setPagoMonto(monto || '');
      if (fecha_sugerida) {
        setPagoFecha(fecha_sugerida.substring(0, 10));
      }
    }
  }, [navState]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [periodics, allCompras] = await Promise.all([
        db.getPagosPeriodicos(),
        db.getCompras(30) // Load recent purchases to filter today's tax payments
      ]);

      setPeriodicPayments(periodics || []);

      const todayStr = new Date().toDateString();
      const taxPayments = (allCompras || []).filter(mov => {
        if (mov.proveedor !== 'Pago Periódico') return false;
        if (!mov.fecha) return false;
        const d = new Date(mov.fecha);
        return d.toDateString() === todayStr;
      });

      setTodayPayments(taxPayments);

    } catch (err) {
      console.error("Error loading PagoImpuestos data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPeriodicChange = (e) => {
    const id = e.target.value;
    setSelectedPeriodicId(id);
    const selected = noInvoiceOptions.find(p => p.id === id);
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
      alert("Por favor seleccione el servicio o impuesto a pagar.");
      return;
    }
    const val = parseFloat(pagoMonto);
    if (isNaN(val) || val <= 0) {
      alert("El monto debe ser mayor que 0.");
      return;
    }

    if (!pagoOrigen) {
      alert("Por favor seleccione el origen del dinero.");
      return;
    }

    const selectedService = noInvoiceOptions.find(p => p.id === selectedPeriodicId);
    if (!selectedService) {
      alert("El servicio seleccionado no es válido.");
      return;
    }

    setSaveStatus('saving');
    setSaveError('');

    try {
      // Determine payment method and caja closing shifts
      const isRendicion = pagoOrigen.toLowerCase().includes("rendic");
      const paymentMethod = isRendicion ? 'Rendición' : 'Efectivo';
      const cajaCierre = isRendicion ? 'Rendición' : pagoOrigen;

      // Construct payment ISO date (using selected date + current time)
      const now = new Date();
      const selectedDate = new Date(pagoFecha);
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      const finalIsoDate = selectedDate.toISOString();

      // 1. Save expense as a Compra (Without invoice)
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
        nro_factura: 'S/F-' + Date.now().toString().slice(-6)
      });

      if (res.success) {
        // 2. Update last paid date in gst_pagos_periodicos
        await db.updatePagoPeriodicoStatus(selectedPeriodicId, {
          ultimo_pago_fecha: finalIsoDate
        });

        setSaveStatus('success');
        setSelectedPeriodicId('');
        setPagoMonto('');
        setPagoObservacion('');
        setPagoFecha(new Date().toISOString().substring(0, 10));
        loadData();
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        throw new Error(res.error || "No se pudo registrar el pago.");
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setSaveError(err.message || "Error al guardar el pago de impuesto/servicio.");
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

  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val || 0);
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + 
           d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  };

  const sortedPayments = useMemo(() => {
    const list = [...todayPayments];
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
  }, [todayPayments, paymentsSort]);

  const requestSortPayments = (col) => {
    setPaymentsSort(prev => ({
      column: col,
      direction: prev.column === col && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <div className="container-fluid animate__animated animate__fadeIn" style={{ maxWidth: '1000px' }}>
      <div className="page-header d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="page-title mb-0">Pago de Impuestos / Servicios</h2>
          <p className="text-muted small mb-0">Registro de egresos fijos recurrentes sin factura tradicional</p>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('pagos-periodicos')}>
            <i className="bi bi-calendar-check me-1"></i> Ver Planificación
          </button>
        </div>
      </div>

      <div className="row g-4">
        {/* Form Column */}
        <div className="col-12 col-lg-5">
          <div className="page-card shadow-sm h-100" style={{ borderLeft: '5px solid ' + (accentColor || '#0ea5e9') }}>
            <h5 className="section-title mb-3">Registrar Pago Directo</h5>
            <form onSubmit={handleSavePagoImpuesto}>
              <div className="mb-3">
                <label className="form-label small fw-bold">Servicio / Impuesto (Sin Factura)</label>
                <select
                  className="form-select"
                  value={selectedPeriodicId}
                  onChange={handleSelectPeriodicChange}
                  required
                >
                  <option value="">Seleccionar concepto...</option>
                  {noInvoiceOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre} ({item.subgrupo ? (item.subgrupo.split('. ')[1] || item.subgrupo) : 'Sin Grupo'})
                    </option>
                  ))}
                </select>
                <small className="text-muted" style={{ fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                  Solo se listan ítems configurados como "Sin Factura" en Pagos Periódicos.
                </small>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-bold">Origen del Dinero</label>
                <select
                  className="form-select"
                  value={pagoOrigen}
                  onChange={(e) => setPagoOrigen(e.target.value)}
                  required
                >
                  <option value="">Seleccionar...</option>
                  {shiftsAvailableState.map((s, i) => <option key={i} value={s}>{s}</option>)}
                  {rendConfig.allow_pagos && <option value="Rendición">Rendición (Caja Fuerte)</option>}
                </select>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-bold">Fecha de Pago</label>
                <input 
                  type="date" 
                  className="form-control"
                  value={pagoFecha}
                  onChange={(e) => setPagoFecha(e.target.value)}
                  required
                />
              </div>

              <div className="mb-3">
                <label className="form-label small fw-bold">Monto Pagado</label>
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
                <label className="form-label small fw-bold">Observaciones / Detalles</label>
                <textarea
                  className="form-control"
                  rows="2"
                  placeholder="Ej: Pago cuota mes corriente, luz bimestre..."
                  value={pagoObservacion}
                  onChange={(e) => setPagoObservacion(e.target.value)}
                ></textarea>
              </div>

              <button
                type="submit"
                className="btn btn-success w-100 py-2 fw-bold"
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <><span className="spinner-border spinner-border-sm me-2"></span>Registrando...</>
                ) : (
                  <><i className="bi bi-check2-circle me-2"></i>Registrar Pago</>
                )}
              </button>

              {saveStatus === 'success' && (
                <div className="alert alert-success mt-3 py-2 small d-flex align-items-center animate__animated animate__headShake">
                  <i className="bi bi-check-circle-fill me-2"></i> Pago de impuesto/servicio registrado.
                </div>
              )}
              {saveStatus === 'error' && (
                <div className="alert alert-danger mt-3 py-2 small animate__animated animate__shakeX">
                  <i className="bi bi-exclamation-triangle-fill me-2"></i> {saveError}
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Table Column */}
        <div className="col-12 col-lg-7">
          <div className="page-card shadow-sm h-100" style={{ borderLeft: '5px solid ' + (accentColor || '#0ea5e9') }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-title mb-0">Gastos Registrados Hoy</h5>
              <span className="badge bg-light text-dark border">{todayPayments.length} registros</span>
            </div>

            <div className="table-responsive" style={{ maxHeight: '500px' }}>
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
                    <tr><td colSpan="4" className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2"></span>Cargando...</td></tr>
                  ) : todayPayments.length === 0 ? (
                    <tr><td colSpan="4" className="text-center py-5 text-muted"><i className="bi bi-inbox me-2"></i>No hay pagos de impuestos registrados hoy</td></tr>
                  ) : (
                    sortedPayments.map((mov) => (
                      <tr key={mov.id}>
                        <td className="text-nowrap">{formatDate(mov.fecha)}</td>
                        <td className="fw-bold">
                          {mov.detalle}
                          <div className="text-muted fw-normal" style={{ fontSize: '0.7rem' }}>Pago Periódico</div>
                        </td>
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
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .page-card {
          background: white;
          border-radius: 15px;
          padding: 20px;
          border: 1px solid #edf2f7;
        }
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
      ` }} />
    </div>
  );
}

export default PagoImpuestos;
