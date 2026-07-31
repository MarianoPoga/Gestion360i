import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../supabaseClient';
import { MODULE_LABELS, DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels';
import {
  ADELANTO_EFECTIVO,
  ADELANTO_MERCADERIA,
  formatAdelantoConceptLabel,
  getAdelantoConceptOptions,
  isAdelantoMercaderiaConcept,
  resolveAdelantoConceptSelection,
} from '../adelantoConcepts';

function Adelantos({ navigate, modules, accentColor }) {
  const isSameLocalDate = (isoString, localDateString) => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}` === localDateString;
  };

  // Config state loaded from localStorage
  const [config, setConfig] = useState({
    allow_mercaderia: true,
    allow_dinero: true,
    allow_pagos_proveedores: true,
    allow_adelantos: true,
    cajas_posibles: [],
    monto_maximo: null
  });

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME,
    allow_adelantos: true,
    allow_pagos: true
  });

  // Form states (Employees)
  const [empleado, setEmpleado] = useState('');
  const [concepto, setConcepto] = useState(ADELANTO_EFECTIVO);
  const [pagoOrigenEmp, setPagoOrigenEmp] = useState(''); // Shift name or 'Rendición'
  const [monto, setMonto] = useState('');
  const [observacion, setObservacion] = useState('');

  // UI state lists
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [todayAdvances, setTodayAdvances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'saving' | 'success' | 'error'
  const [saveError, setSaveError] = useState('');
  const [shiftsAvailableState, setShiftsAvailableState] = useState([]);

  // Sorting state
  const [advancesSort, setAdvancesSort] = useState({ column: 'fecha', direction: 'desc' });

  // Autocomplete suggestions state
  const [showEmpSuggestions, setShowEmpSuggestions] = useState(false);
  const [filteredEmployees, setFilteredEmployees] = useState([]);

  // Refs
  const amountInputRef = useRef(null);

  const conceptOptions = useMemo(() => getAdelantoConceptOptions(config), [config]);
  const selectedConcepto = useMemo(
    () => resolveAdelantoConceptSelection(concepto, config),
    [concepto, config]
  );

  // Load configuration and data on mount
  useEffect(() => {
    const rawConfig = localStorage.getItem('adelantos_config');
    let loadedConfig = { allow_mercaderia: true, allow_dinero: true, allow_pagos_proveedores: true, allow_adelantos: true, cajas_posibles: [], monto_maximo: null };
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        loadedConfig = {
          allow_mercaderia: parsed.allow_mercaderia !== false,
          allow_dinero: parsed.allow_dinero !== false,
          allow_pagos_proveedores: parsed.allow_pagos_proveedores !== false,
          allow_adelantos: parsed.allow_adelantos !== false,
          cajas_posibles: parsed.cajas_posibles || [],
          monto_maximo: parsed.monto_maximo ? parseFloat(parsed.monto_maximo) : null
        };
        setConfig(loadedConfig);
      } catch (e) {
        console.error("Error parsing settings:", e);
      }
    }

    if (!loadedConfig.allow_dinero && loadedConfig.allow_mercaderia) {
      setConcepto(ADELANTO_MERCADERIA);
    } else {
      setConcepto(ADELANTO_EFECTIVO);
    }

    const setupShifts = async () => {
      const shifts = loadedConfig.cajas_posibles.length > 0 ? loadedConfig.cajas_posibles : await db.getCierreTurnoNames();
      setShiftsAvailableState(shifts || []);
      const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}","allow_adelantos":true,"allow_compras":true,"allow_pagos":true}`);
      setRendConfig(loadedRendConfig);

      if (shifts && shifts.length > 0) {
        setPagoOrigenEmp(shifts[0]);
      } else {
        setPagoOrigenEmp(loadedRendConfig.allow_adelantos ? 'Rendición' : '');
      }
    };

    setupShifts();
    loadData();
  }, []);

  useEffect(() => {
    setConcepto((current) => resolveAdelantoConceptSelection(current, config));
  }, [config.allow_dinero, config.allow_mercaderia]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [namesData, allAdvances] = await Promise.all([
        db.getEmployees ? db.getEmployees() : db.getEmpleados(), // handle both names
        db.getEmpleadoMovimientos(50)
      ]);
      
      setActiveEmployees((namesData || []).map(e => e.nombre));

      const today = new Date();
      const advancesToday = (allAdvances || []).filter(mov => {
        if (!mov.fecha) return false;
        const d = new Date(mov.fecha);
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear() &&
               mov.concepto?.toLowerCase().startsWith('adelanto');
      });
      setTodayAdvances(advancesToday);

    } catch (err) {
      console.error("Error loading Adelantos data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (empleado.trim() === '') {
      setFilteredEmployees([]);
      return;
    }
    const match = activeEmployees.filter(name =>
      name.toLowerCase().includes(empleado.toLowerCase())
    );
    setFilteredEmployees(match);
  }, [empleado, activeEmployees]);

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

  const handleSaveAdelanto = async (e) => {
    e.preventDefault();
    if (!empleado.trim()) {
      alert("Por favor ingrese el nombre del empleado.");
      return;
    }
    const val = parseFloat(monto);
    if (isNaN(val) || val <= 0) {
      alert("El monto debe ser mayor que 0.");
      return;
    }

    if (config.monto_maximo !== null && val > config.monto_maximo) {
      alert(`El monto máximo permitido para adelantos es de ${formatMoney(config.monto_maximo)}.`);
      return;
    }

    if (selectedConcepto === ADELANTO_MERCADERIA && !observacion.trim()) {
      alert("Por favor ingrese el detalle de la mercadería retirada.");
      return;
    }

    if (pagoOrigenEmp !== 'Rendición' && !pagoOrigenEmp) {
      alert("Por favor seleccione el origen del dinero.");
      return;
    }

    setSaveStatus('saving');
    setSaveError('');

    try {
      const formattedDate = new Date().toISOString();
      let finalObservation = observacion.trim();
      let finalConcepto = selectedConcepto;

      if (pagoOrigenEmp === 'Rendición') {
        finalConcepto = 'Adelanto Rendición';
      } else {
        finalObservation = `[Caja: ${pagoOrigenEmp}]${observacion.trim() ? ' ' + observacion.trim() : ''}`;
      }

      const res = await db.saveAdelanto({
        fecha: formattedDate,
        empleado: empleado.trim(),
        concepto: finalConcepto,
        monto: val,
        observacion: finalObservation
      });

      if (res.success) {
        setSaveStatus('success');
        setEmpleado('');
        setMonto('');
        setObservacion('');
        loadData();
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        throw new Error(res.error || "No se pudo registrar el adelanto.");
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setSaveError(err.message || "Error al guardar el adelanto.");
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

  const sortedAdvances = useMemo(() => {
    const list = [...todayAdvances];
    list.sort((a, b) => {
      let valA = a[advancesSort.column];
      let valB = b[advancesSort.column];
      if (advancesSort.column === 'fecha') {
        valA = new Date(valA || 0).getTime();
        valB = new Date(valB || 0).getTime();
      }
      if (valA < valB) return advancesSort.direction === 'asc' ? -1 : 1;
      if (valA > valB) return advancesSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [todayAdvances, advancesSort]);

  const requestSortAdvances = (col) => {
    setAdvancesSort(prev => ({
      column: col,
      direction: prev.column === col && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="page-card shadow-sm" style={{ borderLeft: '5px solid ' + (accentColor || '#ec4899') }}>
        <div className="page-header d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="page-title mb-0">{MODULE_LABELS.adelantos}</h2>
            <p className="text-muted small mb-0">Registro de {ADELANTO_EFECTIVO.toLowerCase()} o {ADELANTO_MERCADERIA.toLowerCase()}</p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('employees')}>
              <i className="bi bi-people me-1"></i> Ver Empleados
            </button>
          </div>
        </div>

        <div className="row g-4">
          {/* Form Column */}
          <div className="col-12 col-lg-5 border-lg-end">
            <div className="h-100 pe-lg-3">
              <h5 className="section-title mb-3">Nuevo Adelanto</h5>
            <form onSubmit={handleSaveAdelanto} autoComplete="off">
              <div className="mb-3 position-relative">
                <label className="form-label small fw-bold">Empleado</label>
                <div className="input-group">
                  <span className="input-group-text bg-light border-end-0"><i className="bi bi-person text-muted"></i></span>
                  <input
                    type="text"
                    className="form-control border-start-0"
                    placeholder="Buscar o escribir nombre..."
                    value={empleado}
                    onChange={(e) => {
                      setEmpleado(e.target.value);
                      setShowEmpSuggestions(true);
                    }}
                    onFocus={() => setShowEmpSuggestions(true)}
                    autoComplete="off"
                    required
                  />
                </div>
                {showEmpSuggestions && filteredEmployees.length > 0 && (
                  <ul className="list-group position-absolute w-100 shadow-lg" style={{ zIndex: 1000, maxHeight: '200px', overflowY: 'auto' }}>
                    {filteredEmployees.map((name, idx) => (
                      <li
                        key={idx}
                        className="list-group-item list-group-item-action py-2 small"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setEmpleado(name);
                          setShowEmpSuggestions(false);
                          amountInputRef.current?.focus();
                        }}
                      >
                        <i className="bi bi-person-check me-2 text-primary"></i>{name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label small fw-bold">Concepto</label>
                  <select
                    className="form-select"
                    name="adelanto-concepto"
                    autoComplete="off"
                    value={selectedConcepto}
                    onChange={(e) => setConcepto(e.target.value)}
                  >
                    {conceptOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Origen Fondos</label>
                  <select
                    className="form-select"
                    value={pagoOrigenEmp}
                    onChange={(e) => setPagoOrigenEmp(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar...</option>
                    {shiftsAvailableState.map((s, i) => <option key={i} value={s}>{s}</option>)}
                    {rendConfig.allow_adelantos && <option value="Rendición">Rendición (Caja Fuerte)</option>}
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-bold">Monto</label>
                <div className="input-group input-group-lg">
                  <span className="input-group-text bg-primary text-white border-0">$</span>
                  <input
                    ref={amountInputRef}
                    type="number"
                    step="any"
                    className="form-control border-0 bg-light"
                    placeholder="0.00"
                    value={monto}
                    onKeyDown={handleNumericKeyDown}
                    onChange={(e) => setMonto(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="form-label small fw-bold">Observaciones / Detalle</label>
                <textarea
                  className="form-control"
                  rows="2"
                  placeholder={selectedConcepto === ADELANTO_MERCADERIA ? "Ej: 2 Hamburguesas, 1 Gaseosa..." : "Notas opcionales..."}
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  required={selectedConcepto === ADELANTO_MERCADERIA}
                ></textarea>
              </div>

              <button
                type="submit"
                className="btn btn-primary w-100 py-2 fw-bold"
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <><span className="spinner-border spinner-border-sm me-2"></span>Registrando...</>
                ) : (
                  <><i className="bi bi-check2-circle me-2"></i>Registrar Adelanto</>
                )}
              </button>

              {saveStatus === 'success' && (
                <div className="alert alert-success mt-3 py-2 small d-flex align-items-center animate__animated animate__headShake">
                  <i className="bi bi-check-circle-fill me-2"></i> Adelanto registrado correctamente.
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
            <div className="h-100 ps-lg-3">
              <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-title mb-0">Registros de Hoy</h5>
              <span className="badge bg-light text-dark border">{todayAdvances.length} movimientos</span>
            </div>

            <div className="table-responsive" style={{ maxHeight: '500px' }}>
              <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.85rem' }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortAdvances('fecha')}>
                      Fecha {advancesSort.column === 'fecha' && (advancesSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => requestSortAdvances('empleado')}>
                      Empleado {advancesSort.column === 'empleado' && (advancesSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Concepto</th>
                    <th className="text-end" style={{ cursor: 'pointer' }} onClick={() => requestSortAdvances('monto')}>
                      Monto {advancesSort.column === 'monto' && (advancesSort.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="4" className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2"></span>Cargando...</td></tr>
                  ) : sortedAdvances.length === 0 ? (
                    <tr><td colSpan="4" className="text-center py-5 text-muted"><i className="bi bi-inbox me-2"></i>No hay adelantos registrados hoy</td></tr>
                  ) : (
                    sortedAdvances.map((mov) => (
                      <tr key={mov.id}>
                        <td className="text-nowrap">{formatDate(mov.fecha)}</td>
                        <td className="fw-bold">{mov.empleado}</td>
                        <td>
                          <div className="d-flex flex-column">
                            <span className={`badge ${isAdelantoMercaderiaConcept(mov.concepto) ? 'bg-info-subtle text-info' : 'bg-success-subtle text-success'} align-self-start`} style={{ fontSize: '0.65rem' }}>
                              {formatAdelantoConceptLabel(mov.concepto)}
                            </span>
                            {mov.observacion && <small className="text-muted mt-1 text-truncate" style={{ maxWidth: '150px' }} title={mov.observacion}>{mov.observacion}</small>}
                          </div>
                        </td>
                        <td className="text-end fw-bold text-primary">{formatMoney(mov.monto)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
        .form-label {
          color: #4a5568;
        }
        .table-hover tbody tr:hover {
          background-color: #f7fafc;
        }
        .badge {
          font-weight: 600;
          padding: 0.35em 0.65em;
        }
      ` }} />
    </div>
  );
}

export default Adelantos;
