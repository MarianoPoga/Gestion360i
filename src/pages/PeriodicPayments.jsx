import React, { useState, useEffect } from 'react';
import { db } from '../supabaseClient';
import { MODULE_LABELS } from '../moduleLabels';
import {
  PERIODIC_SUBGROUPS,
  buildFullSubgroup,
  normalizePeriodicPayment,
  resolvePaymentSubgroupId,
  sortPeriodicPayments,
} from '../periodicPaymentsDefaults';

const isSinFacturaType = (tipo) => String(tipo || '').toLowerCase() === 'sin factura';

const parseConceptosDesglose = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const matchesPeriodicPaymentName = (compra, paymentName) => {
  const target = paymentName.toLowerCase().trim();
  if (!target) return false;

  const detalle = (compra.detalle || '').toLowerCase().trim();
  if (detalle === target || detalle.includes(target)) return true;

  return parseConceptosDesglose(compra.conceptos_desglose).some((item) => {
    const concept = String(item.concepto || item.nombre || '')
      .toLowerCase()
      .trim();
    return concept === target || concept.includes(target);
  });
};

const PeriodicPayments = ({
  navigate,
  accentColor,
  embedded = false,
  viewMode: controlledViewMode,
  onViewModeChange,
  hideHeader = false,
  onRegisterPayment,
}) => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({
    '2.1': true,
    '2.2': true,
    '2.3': true,
    '2.4': true,
    '2.5': true,
    '2.6': true,
    '2.7': true,
  });
  const [showModal, setShowModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [isFixedGroup, setIsFixedGroup] = useState(false);
  const [internalViewMode, setInternalViewMode] = useState('simulation');
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = (mode) => {
    if (onViewModeChange) onViewModeChange(mode);
    if (controlledViewMode === undefined) setInternalViewMode(mode);
  };
  const [purchases, setPurchases] = useState([]);
  const [showPaymentInfo, setShowPaymentInfo] = useState(null);
  
  // Form states
  const [nombre, setNombre] = useState('');
  const [subgrupo, setSubgrupo] = useState('2.1');
  const [monto, setMonto] = useState('');
  const [diaVencimiento, setDiaVencimiento] = useState('10');
  const [tipoFactura, setTipoFactura] = useState('Factura C');
  const [iva, setIva] = useState('21');
  const [medioPago, setMedioPago] = useState('Banco');
  const [observaciones, setObservaciones] = useState('');
  const [periodicidad, setPeriodicidad] = useState('Mensual');
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const subgroups = PERIODIC_SUBGROUPS;

  useEffect(() => {
    fetchPayments();
    fetchPurchases();
  }, []);

  const fetchPurchases = async () => {
    // Fetch last 365 days of purchases to build the simulation
    const data = await db.getCompras(365);
    setPurchases(data);
  };

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const data = await db.getPagosPeriodicos();
      const normalized = (Array.isArray(data) ? data : []).map(normalizePeriodicPayment);
      setPayments(sortPeriodicPayments(normalized));
    } catch (error) {
      console.error('Error loading pagos periódicos:', error);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  const getGroupPayments = (groupId) =>
    payments.filter((payment) => resolvePaymentSubgroupId(payment) === groupId);

  const toggleGroup = (id) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenModal = (payment = null) => {
    if (payment) {
      setEditingPayment(payment);
      setNombre(payment.nombre);
      setSubgrupo(payment.subgrupo ? payment.subgrupo.split(' ')[0] : '');
      setMonto(payment.monto_mensual || '');
      setDiaVencimiento(payment.dia_vencimiento || '10');
      setTipoFactura(payment.tipo_factura || 'Factura C');
      setIva(payment.iva_alicuota || '21');
      setMedioPago(payment.medio_pago || 'Banco');
      setObservaciones(payment.observaciones || '');
      setPeriodicidad(payment.periodicidad || 'Mensual');
      setIsFixedGroup(true); // Don't allow changing group when editing
    } else {
      setEditingPayment(null);
      setNombre('');
      setMonto('');
      setDiaVencimiento('10');
      setTipoFactura('Factura C');
      setIva('21');
      setMedioPago('Banco');
      setObservaciones('');
      setPeriodicidad('Mensual');
      // subgrupo is already set if coming from handleQuickAdd
    }
    setShowModal(true);
  };

  const handleQuickAdd = (groupId) => {
    setSubgrupo(groupId);
    setIsFixedGroup(true);
    handleOpenModal();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    // Extract the ID if the subgrupo state already contains the full name (e.g., "2.1. Personal")
    const cleanId = subgrupo.includes('.') ? subgrupo.split('.')[0] + '.' + subgrupo.split('.')[1] : subgrupo;
    const subgroupMatch = subgroups.find(s => s.id === cleanId || s.id === subgrupo);
    const subgroupName = subgroupMatch?.name || '';
    const fullSubgroup = subgroupMatch ? `${subgroupMatch.id}. ${subgroupMatch.name}` : subgrupo;

    const payload = {
      id: editingPayment?.id,
      nombre,
      subgrupo: fullSubgroup,
      monto_mensual: parseFloat(monto) || 0,
      dia_vencimiento: parseInt(diaVencimiento),
      tipo_factura: tipoFactura,
      iva_alicuota: parseFloat(iva),
      medio_pago: medioPago,
      observaciones: observaciones,
      periodicidad,
      estado_valor: editingPayment?.estado_valor || 'VALOR ESTIMADO',
      orden: editingPayment?.orden ?? 0
    };

    const res = await db.savePagoPeriodico(payload);
    if (res.success) {
      setShowModal(false);
      setIsFixedGroup(false);
      fetchPayments();
    } else {
      alert("Error al guardar: " + res.error);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de eliminar este pago periódico?")) {
      const res = await db.deletePagoPeriodico(id);
      if (res.success) fetchPayments();
    }
  };

  const handleCorroborar = async (payment) => {
    const newVal = prompt("Corroborar monto para este mes:", payment.monto_mensual);
    if (newVal !== null) {
      const res = await db.updatePagoPeriodicoStatus(payment.id, {
        monto_mensual: parseFloat(newVal),
        estado_valor: 'VALOR CORROBORADO'
      });
      if (res.success) fetchPayments();
    }
  };

  const handlePagar = async (payment, monthIdx) => {
    // Construct the date for the selected month
    const currentYear = new Date().getFullYear();
    const day = payment.dia_vencimiento || 10;
    const paymentDate = new Date(currentYear, monthIdx, day);

    if (isSinFacturaType(payment.tipo_factura)) {
      const payload = {
        periodicPayment: {
          ...payment,
          monto: payment.monto_mensual || 0,
          detalle: payment.nombre,
          fecha_sugerida: paymentDate.toISOString(),
        },
      };
      if (onRegisterPayment) {
        onRegisterPayment(payload.periodicPayment);
        return;
      }
      navigate('pago-impuestos', payload);
    } else {
      // Navigate to Compras with the payment item in the state
      navigate('compras', { 
        periodicPayment: {
          ...payment,
          monto: payment.monto_mensual || 0,
          detalle: payment.nombre,
          fecha_sugerida: paymentDate.toISOString()
        }
      });
    }
  };

  const getStatusColor = (payment) => {
    const today = new Date();
    const lastPaid = payment.ultimo_pago_fecha ? new Date(payment.ultimo_pago_fecha) : null;
    
    // Check if paid this month
    const isPaidThisMonth = lastPaid && 
      lastPaid.getMonth() === today.getMonth() && 
      lastPaid.getFullYear() === today.getFullYear();

    if (isPaidThisMonth) return '#10b981'; // Green (Success)
    
    if (payment.estado_valor === 'VALOR CORROBORADO') return '#3b82f6'; // Blue (Info/Checked)
    
    return '#f59e0b'; // Orange (Warning/Estimated)
  };

  const getStatusText = (payment) => {
    const today = new Date();
    const lastPaid = payment.ultimo_pago_fecha ? new Date(payment.ultimo_pago_fecha) : null;
    const isPaidThisMonth = lastPaid && 
      lastPaid.getMonth() === today.getMonth() && 
      lastPaid.getFullYear() === today.getFullYear();

    if (isPaidThisMonth) return 'PAGADO';
    return payment.estado_valor;
  };

  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const getPaymentStatusForCell = (paymentName, monthIdx, fortnight) => {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Check if there is a purchase for this item in this month/fortnight
    const paymentPurchases = purchases.filter(compra => {
      const fechaCompra = new Date(compra.fecha);
      if (fechaCompra.getFullYear() !== currentYear) return false;
      if (fechaCompra.getMonth() !== monthIdx) return false;
      
      const day = fechaCompra.getDate();
      const inFortnight = (fortnight === 0) ? true : (fortnight === 1 ? day <= 15 : day > 15);
      if (!inFortnight) return false;

      // Check in detail or breakdown
      return matchesPeriodicPaymentName(compra, paymentName);
    });

    if (paymentPurchases.length > 0) {
      return { status: 'paid', data: paymentPurchases[0] };
    }

    // If not paid, and it's in the past or current month, it's 'pending'
    const cellDate = new Date(currentYear, monthIdx, fortnight === 1 ? 1 : 16);
    if (cellDate < today) {
      return { status: 'pending', data: null };
    }

    return { status: 'future', data: null };
  };

  const handleDragStart = (e, item) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    // Visual feedback for dragging
    e.currentTarget.style.opacity = '0.4';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedItem(null);
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDragLeave = (e) => {
    setDragOverId(null);
  };

  const handleDrop = async (e, targetItem) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedItem || draggedItem.id === targetItem.id) return;

    // Only allow reordering within the same subgroup
    if (draggedItem.subgrupo !== targetItem.subgrupo) return;

    // Get group items and sort them by current order to match visual order
    const groupItems = payments
      .filter(p => p.subgrupo === targetItem.subgrupo)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.nombre.localeCompare(b.nombre));
    
    const newItems = [...groupItems];
    
    const draggedIdx = newItems.findIndex(p => p.id === draggedItem.id);
    const targetIdx = newItems.findIndex(p => p.id === targetItem.id);
    
    if (draggedIdx === -1 || targetIdx === -1) return;

    newItems.splice(draggedIdx, 1);
    newItems.splice(targetIdx, 0, draggedItem);
    
    // Assign fresh 'orden' indices based on new position
    const updatedItems = newItems.map((item, index) => ({
      ...item,
      orden: index
    }));

    // Update local state for immediate feedback
    const otherPayments = payments.filter(p => p.subgrupo !== targetItem.subgrupo);
    const finalPayments = [...otherPayments, ...updatedItems];
    setPayments(finalPayments);

    // Save to database - MUST include all NOT NULL fields for upsert to work correctly in some environments
    try {
      const res = await db.updatePagosOrden(updatedItems.map(p => ({
        id: p.id,
        business_id: p.business_id,
        subgrupo: p.subgrupo,
        nombre: p.nombre,
        orden: p.orden,
        monto_mensual: p.monto_mensual,
        dia_vencimiento: p.dia_vencimiento,
        periodicidad: p.periodicidad,
        tipo_factura: p.tipo_factura,
        medio_pago: p.medio_pago,
        iva_alicuota: p.iva_alicuota,
        estado_valor: p.estado_valor,
        activo: p.activo
      })));
      if (!res.success) alert("Error al guardar el orden: " + res.error);
    } catch (err) {
      console.error("Error saving order:", err);
    }
  };

  const wrapperStyle = embedded
    ? { padding: 0, border: 'none', boxShadow: 'none', background: 'transparent' }
    : { borderLeft: '5px solid ' + (accentColor || '#6366f1'), padding: '15px' };

  return (
    <div className="page-card" style={wrapperStyle}>
      {!hideHeader && (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px' }}>
        <h2 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="bi bi-calendar-check-fill" style={{ color: accentColor || '#6366f1' }}></i>
          {MODULE_LABELS['pagos-periodicos']}
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="btn btn-sm btn-outline-secondary" 
            onClick={() => setViewMode(viewMode === 'simulation' ? 'list' : 'simulation')}
            style={{ fontSize: '0.75rem' }}
          >
            {viewMode === 'simulation' ? 'Vista Lista' : 'Vista Calendario'}
          </button>
        </div>
      </div>
      )}

      {viewMode === 'list' ? (
        <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {subgroups.map(group => {
          const groupPayments = getGroupPayments(group.id);
          const isExpanded = expandedGroups[group.id];

          return (
            <div key={group.id} className="card border-0 shadow-sm mb-4" style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              <div 
                className="card-header bg-white d-flex justify-content-between align-items-center" 
                style={{ cursor: 'pointer', padding: '15px 20px', borderBottom: isExpanded ? '1px solid #f1f5f9' : 'none' }}
              >
                <div onClick={() => toggleGroup(group.id)} className="d-flex align-items-center flex-grow-1">
                  <span style={{ backgroundColor: '#1e40af', color: 'white', padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold', marginRight: '12px' }}>{group.id}</span>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: '#334155' }}>{group.name}</h3>
                  <span className="badge bg-light text-muted ms-2" style={{ fontSize: '0.8rem' }}>
                    {groupPayments.length} {groupPayments.length === 1 ? 'ítem' : 'ítems'}
                  </span>
                  <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} ms-auto me-3`} style={{ color: '#64748b' }}></i>
                </div>
                <button 
                  className="btn btn-sm btn-outline-primary rounded-circle" 
                  onClick={() => handleQuickAdd(group.id)}
                  title="Agregar nuevo ítem a este grupo"
                  style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <i className="bi bi-plus-lg"></i>
                </button>
              </div>

              {isExpanded && (
                <div style={{ padding: '0' }}>
                  {groupPayments.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem', fontStyle: 'italic', backgroundColor: '#fcfcfc' }}>
                      No hay ítems en este grupo. 
                      <button className="btn btn-link btn-sm" onClick={() => handleQuickAdd(group.id)}>Agregar uno</button>
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fff', borderBottom: '1px solid #f1f5f9' }}>
                            <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Nombre / Concepto</th>
                            <th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Venc.</th>
                            <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Monto</th>
                            <th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Estado</th>
                            <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupPayments.map(p => {
                            const statusColor = getStatusColor(p);
                            const statusText = getStatusText(p);
                            const isPaid = statusText === 'PAGADO';

                            return (
                              <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.2s' }} className="hover-row">
                                <td style={{ padding: '16px 20px' }}>
                                  <div style={{ fontWeight: '600', color: '#1e293b' }}>{p.nombre}</div>
                                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{p.medio_pago} • {p.tipo_factura}</div>
                                </td>
                                <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '0.9rem', color: '#475569', fontWeight: '500' }}>Día {p.dia_vencimiento}</div>
                                </td>
                                <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                  <div style={{ fontSize: '1rem', fontWeight: '700', color: statusColor }}>
                                    ${p.monto_mensual?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                  </div>
                                </td>
                                <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                  <span style={{ 
                                    backgroundColor: `${statusColor}15`, 
                                    color: statusColor, 
                                    padding: '4px 10px', 
                                    borderRadius: '20px', 
                                    fontSize: '0.7rem', 
                                    fontWeight: '800',
                                    border: `1px solid ${statusColor}30`,
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {statusText}
                                  </span>
                                </td>
                                <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    {!isPaid && (
                                      <>
                                        <button 
                                          title="Corroborar monto"
                                          onClick={() => handleCorroborar(p)}
                                          style={{ border: 'none', background: '#eff6ff', color: '#3b82f6', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                        >
                                          <i className="bi bi-check2-circle"></i>
                                        </button>
                                        <button 
                                          title="Registrar Pago"
                                          onClick={() => handlePagar(p)}
                                          style={{ border: 'none', background: '#ecfdf5', color: '#10b981', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                        >
                                          <i className="bi bi-cash-stack"></i>
                                        </button>
                                      </>
                                    )}
                                    <button 
                                      title="Editar"
                                      onClick={() => handleOpenModal(p)}
                                      style={{ border: 'none', background: '#f8fafc', color: '#64748b', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                    >
                                      <i className="bi bi-pencil"></i>
                                    </button>
                                    <button 
                                      title="Dar de baja"
                                      onClick={() => handleDelete(p.id)}
                                      style={{ border: 'none', background: '#fff1f2', color: '#f43f5e', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                    >
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>
      ) : (
        /* SIMULATION VIEW */
        <div style={{ backgroundColor: 'white', borderRadius: '15px', border: '1px solid #e2e8f0', overflow: 'hidden', padding: '1px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 12px', borderRight: '2px solid #e2e8f0', minWidth: '150px', backgroundColor: 'white', position: 'sticky', left: 0, zIndex: 2 }}>Ítem / Mes</th>
                  {months.map(m => (
                    <th key={m} colSpan="2" style={{ textAlign: 'center', padding: '5px', borderRight: '1px solid #e2e8f0', minWidth: '60px', fontSize: '0.65rem' }}>
                      {m.substring(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subgroups.map(group => {
                  const groupPayments = getGroupPayments(group.id);
                  
                  if (groupPayments.length === 0) return null;
                  const isExpanded = expandedGroups[group.id] !== false; // Default to expanded

                  // Calculate totals for the group per month/fortnight
                  const groupTotals = months.map((_, mIdx) => {
                    const q1Total = groupPayments.reduce((sum, p) => {
                      const res = getPaymentStatusForCell(p.nombre, mIdx, 1);
                      return sum + (res.data?.total || 0);
                    }, 0);
                    const q2Total = groupPayments.reduce((sum, p) => {
                      const res = getPaymentStatusForCell(p.nombre, mIdx, 2);
                      return sum + (res.data?.total || 0);
                    }, 0);
                    return { q1: q1Total, q2: q2Total, total: q1Total + q2Total };
                  });

                  return (
                    <React.Fragment key={group.id}>
                      <tr 
                        style={{ backgroundColor: '#f1f5f9', cursor: 'pointer' }}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <td style={{ padding: '8px 12px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem', borderBottom: '1px solid #e2e8f0', position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-2`}></i>
                            {group.id}. {group.name}
                          </div>
                          <button 
                            className="btn btn-sm p-0 px-1" 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSubgrupo(group.id); 
                              setNombre('');
                              setMonto('');
                              setEditingPayment(null);
                              setIsFixedGroup(true); 
                              setShowModal(true); 
                            }}
                            style={{ color: '#6366f1', fontSize: '1rem' }}
                            title="Agregar ítem a este grupo"
                          >
                            <i className="bi bi-plus-circle-fill"></i>
                          </button>
                        </td>
                        {groupTotals.map((tot, mIdx) => (
                          <td 
                            key={`tot-${group.id}-${mIdx}`} 
                            colSpan="2" 
                            style={{ textAlign: 'center', padding: '4px', fontWeight: '800', color: '#1e293b', fontSize: '0.65rem', borderRight: '1px solid #e2e8f0', backgroundColor: '#f1f5f9' }}
                          >
                            {tot.total > 0 ? `$${tot.total.toLocaleString()}` : '-'}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && groupPayments.map(p => {
                        const isQuincenal = p.periodicidad === 'Quincenal';
                        
                        return (
                          <tr 
                            key={p.id} 
                            style={{ 
                              borderBottom: '1px solid #f1f5f9',
                              backgroundColor: dragOverId === p.id ? '#f0f9ff' : (draggedItem?.id === p.id ? '#f8fafc' : 'transparent'),
                              borderTop: dragOverId === p.id ? '2px solid #6366f1' : 'none',
                              opacity: draggedItem?.id === p.id ? 0.5 : 1,
                              transition: 'all 0.2s ease'
                            }} 
                            className="hover-row"
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, p)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, p.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, p)}
                          >
                            <td 
                              style={{ 
                                padding: '6px 12px', 
                                borderRight: '2px solid #e2e8f0', 
                                fontWeight: '600', 
                                color: '#334155', 
                                backgroundColor: dragOverId === p.id ? '#f0f9ff' : 'white', 
                                position: 'sticky', 
                                left: 0, 
                                zIndex: 1, 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                gap: '4px' 
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, overflow: 'hidden' }}>
                                <i 
                                  className="bi bi-grip-vertical text-muted" 
                                  style={{ cursor: 'grab', fontSize: '1rem', padding: '2px' }}
                                ></i>
                                <span 
                                  onClick={() => handleOpenModal(p)} 
                                  className="hover-name" 
                                  style={{ cursor: 'pointer', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                  {p.nombre}
                                </span>
                              </div>
                              <button 
                                onClick={() => handleDelete(p.id)}
                                style={{ border: 'none', background: 'transparent', color: '#f43f5e', padding: '2px', cursor: 'pointer', fontSize: '0.8rem' }}
                                title="Eliminar"
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </td>
                            {months.map((_, mIdx) => {
                              if (!isQuincenal) {
                                const status = getPaymentStatusForCell(p.nombre, mIdx, 0);
                                const displayValue = status.data?.total || p.monto_mensual || 0;

                                return (
                                  <td 
                                    key={`${p.id}-${mIdx}`}
                                    colSpan="2"
                                    onClick={() => status.status === 'paid' ? setShowPaymentInfo(status.data) : handlePagar(p, mIdx)}
                                    style={{ 
                                      padding: '2px', 
                                      borderRight: '1px solid #e2e8f0', 
                                      backgroundColor: status.status === 'paid' ? '#10b981' : (status.status === 'pending' ? '#ef4444' : 'transparent'),
                                      color: (status.status === 'paid' || status.status === 'pending') ? 'white' : '#94a3b8',
                                      textAlign: 'center',
                                      fontSize: '0.6rem',
                                      fontWeight: '800',
                                      opacity: status.status === 'future' ? 0.3 : 1,
                                      cursor: 'pointer',
                                      minHeight: '28px'
                                    }}
                                    title={status.data ? `Pagado: $${status.data.total}` : (status.status === 'pending' ? 'Hacer clic para pagar' : '')}
                                  >
                                    {displayValue > 0 ? `$${displayValue.toLocaleString()}` : ''}
                                  </td>
                                );
                              } else {
                                const q1 = getPaymentStatusForCell(p.nombre, mIdx, 1);
                                const q2 = getPaymentStatusForCell(p.nombre, mIdx, 2);
                                const v1 = q1.data?.total || (p.monto_mensual / 2) || 0;
                                const v2 = q2.data?.total || (p.monto_mensual / 2) || 0;

                                return (
                                  <React.Fragment key={`${p.id}-${mIdx}`}>
                                    <td 
                                      onClick={() => q1.status === 'paid' ? setShowPaymentInfo(q1.data) : handlePagar(p, mIdx)}
                                      style={{ 
                                        padding: '2px', 
                                        borderRight: '1px solid #f1f5f9', 
                                        backgroundColor: q1.status === 'paid' ? '#10b981' : (q1.status === 'pending' ? '#ef4444' : 'transparent'),
                                        color: (q1.status === 'paid' || q1.status === 'pending') ? 'white' : '#94a3b8',
                                        textAlign: 'center',
                                        fontSize: '0.55rem',
                                        fontWeight: '800',
                                        opacity: q1.status === 'future' ? 0.3 : 1,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      {v1 > 0 ? `$${v1.toLocaleString()}` : ''}
                                    </td>
                                    <td 
                                      onClick={() => q2.status === 'paid' ? setShowPaymentInfo(q2.data) : handlePagar(p, mIdx)}
                                      style={{ 
                                        padding: '2px', 
                                        borderRight: '1px solid #e2e8f0', 
                                        backgroundColor: q2.status === 'paid' ? '#10b981' : (q2.status === 'pending' ? '#ef4444' : 'transparent'),
                                        color: (q2.status === 'paid' || q2.status === 'pending') ? 'white' : '#94a3b8',
                                        textAlign: 'center',
                                        fontSize: '0.55rem',
                                        fontWeight: '800',
                                        opacity: q2.status === 'future' ? 0.3 : 1,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      {v2 > 0 ? `$${v2.toLocaleString()}` : ''}
                                    </td>
                                  </React.Fragment>
                                );
                              }
                            })}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '15px 20px', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '20px', fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#10b981', borderRadius: '3px' }}></div>
              <span>Pagado</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#ef4444', borderRadius: '3px' }}></div>
              <span>Pendiente</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '3px' }}></div>
              <span>Próximo / Sin gasto</span>
            </div>
            <div style={{ marginLeft: 'auto', color: '#94a3b8' }}>
              * Q1: Primera quincena (1-15) | Q2: Segunda quincena (16-fin)
            </div>
          </div>
        </div>
      )}

      {/* Modal Form */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '16px', width: '90%', maxWidth: '500px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>{editingPayment ? 'Editar Pago' : 'Nuevo Pago Periódico'}</h3>
              <button onClick={() => { setShowModal(false); setIsFixedGroup(false); }} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
            </div>
            <form onSubmit={handleSave} style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Nombre del Pago</label>
                  <input 
                    className="form-input" 
                    value={nombre} 
                    onChange={(e) => setNombre(e.target.value)} 
                    placeholder="Ej: Alquiler Local, Edesur..." 
                    required 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Categoría</label>
                  <select 
                    className="form-select" 
                    value={subgrupo} 
                    onChange={(e) => setSubgrupo(e.target.value)}
                    disabled={isFixedGroup}
                    style={isFixedGroup ? { backgroundColor: '#f1f5f9', cursor: 'not-allowed' } : {}}
                  >
                    {subgroups.map(s => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Periodicidad</label>
                  <select className="form-select" value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)}>
                    <option value="Mensual">Mensual</option>
                    <option value="Quincenal">Quincenal</option>
                    <option value="Bimestral">Bimestral</option>
                    <option value="Anual">Anual</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Monto Sugerido ($)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={monto} 
                    onChange={(e) => setMonto(e.target.value)} 
                    placeholder="0.00" 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Día Vencimiento</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="31" 
                    className="form-input" 
                    value={diaVencimiento} 
                    onChange={(e) => setDiaVencimiento(e.target.value)} 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Tipo Factura</label>
                  <select className="form-select" value={tipoFactura} onChange={(e) => setTipoFactura(e.target.value)}>
                    <option value="Factura A">Factura A</option>
                    <option value="Factura B">Factura B</option>
                    <option value="Factura C">Factura C</option>
                    <option value="Ticket">Ticket</option>
                    <option value="Sin factura">Sin factura</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Medio Pago</label>
                  <select className="form-select" value={medioPago} onChange={(e) => setMedioPago(e.target.value)}>
                    <option value="Débito Automático">Débito Automático</option>
                    <option value="VEP">VEP</option>
                    <option value="Efectivo (Caja)">Efectivo (Caja)</option>
                    <option value="Banco / Transferencia">Banco / Transferencia</option>
                    <option value="Rendición">Rendición (Caja Fuerte)</option>
                    <option value="Tarjeta Crédito">Tarjeta Crédito</option>
                    <option value="Tarjeta Débito">Tarjeta Débito</option>
                    <option value="Mercado Pago">Mercado Pago</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>Observaciones</label>
                  <textarea 
                    className="form-input" 
                    rows="2"
                    value={observaciones} 
                    onChange={(e) => setObservaciones(e.target.value)} 
                    placeholder="Notas adicionales..." 
                    style={{ resize: 'none' }}
                  />
                </div>
              </div>
              <div style={{ marginTop: '30px', display: 'flex', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => { setShowModal(false); setIsFixedGroup(false); }}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontWeight: '600', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#1e40af', color: 'white', fontWeight: '600', cursor: 'pointer' }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Info Modal */}
      {showPaymentInfo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(2px)' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', width: '90%', maxWidth: '400px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: '700' }}>Detalle del Pago</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.9rem' }}>
              <div className="d-flex justify-content-between"><span className="text-muted">Fecha:</span> <strong>{new Date(showPaymentInfo.fecha).toLocaleDateString()}</strong></div>
              <div className="d-flex justify-content-between"><span className="text-muted">Concepto:</span> <strong>{showPaymentInfo.detalle}</strong></div>
              <div className="d-flex justify-content-between"><span className="text-muted">Total:</span> <strong className="text-success" style={{ fontSize: '1.2rem' }}>${showPaymentInfo.total?.toLocaleString()}</strong></div>
              <div className="d-flex justify-content-between"><span className="text-muted">Proveedor:</span> <strong>{showPaymentInfo.proveedor || showPaymentInfo.proveedor_nombre || '-'}</strong></div>
              <div className="d-flex justify-content-between"><span className="text-muted">Nro Factura:</span> <strong>{showPaymentInfo.nro_factura}</strong></div>
            </div>
            <button 
              className="btn btn-primary w-100 mt-4" 
              onClick={() => setShowPaymentInfo(null)}
              style={{ borderRadius: '8px', padding: '10px' }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .hover-row:hover { background-color: #f8fafc; }
        .hover-name:hover { background-color: #f1f5f9 !important; color: #1e40af !important; text-decoration: underline; }
        .form-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .form-input:focus { border-color: #3b82f6; }
        .form-select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 0.9rem;
          outline: none;
          background-color: white;
        }
      `}} />
    </div>
  );
};

export default PeriodicPayments;
