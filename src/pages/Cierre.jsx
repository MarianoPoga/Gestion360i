import React, { useState, useEffect } from 'react'
import { db } from '../supabaseClient'

function Cierre({ navigate, accentColor }) {
  const isSameLocalDate = (isoString, localDateString) => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}` === localDateString;
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

  // Main form states
  const [fecha, setFecha] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [turno, setTurno] = useState('Mañana');
  
  // Sales concepts (manual inputs)
  const [efectivo, setEfectivo] = useState(0);
  const [digitalValues, setDigitalValues] = useState({});
  
  // Pending lists loaded from backend
  const [pendingCompras, setPendingCompras] = useState([]);
  const [pendingAdelantos, setPendingAdelantos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [ultimosCierres, setUltimosCierres] = useState([]);
  const [cierreSortField, setCierreSortField] = useState('fecha');
  const [cierreSortAsc, setCierreSortAsc] = useState(false);
  
  
  // Load UI lists
  const [loadingLists, setLoadingLists] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // 'success', 'error', ''
  const [errorMsg, setErrorMsg] = useState('');
  
  // Modals visibility states
  const [showBilletes, setShowBilletes] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showAddMerc, setShowAddMerc] = useState(false);
  
  // Bill counter values
  const billDenominations = [20000, 10000, 2000, 1000, 500, 200, 100];
  const [billCounts, setBillCounts] = useState({
    20000: 0, 10000: 0, 2000: 0, 1000: 0, 500: 0, 200: 0, 100: 0
  });

  // Summing calculator values
  const [calcTarget, setCalcTarget] = useState(''); // 'transferencia', 'tarjeta', 'qrPago', 'linkPago', 'ctaCte'
  const [calcInput, setCalcInput] = useState('');
  const [calcItems, setCalcItems] = useState([]);

  // Add merchandise advance values
  const [newMercEmpleado, setNewMercEmpleado] = useState('');
  const [newMercMonto, setNewMercMonto] = useState('');
  const [newMercObs, setNewMercObs] = useState('');
  const [savingMerc, setSavingMerc] = useState(false);

  // Configured turnos and concepts states
  const [turnosDisponibles, setTurnosDisponibles] = useState([]);
  const [cierreConceptos, setCierreConceptos] = useState([]);
  const [config, setConfig] = useState({ allow_dinero: true, allow_mercaderia: true, allow_adelantos: true });
  const [formasPago, setFormasPago] = useState([]);

  // Add cash advance values
  const [showAddEfec, setShowAddEfec] = useState(false);
  const [newEfecEmpleado, setNewEfecEmpleado] = useState('');
  const [newEfecMonto, setNewEfecMonto] = useState('');
  const [newEfecObs, setNewEfecObs] = useState('');
  const [savingEfec, setSavingEfec] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      const [activeTurnos, activeConcepts, activeFormas] = await Promise.all([
        db.getCierreTurnos(),
        db.getCierreConceptos(),
        db.getComprasFormasPago()
      ]);

      setTurnosDisponibles(activeTurnos);
      if (activeTurnos.length > 0 && !activeTurnos.includes(turno)) {
        setTurno(activeTurnos[0]);
      }
      setCierreConceptos(activeConcepts);
      setFormasPago(activeFormas || []);
      
      const initialDigital = {};
      activeConcepts.forEach(c => {
        if (c.enabled) initialDigital[c.id] = 0;
      });
      setDigitalValues(initialDigital);
    };

    loadConfig();

    const adelantosConfig = JSON.parse(localStorage.getItem('adelantos_config') || '{"allow_mercaderia":true,"allow_dinero":true,"allow_adelantos":true}');
    setConfig(adelantosConfig);
    
    loadData();
  }, []);

  const conceptIcons = {
    transferencia: 'bi-bank2',
    tarjeta: 'bi-credit-card-2-front-fill',
    qrPago: 'bi-qr-code',
    linkPago: 'bi-link-45deg',
    ctaCte: 'bi-journal-text'
  };

  const getConceptValue = (id) => {
    return digitalValues[id] || 0;
  };

  const setConceptValue = (id, val) => {
    setDigitalValues(prev => ({
      ...prev,
      [id]: val
    }));
  };

  const handleSortCierres = (field) => {
    if (cierreSortField === field) {
      setCierreSortAsc(!cierreSortAsc);
    } else {
      setCierreSortField(field);
      setCierreSortAsc(field !== 'fecha' && field !== 'efectivo' && field !== 'total');
    }
  };

  const getTurnoBadgeStyle = (turno) => {
    const t = (turno || '').toLowerCase().trim();
    if (t.includes('mañana') || t.includes('manana')) {
      return { backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' };
    }
    if (t.includes('tarde')) {
      return { backgroundColor: '#ffedd5', color: '#c2410c', border: '1px solid #fed7aa' };
    }
    if (t.includes('noche')) {
      return { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' };
    }
    if (t.includes('delivery')) {
      return { backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
    }
    if (t.includes('rendic') || t.includes('fuerte')) {
      return { backgroundColor: '#e2f0d9', color: '#385723', border: '1px solid #c5e0b4' };
    }
    return { backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
  };

  const handleOpenEfecModal = () => {
    setNewEfecEmpleado('');
    setNewEfecMonto('');
    setNewEfecObs('');
    setShowAddEfec(true);
  };

  const handleOpenMercModal = () => {
    setNewMercEmpleado('');
    setNewMercMonto('');
    setNewMercObs('');
    setShowAddMerc(true);
  };

  const getSortedCierres = () => {
    const list = [...ultimosCierres];
    list.sort((a, b) => {
      let comparison = 0;
      if (cierreSortField === 'fecha') {
        comparison = new Date(a.fecha) - new Date(b.fecha);
      } else if (cierreSortField === 'turno') {
        comparison = String(a.turno || '').localeCompare(String(b.turno || ''));
      } else if (cierreSortField === 'efectivo') {
        comparison = (parseFloat(a.efectivo) || 0) - (parseFloat(b.efectivo) || 0);
      } else if (cierreSortField === 'total') {
        comparison = (parseFloat(a.total) || 0) - (parseFloat(b.total) || 0);
      }
      return cierreSortAsc ? comparison : -comparison;
    });
    return list;
  };

  // Auto-select first available unclosed shift when date or closures list change
  useEffect(() => {
    const closed = ultimosCierres
      .filter(c => isSameLocalDate(c.fecha, fecha))
      .map(c => c.turno);
    const available = turnosDisponibles.filter(t => !closed.includes(t));
    if (available.length > 0) {
      if (!available.includes(turno)) {
        setTurno(available[0]);
      }
    } else if (turnosDisponibles.length > 0) {
      if (!turnosDisponibles.includes(turno)) {
        setTurno(turnosDisponibles[0]);
      }
    } else {
      setTurno('');
    }
  }, [fecha, ultimosCierres, turnosDisponibles]);

  // Load datasets on mount or when fecha/turno changes
  useEffect(() => {
    loadData();
  }, [fecha, turno]);

  const loadData = async () => {
    setLoadingLists(true);
    try {
      const [compras, adelantos, emps, cierres] = await Promise.all([
        db.getPendingCompras(),
        db.getPendingAdelantos(),
        db.getEmpleados(),
        db.getUltimosCierres()
      ]);
      setPendingCompras(compras);
      setPendingAdelantos(adelantos);
      const empNames = (emps || []).map(e => e.nombre);
      setEmpleados(empNames);
      setUltimosCierres(cierres);
      if (empNames.length > 0) {
        setNewMercEmpleado(empNames[0]);
        setNewEfecEmpleado(empNames[0]);
      }
    } catch (err) {
      console.error("Error loading closure datasets:", err);
    } finally {
      setLoadingLists(false);
    }
  };

  const visualDate = (() => {
    if (!fecha) return '';
    const parts = fecha.split('-'); // YYYY-MM-DD
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  })();
  const matchPago = `Caja ${visualDate} ${turno}`;

  // Filter pending lists for the current day and shift
  const comprasFiltered = pendingCompras.filter(comp => comp.pago === matchPago);
  const adelantosFiltered = pendingAdelantos.filter(ad => {
    const dateMatches = isSameLocalDate(ad.fecha, fecha);
    const shiftMatches = ad.concepto.includes(`[Caja: ${turno}]`);
    return dateMatches && shiftMatches;
  });


  // Recalculate read-only fields based on all filtered items (no checkboxes as per user request)
  const comprasSum = comprasFiltered
    .reduce((acc, curr) => acc + parseFloat(curr.total || 0), 0);

  const adelantosEfectivoSum = adelantosFiltered
    .filter(ad => ad.concepto.startsWith('Adelanto $'))
    .reduce((acc, curr) => acc + parseFloat(curr.monto || 0), 0);

  const adelantosMercSum = adelantosFiltered
    .filter(ad => ad.concepto.startsWith('Adelanto Merc'))
    .reduce((acc, curr) => acc + parseFloat(curr.monto || 0), 0);

  // Final total shift sales revenue
  const totalSum = 
    parseFloat(efectivo || 0) + 
    Object.values(digitalValues).reduce((acc, curr) => acc + parseFloat(curr || 0), 0) + 
    comprasSum + 
    adelantosEfectivoSum + 
    adelantosMercSum;

  // Bill counter confirm
  const handleConfirmBilletes = () => {
    let sum = 0;
    billDenominations.forEach(den => {
      sum += (billCounts[den] || 0) * den;
    });
    setEfectivo(sum);
    setShowBilletes(false);
  };

  // Calculator confirm
  const handleOpenCalculator = (targetName) => {
    setCalcTarget(targetName);
    setCalcInput('');
    
    // Sum from current value if saved value > 0
    const currentVal = getConceptValue(targetName);

    setCalcItems(currentVal > 0 ? [currentVal] : []);
    setShowCalculator(true);
  };

  const handleAddCalcItem = (e) => {
    e.preventDefault();
    const val = parseFloat(calcInput);
    if (!isNaN(val) && val > 0) {
      setCalcItems(prev => [...prev, val]);
      setCalcInput('');
    }
  };

  const handleConfirmCalculator = () => {
    const sum = calcItems.reduce((a, b) => a + b, 0);
    setConceptValue(calcTarget, sum);
    setShowCalculator(false);
  };

  // Create new merchandise advance
  const handleSaveMercAdvance = async (e) => {
    e.preventDefault();
    const val = parseFloat(newMercMonto);
    if (!newMercEmpleado) {
      alert("Por favor seleccione un empleado.");
      return;
    }
    if (isNaN(val) || val <= 0) {
      alert("Por favor ingrese un monto válido mayor a 0.");
      return;
    }

    setSavingMerc(true);
    try {
      const finalObs = `[Caja: ${turno}]${newMercObs.trim() ? ' ' + newMercObs.trim() : ''}`;
      const res = await db.saveAdelanto({
        empleado: newMercEmpleado,
        concepto: 'Adelanto Merc',
        monto: val,
        observacion: finalObs
      });
      if (res.success) {
        setNewMercMonto('');
        setNewMercObs('');
        setShowAddMerc(false);
        // Reload list
        const updatedAdelantos = await db.getPendingAdelantos();
        setPendingAdelantos(updatedAdelantos);
      }
    } catch (err) {
      console.error("Error saving merchandise advance:", err);
    } finally {
      setSavingMerc(false);
    }
  };

  // Create new cash advance on-the-fly
  const handleSaveEfecAdvance = async (e) => {
    e.preventDefault();
    const val = parseFloat(newEfecMonto);
    if (!newEfecEmpleado) {
      alert("Por favor seleccione un empleado.");
      return;
    }
    if (isNaN(val) || val <= 0) {
      alert("Por favor ingrese un monto válido mayor a 0.");
      return;
    }

    setSavingEfec(true);
    try {
      const finalObs = `[Caja: ${turno}]${newEfecObs.trim() ? ' ' + newEfecObs.trim() : ''}`;
      const res = await db.saveAdelanto({
        empleado: newEfecEmpleado,
        concepto: 'Adelanto $',
        monto: val,
        observacion: finalObs
      });
      if (res.success) {
        setNewEfecMonto('');
        setNewEfecObs('');
        setShowAddEfec(false);
        // Reload list
        const updatedAdelantos = await db.getPendingAdelantos();
        setPendingAdelantos(updatedAdelantos);
      }
    } catch (err) {
      console.error("Error saving cash advance:", err);
    } finally {
      setSavingEfec(false);
    }
  };

  // Submit Closure Form
  const handleSubmitCierre = async (e) => {
    e.preventDefault();

    // Prevent closing shifts for future dates
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    if (fecha > todayStr) {
      alert("No se pueden registrar cierres de caja para fechas futuras.");
      return;
    }

    if (efectivo === 0 && totalSum === 0) {
      if (!window.confirm("¿Deseas guardar un cierre con todos los valores en $0?")) {
        return;
      }
    }

    setSaveStatus('loading');
    setErrorMsg('');
    try {
      const res = await db.saveCierre({
        fecha,
        turno,
        efectivo,
        digitalValues,
        adelantos_efectivo: adelantosEfectivoSum,
        adelantos_merc: adelantosMercSum,
        compras: comprasSum,
        total: totalSum
      }, comprasFiltered.map(c => c.id), adelantosFiltered.map(ad => ad.id));

      if (res.success) {
        setSaveStatus('success');
        // Clear inputs
        setEfectivo(0);
        const resetVals = {};
        cierreConceptos.forEach(c => {
          resetVals[c.id] = 0;
        });
        setDigitalValues(resetVals);
        
        setTimeout(() => {
          setSaveStatus('');
          loadData();
        }, 1500);
      } else {
        throw new Error("No se pudo registrar el cierre.");
      }
    } catch (err) {
      setSaveStatus('error');
      setErrorMsg(err.message || 'Error de red o base de datos.');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const closedTurnos = (() => {
    return ultimosCierres.filter(c => isSameLocalDate(c.fecha, fecha)).map(c => c.turno);
  })();

  const isCurrentTurnoClosed = closedTurnos.includes(turno);
  const allShiftsClosed = turnosDisponibles.length > 0 && turnosDisponibles.every(t => closedTurnos.includes(t));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      
      {/* 1. Main Card - Form closure */}
      <div className="page-card" style={{ borderLeft: `5px solid ${accentColor || '#3b82f6'}`, position: 'relative' }}>
        
        {/* Navigation Back */}
        {/* Navigation Back (Removed per user request) */}

        <h2 className="page-title text-dark">
          <i className="bi bi-currency-dollar text-primary"></i> Cerrar Caja
        </h2>

        <form onSubmit={handleSubmitCierre} noValidate style={{ marginTop: '20px' }}>
          
          {/* Metadata: Fecha y Turno */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', marginBottom: '25px', backgroundColor: '#f8fafc', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
              <label className="form-label fw-bold">Fecha del Cierre</label>
              <input 
                type="date" 
                className="form-input" 
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
              <label className="form-label fw-bold">Turno / Caja</label>
              <select 
                className="form-select"
                value={turno}
                onChange={(e) => setTurno(e.target.value)}
                required
              >
                {turnosDisponibles.map(t => {
                  const isClosed = closedTurnos.includes(t);
                  return (
                    <option key={t} value={t} disabled={isClosed}>
                      {t} {isClosed ? '(Cerrado)' : ''}
                    </option>
                  );
                })}
              </select>
              {allShiftsClosed && (
                <div style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '6px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <i className="bi bi-exclamation-triangle"></i> Todos los turnos cerrados
                </div>
              )}
            </div>
          </div>

          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Conceptos de Ventas e Ingresos
          </h4>

          {/* Grid of Concept Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            
            {/* EFECTIVO */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label fw-bold small text-dark">Efectivo en Caja</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '42px', backgroundColor: '#e2e8f0', color: '#475569' }}>
                    <i className="bi bi-cash-coin" style={{ fontSize: '1.2rem' }}></i>
                  </span>
                  <input 
                    type="number" 
                    step="1" 
                    className="form-input" 
                    placeholder="0"
                    value={efectivo || ''}
                    onChange={(e) => setEfectivo(parseFloat(e.target.value) || 0)}
                    onKeyDown={handleNumericKeyDown}
                    style={{ border: 'none', margin: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                    required
                  />
                </div>
                <button 
                  type="button" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#10b981', color: 'white', padding: '0 15px', border: 'none' }}
                  onClick={() => setShowBilletes(true)}
                  title="Contador de billetes físico"
                >
                  <i className="bi bi-calculator-fill me-1"></i> Billetes
                </button>
              </div>
            </div>

            {/* Dynamic concepts that are enabled */}
            {cierreConceptos.filter(c => c.enabled).map(concept => (
              <div key={concept.id} className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold small text-dark">{concept.label}</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '42px', backgroundColor: '#e2e8f0', color: '#475569' }}>
                      <i className={`bi ${conceptIcons[concept.id] || 'bi-currency-dollar'}`} style={{ fontSize: '1.1rem' }}></i>
                    </span>
                    <input 
                      type="number" 
                      step="1" 
                      className="form-input" 
                      placeholder="0"
                      value={getConceptValue(concept.id) || ''}
                      onChange={(e) => setConceptValue(concept.id, parseFloat(e.target.value) || 0)}
                      onKeyDown={handleNumericKeyDown}
                      style={{ border: 'none', margin: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                    />
                  </div>
                  <button 
                    type="button" 
                    className="btn-new-task" 
                    style={{ backgroundColor: '#3b82f6', color: 'white', padding: '0 12px', border: 'none' }}
                    onClick={() => handleOpenCalculator(concept.id)}
                  >
                    <i className="bi bi-plus-lg"></i>
                  </button>
                </div>
              </div>
            ))}

          </div>

          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginTop: '30px', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Salidas, Compras e Imputaciones de Caja
          </h4>

          {/* Dynamic lists for Compras and Adelantos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* 1. COMPRAS */}
            {formasPago.includes('Caja') && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold small text-dark">Compras / Pagos</label>
              <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#eff6ff' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '42px', backgroundColor: '#dbeafe', color: '#1e40af' }}>
                  <i className="bi bi-cart-fill" style={{ fontSize: '1.1rem' }}></i>
                </span>
                <input 
                  type="number" 
                  className="form-input" 
                  value={comprasSum}
                  style={{ border: 'none', margin: 0, backgroundColor: 'transparent', fontWeight: 'bold', color: '#1e40af' }}
                  readOnly
                />
              </div>

              {/* List of pending compras */}
              <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {loadingLists ? (
                  <div className="small text-muted italic">Cargando...</div>
                ) : comprasFiltered.length > 0 ? (
                  comprasFiltered.map(g => (
                    <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', margin: 0, fontSize: '0.85rem' }}>
                      <span style={{ flex: 1 }}><strong>{g.proveedor}</strong> - {g.detalle}</span>
                      <strong style={{ color: '#1e40af' }}>$ {g.total}</strong>
                    </div>
                  ))
                ) : (
                  <div className="small text-muted italic">No hay compras entregadas por esta caja.</div>
                )}
              </div>
              </div>
            )}

            {/* 2. ADELANTOS EFECTIVO ($) */}
            {config.allow_adelantos !== false && config.allow_dinero && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold small text-dark">Adelantos en efectivo</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#eff6ff' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '42px', backgroundColor: '#dbeafe', color: '#1e40af' }}>
                      <i className="bi bi-person-down" style={{ fontSize: '1.1rem' }}></i>
                    </span>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={adelantosEfectivoSum}
                      style={{ border: 'none', margin: 0, backgroundColor: 'transparent', fontWeight: 'bold', color: '#1e40af' }}
                      readOnly
                    />
                  </div>
                  <button 
                    type="button" 
                    className="btn-new-task" 
                    style={{ backgroundColor: '#3b82f6', color: 'white', padding: '0 15px', border: 'none' }}
                    onClick={handleOpenEfecModal}
                    title="Cargar nuevo adelanto en efectivo"
                  >
                    <i className="bi bi-plus-lg me-1"></i> Cargar Efec.
                  </button>
                </div>

                {/* List of pending cash advances */}
                <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {loadingLists ? (
                    <div className="small text-muted italic">Cargando...</div>
                  ) : adelantosFiltered.filter(ad => ad.concepto.startsWith('Adelanto $')).length > 0 ? (
                    adelantosFiltered.filter(ad => ad.concepto.startsWith('Adelanto $')).map(ad => (
                      <div key={ad.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', margin: 0, fontSize: '0.85rem' }}>
                        <span style={{ flex: 1 }}>
                          <strong>{ad.empleado}</strong> - Adelanto en Efectivo {(() => {
                            const obs = ad.concepto.substring('Adelanto $'.length).replace(/^ - /, '').trim();
                            return obs ? `(${obs})` : '';
                          })()}
                        </span>
                        <strong style={{ color: '#1e40af' }}>$ {ad.monto}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="small text-muted italic">No hay adelantos en efectivo entregados por esta caja.</div>
                  )}
                </div>
              </div>
            )}

            {/* 3. ADELANTOS MERCADERÍA (MERC) */}
            {config.allow_adelantos !== false && config.allow_mercaderia && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold small text-dark">Adelantos en mercaderia</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ display: 'flex', flex: 1, border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#eff6ff' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '42px', backgroundColor: '#dbeafe', color: '#1e40af' }}>
                      <i className="bi bi-bag-fill" style={{ fontSize: '1.1rem' }}></i>
                    </span>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={adelantosMercSum}
                      style={{ border: 'none', margin: 0, backgroundColor: 'transparent', fontWeight: 'bold', color: '#1e40af' }}
                      readOnly
                    />
                  </div>
                  <button 
                    type="button" 
                    className="btn-new-task" 
                    style={{ backgroundColor: '#3b82f6', color: 'white', padding: '0 15px', border: 'none' }}
                    onClick={handleOpenMercModal}
                    title="Cargar nuevo retiro de mercadería"
                  >
                    <i className="bi bi-plus-lg me-1"></i> Cargar Merc.
                  </button>
                </div>

                {/* List of pending merchandise advances */}
                <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {loadingLists ? (
                    <div className="small text-muted italic">Cargando...</div>
                  ) : adelantosFiltered.filter(ad => ad.concepto.startsWith('Adelanto Merc')).length > 0 ? (
                    adelantosFiltered.filter(ad => ad.concepto.startsWith('Adelanto Merc')).map(ad => (
                      <div key={ad.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', margin: 0, fontSize: '0.85rem' }}>
                        <span style={{ flex: 1 }}>
                          <strong>{ad.empleado}</strong> - Retiro Mercadería {(() => {
                            const obs = ad.concepto.substring('Adelanto Merc'.length).replace(/^ - /, '').trim();
                            return obs ? `(${obs})` : '';
                          })()}
                        </span>
                        <strong style={{ color: '#1e40af' }}>$ {ad.monto}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="small text-muted italic">No hay retiros de mercadería entregados por esta caja.</div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Sum Total metrics box */}
          <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#f1f5f9', borderRadius: '12px', border: '1px solid #cbd5e1', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '15px' }}>
            <div>
              <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                TOTAL ARQUEADO / TURNOS:
              </span>
              <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text-dark)' }}>
                $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(totalSum)}
              </div>
            </div>
            
            <button 
              type="submit" 
              className="btn-submit" 
              style={{ minWidth: '220px', padding: '14px', fontSize: '1.05rem', margin: 0, backgroundColor: '#3b82f6' }}
              disabled={saveStatus === 'loading' || isCurrentTurnoClosed || !turno}
            >
              {saveStatus === 'loading' ? (
                <span><i className="bi bi-hourglass-split me-2"></i>Registrando...</span>
              ) : (
                <span><i className="bi bi-check-circle-fill me-2"></i>REGISTRAR CIERRE DE CAJA</span>
              )}
            </button>
          </div>

          {/* Success / Error Messages */}
          {saveStatus === 'success' && (
            <div className="alert-box-success" style={{ marginTop: '15px' }}>
              <i className="bi bi-check-circle-fill"></i>
              <div>Cierre registrado correctamente en la base de datos y rendiciones.</div>
            </div>
          )}

          {saveStatus === 'error' && (
            <div className="alert-box" style={{ marginTop: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
              <i className="bi bi-exclamation-triangle-fill"></i>
              <div><strong>Error al guardar:</strong> {errorMsg}</div>
            </div>
          )}

        </form>
      </div>

      {/* 2. Side Card - Last 10 Closures list */}
      <div className="page-card" style={{ borderLeft: '5px solid #64748b' }}>
        <h3 className="section-title" style={{ fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <i className="bi bi-clock-history me-2 text-secondary"></i>Últimos Cierres Registrados
        </h3>
        
        <div style={{ overflowX: 'auto', marginTop: '15px' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', color: 'var(--text-muted)' }}>
                <th 
                  style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSortCierres('fecha')}
                >
                  Fecha {cierreSortField === 'fecha' && (cierreSortAsc ? '▴' : '▾')}
                </th>
                <th 
                  style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)' }}
                >
                  Hora
                </th>
                <th 
                  style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSortCierres('turno')}
                >
                  Turno/Caja {cierreSortField === 'turno' && (cierreSortAsc ? '▴' : '▾')}
                </th>
                <th 
                  style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSortCierres('efectivo')}
                >
                  Efectivo {cierreSortField === 'efectivo' && (cierreSortAsc ? '▴' : '▾')}
                </th>
                <th 
                  style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSortCierres('total')}
                >
                  Total {cierreSortField === 'total' && (cierreSortAsc ? '▴' : '▾')}
                </th>
              </tr>
            </thead>
            <tbody>
              {getSortedCierres().length > 0 ? (
                getSortedCierres().map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px' }}>
                      {new Date(c.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {new Date(c.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span 
                        style={{ 
                          display: 'inline-block', 
                          padding: '3px 8px', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 'bold',
                          ...getTurnoBadgeStyle(c.turno)
                        }}
                      >
                        {c.turno}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '500', color: '#10b981' }}>
                      $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(c.efectivo)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold' }}>
                      $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(c.total)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="text-center text-muted" style={{ padding: '20px', fontStyle: 'italic' }}>
                    No hay cierres registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================== */}
      {/* MODALS SECTION                                                 */}
      {/* ============================================================== */}

      {/* MODAL: BILL COUNTER */}
      {showBilletes && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '420px' }}>
            <div className="modal-header" style={{ backgroundColor: '#10b981' }}>
              <h5 className="modal-title" style={{ color: 'white' }}><i className="bi bi-calculator me-2"></i>Contador de Billetes</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowBilletes(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '15px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                
                <div style={{ display: 'flex', borderBottom: '2px solid #cbd5e1', paddingBottom: '6px', fontWeight: 'bold', fontSize: '0.8rem', color: '#475569' }}>
                  <span style={{ flex: '1 1 100px' }}>Billete</span>
                  <span style={{ flex: '1 1 120px', textAlign: 'center' }}>Cantidad</span>
                  <span style={{ flex: '1 1 100px', textAlign: 'right' }}>Subtotal</span>
                </div>

                {billDenominations.map(den => (
                  <div key={den} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <strong style={{ flex: '1 1 100px', fontSize: '0.9rem' }}>$ {new Intl.NumberFormat('es-AR').format(den)}</strong>
                    <input 
                      type="number"
                      min="0"
                      className="form-input"
                      value={billCounts[den] || ''}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        setBillCounts(prev => ({ ...prev, [den]: val }));
                      }}
                      placeholder="0"
                      style={{ flex: '1 1 120px', textAlign: 'center', height: '34px', margin: 0, padding: '4px' }}
                    />
                    <span style={{ flex: '1 1 100px', textAlign: 'right', fontWeight: '600', fontSize: '0.9rem' }}>
                      $ {new Intl.NumberFormat('es-AR').format((billCounts[den] || 0) * den)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total bills sum */}
              <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#e8f5e9', borderRadius: '8px', border: '1px solid #a5d6a7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small text-muted font-bold text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Total Efectivo:</span>
                <strong style={{ fontSize: '1.35rem', color: '#1b5e20' }}>
                  $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(
                    billDenominations.reduce((acc, curr) => acc + (billCounts[curr] || 0) * curr, 0)
                  )}
                </strong>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button 
                  type="button" 
                  className="btn-cancel" 
                  style={{ flex: 1, padding: '10px', margin: 0 }}
                  onClick={() => setShowBilletes(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  className="btn-submit" 
                  style={{ backgroundColor: '#10b981', flex: 1, padding: '10px', margin: 0 }}
                  onClick={handleConfirmBilletes}
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SUMMING CALCULATOR */}
      {showCalculator && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '380px' }}>
            <div className="modal-header" style={{ backgroundColor: '#3b82f6' }}>
              <h5 className="modal-title" style={{ color: 'white' }}><i className="bi bi-calculator me-2"></i>Calculadora Sumadora</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowCalculator(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '15px' }}>
              
              <form onSubmit={handleAddCalcItem} noValidate style={{ display: 'flex', gap: '6px', marginBottom: '15px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 10px', backgroundColor: '#fff', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}>
                  <span style={{ color: '#64748b', fontWeight: 'bold', marginRight: '6px' }}>$</span>
                  <input 
                    type="number"
                    step="1"
                    className="form-input"
                    placeholder="Monto a sumar..."
                    value={calcInput}
                    onChange={(e) => setCalcInput(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    style={{ border: 'none', outline: 'none', padding: '8px 0', fontSize: '1rem', width: '100%', margin: 0, backgroundColor: 'transparent', boxShadow: 'none' }}
                    autoFocus
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn-submit" 
                  style={{ backgroundColor: '#3b82f6', margin: 0, width: '38px', height: '38px', padding: 0, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  title="Agregar monto"
                >
                  <i className="bi bi-plus-lg" style={{ fontSize: '1.1rem' }}></i>
                </button>
              </form>

              {/* Items Sum list */}
              <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', backgroundColor: '#f8fafc' }}>
                {calcItems.length > 0 ? (
                  calcItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px', paddingTop: '4px' }}>
                      <span>Monto #{idx + 1}</span>
                      <strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(item)}
                        <i 
                          className="bi bi-trash text-danger" 
                          style={{ cursor: 'pointer' }}
                          onClick={() => setCalcItems(prev => prev.filter((_, i) => i !== idx))}
                        ></i>
                      </strong>
                    </div>
                  ))
                ) : (
                  <div className="small text-muted italic text-center py-2">Lista vacía. Ingrese valores arriba.</div>
                )}
              </div>

              {/* Calculator Total sum */}
              <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small text-muted font-bold text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Total Sumado:</span>
                <strong style={{ fontSize: '1.35rem', color: '#1e3a8a' }}>
                  $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(calcItems.reduce((a,b) => a + b, 0))}
                </strong>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button 
                  type="button" 
                  className="btn-cancel" 
                  style={{ flex: 1, padding: '10px', margin: 0 }}
                  onClick={() => setShowCalculator(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  className="btn-submit" 
                  style={{ backgroundColor: '#3b82f6', flex: 1, padding: '10px', margin: 0 }}
                  onClick={handleConfirmCalculator}
                >
                  Aceptar
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD MERCHANDISE ADVANCE */}
      {showAddMerc && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ backgroundColor: '#eab308' }}>
              <h5 className="modal-title" style={{ color: 'white' }}><i className="bi bi-bag-plus me-2"></i>Retiro de Mercadería</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowAddMerc(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '15px' }}>
              <form onSubmit={handleSaveMercAdvance} noValidate>
                
                <div className="form-group">
                  <label className="form-label fw-bold">Empleado</label>
                  <select 
                    className="form-select"
                    value={newMercEmpleado}
                    onChange={(e) => setNewMercEmpleado(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar empleado...</option>
                    {empleados.map(emp => (
                      <option key={emp} value={emp}>{emp}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label fw-bold">Monto ($)</label>
                  <input 
                    type="number" 
                    step="1" 
                    className="form-input" 
                    placeholder="Monto retirado..."
                    value={newMercMonto}
                    onChange={(e) => setNewMercMonto(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label fw-bold">Detalle / Observación</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: Jugos, Yerba, etc."
                    value={newMercObs}
                    onChange={(e) => setNewMercObs(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button 
                    type="button" 
                    className="btn-cancel" 
                    style={{ flex: 1, padding: '10px', margin: 0 }}
                    onClick={() => setShowAddMerc(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#eab308', flex: 1, padding: '10px', margin: 0 }}
                    disabled={savingMerc}
                  >
                    {savingMerc ? 'Cargando...' : 'Registrar Retiro'}
                  </button>
                </div>

              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD CASH ADVANCE */}
      {showAddEfec && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ backgroundColor: '#eab308' }}>
              <h5 className="modal-title" style={{ color: 'white' }}><i className="bi bi-person-plus me-2"></i>Adelanto en Efectivo</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowAddEfec(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '15px' }}>
              <form onSubmit={handleSaveEfecAdvance} noValidate>
                
                <div className="form-group">
                  <label className="form-label fw-bold">Empleado</label>
                  <select 
                    className="form-select"
                    value={newEfecEmpleado}
                    onChange={(e) => setNewEfecEmpleado(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar empleado...</option>
                    {empleados.map(emp => (
                      <option key={emp} value={emp}>{emp}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label fw-bold">Monto ($)</label>
                  <input 
                    type="number" 
                    step="1" 
                    className="form-input" 
                    placeholder="Monto adelanto..."
                    value={newEfecMonto}
                    onChange={(e) => setNewEfecMonto(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label fw-bold">Detalle / Observación</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Observaciones..."
                    value={newEfecObs}
                    onChange={(e) => setNewEfecObs(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button 
                    type="button" 
                    className="btn-cancel" 
                    style={{ flex: 1, padding: '10px', margin: 0 }}
                    onClick={() => setShowAddEfec(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#eab308', flex: 1, padding: '10px', margin: 0 }}
                    disabled={savingEfec}
                  >
                    {savingEfec ? 'Cargando...' : 'Registrar Adelanto'}
                  </button>
                </div>

              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default Cierre;
