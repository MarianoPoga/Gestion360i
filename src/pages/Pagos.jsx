import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../supabaseClient';
import { MODULE_LABELS, DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels';

function Pagos({ navigate, modules, accentColor }) {
  const isSameLocalDate = (isoString, localDateString) => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}` === localDateString;
  };

  // Config state
  const [config, setConfig] = useState({
    allow_pagos_proveedores: true,
    cajas_posibles: [],
    monto_maximo: null
  });

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME,
    allow_pagos: true
  });

  // Form states (Providers)
  const [proveedor, setProveedor] = useState('');
  const [proveedorAlias, setProveedorAlias] = useState('');
  const [pagoOrigen, setPagoOrigen] = useState(''); // Shift name or 'Rendición'
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoObservacion, setPagoObservacion] = useState('');

  // UI state lists
  const [proveedoresData, setProveedoresData] = useState({});
  const [todayPayments, setTodayPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saving' | 'success' | 'error'
  const [saveError, setSaveError] = useState('');
  const [shiftsAvailableState, setShiftsAvailableState] = useState([]);

  // Sorting state
  const [paymentsSort, setPaymentsSort] = useState({ column: 'fecha', direction: 'desc' });

  // Autocomplete suggestions state
  const [showProvSuggestions, setShowProvSuggestions] = useState(false);
  const [filteredProviders, setFilteredProviders] = useState([]);

  // Refs
  const pagoMontoInputRef = useRef(null);

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
      const shifts = loadedConfig.cajas_posibles.length > 0 ? loadedConfig.cajas_posibles : await db.getCierreTurnoNames();
      setShiftsAvailableState(shifts || []);
      const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}","allow_pagos":true}`);
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [provsData, allPayments] = await Promise.all([
        db.getProveedoresData(),
        db.getProveedorPagos(50)
      ]);
      
      setProveedoresData(provsData || {});

      const today = new Date();
      const paymentsToday = (allPayments || []).filter(mov => {
        if (!mov.fecha) return false;
        const d = new Date(mov.fecha);
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear();
      });
      setTodayPayments(paymentsToday);

    } catch (err) {
      console.error("Error loading Pagos data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (proveedor.trim() === '') {
      setFilteredProviders([]);
      return;
    }
    const names = Object.keys(proveedoresData);
    const match = names.filter(name =>
      name.toLowerCase().includes(proveedor.toLowerCase()) ||
      (proveedoresData[name].alias && proveedoresData[name].alias.toLowerCase().includes(proveedor.toLowerCase()))
    );
    setFilteredProviders(match);
  }, [proveedor, proveedoresData]);

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

  const handleSavePagoProveedor = async (e) => {
    e.preventDefault();
    if (!proveedor.trim()) {
      alert("Por favor ingrese el nombre o razón social del proveedor.");
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

    setSaveStatus('saving');
    setSaveError('');

    try {
      const formattedDate = new Date().toISOString();
      
      const res = await db.saveProveedorPago({
        fecha: formattedDate,
        proveedor: proveedor.trim(),
        alias: proveedorAlias.trim(),
        origen: pagoOrigen,
        monto: val,
        observacion: pagoObservacion.trim()
      });

      if (res.success) {
        setSaveStatus('success');
        setProveedor('');
        setProveedorAlias('');
        setPagoMonto('');
        setPagoObservacion('');
        loadData();
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        throw new Error(res.error || "No se pudo registrar el pago.");
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setSaveError(err.message || "Error al guardar el pago.");
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
          <h2 className="page-title mb-0">{MODULE_LABELS['pago-proveedores']}</h2>
          <p className="text-muted small mb-0">Registro de pagos realizados a proveedores</p>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('providers')}>
            <i className="bi bi-truck me-1"></i> Ver {MODULE_LABELS.proveedores}
          </button>
        </div>
      </div>

      <div className="row g-4">
        {/* Form Column */}
        <div className="col-12 col-lg-5">
          <div className="page-card shadow-sm h-100" style={{ borderLeft: '5px solid ' + (accentColor || '#10b981') }}>
            <h5 className="section-title mb-3">Nuevo Pago</h5>
            <form onSubmit={handleSavePagoProveedor}>
              <div className="mb-3 position-relative">
                <label className="form-label small fw-bold">Proveedor</label>
                <div className="input-group">
                  <span className="input-group-text bg-light border-end-0"><i className="bi bi-shop text-muted"></i></span>
                  <input
                    type="text"
                    className="form-control border-start-0"
                    placeholder="Buscar proveedor..."
                    value={proveedor}
                    onChange={(e) => {
                      setProveedor(e.target.value);
                      setShowProvSuggestions(true);
                    }}
                    onFocus={() => setShowProvSuggestions(true)}
                    autoComplete="off"
                    required
                  />
                </div>
                {showProvSuggestions && filteredProviders.length > 0 && (
                  <ul className="list-group position-absolute w-100 shadow-lg" style={{ zIndex: 1000, maxHeight: '200px', overflowY: 'auto' }}>
                    {filteredProviders.map((name, idx) => (
                      <li
                        key={idx}
                        className="list-group-item list-group-item-action py-2 small"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setProveedor(name);
                          setProveedorAlias(proveedoresData[name].alias || '');
                          setShowProvSuggestions(false);
                          pagoMontoInputRef.current?.focus();
                        }}
                      >
                        <i className="bi bi-check-circle me-2 text-primary"></i>{name} {proveedoresData[name].alias ? `(${proveedoresData[name].alias})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
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
                <label className="form-label small fw-bold">Observaciones</label>
                <textarea
                  className="form-control"
                  rows="2"
                  placeholder="Ej: Pago factura #123, adelanto..."
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
                  <i className="bi bi-check-circle-fill me-2"></i> Pago registrado correctamente.
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
          <div className="page-card shadow-sm h-100" style={{ borderLeft: '5px solid ' + (accentColor || '#10b981') }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-title mb-0">Pagos de Hoy</h5>
              <span className="badge bg-light text-dark border">{todayPayments.length} registros</span>
            </div>

            <div className="table-responsive" style={{ maxHeight: '500px' }}>
              <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.85rem' }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('fecha')}>
                      Fecha {paymentsSort.column === 'fecha' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('proveedor')}>
                      Proveedor {paymentsSort.column === 'proveedor' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Origen</th>
                    <th className="text-end" style={{ cursor: 'pointer' }} onClick={() => requestSortPayments('monto')}>
                      Monto {paymentsSort.column === 'monto' && (paymentsSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="4" className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2"></span>Cargando...</td></tr>
                  ) : todayPayments.length === 0 ? (
                    <tr><td colSpan="4" className="text-center py-5 text-muted"><i className="bi bi-inbox me-2"></i>No hay pagos registrados hoy</td></tr>
                  ) : (
                    sortedPayments.map((mov) => (
                      <tr key={mov.id}>
                        <td className="text-nowrap">{formatDate(mov.fecha)}</td>
                        <td className="fw-bold">
                          {mov.proveedor}
                          {mov.alias && <div className="text-muted fw-normal" style={{ fontSize: '0.7rem' }}>{mov.alias}</div>}
                        </td>
                        <td>
                          <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '0.65rem' }}>
                            {mov.origen}
                          </span>
                          {mov.observacion && <div className="small text-muted mt-1 text-truncate" style={{ maxWidth: '120px' }}>{mov.observacion}</div>}
                        </td>
                        <td className="text-end fw-bold text-success">{formatMoney(mov.monto)}</td>
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

export default Pagos;
