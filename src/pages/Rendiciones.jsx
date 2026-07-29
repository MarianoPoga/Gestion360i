import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../supabaseClient';
import { hasModulePermission, normalizeRoleKey } from '../rolePermissions';
import { DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels';

function Rendiciones({ navigate, profile, accentColor }) {
  const [rendiciones, setRendiciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ debe: 0, haber: 0, saldo: 0 });
  const [lastWithdrawal, setLastWithdrawal] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [withdrawForm, setWithdrawForm] = useState({ concepto: '', monto: '' });
  const [depositForm, setDepositForm] = useState({ concepto: '', monto: '' });
  const [saving, setSaving] = useState(false);

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME
  });

  const [rolePermissions, setRolePermissions] = useState(null);

  const canWithdraw = useMemo(() => {
    if (!profile) return false;
    if (normalizeRoleKey(profile.role) === 'admin') return true;
    const modules = JSON.parse(localStorage.getItem('enabled_modules') || '{}');
    return hasModulePermission(rolePermissions, profile, 'rendiciones', modules);
  }, [profile, rolePermissions]);

  useEffect(() => {
    const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}"}`);
    setRendConfig(loadedRendConfig);
    db.getRolePermissions().then((perms) => {
      if (perms) setRolePermissions(perms);
    });
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, totalsData] = await Promise.all([
        db.getRendiciones(50),
        db.getRendicionesSaldo()
      ]);
      setRendiciones(list || []);
      if (totalsData) {
        setTotals(totalsData);
      }

      // Find the absolute latest "Retiro total" to show in the UI
      // We might need to fetch it separately if it's outside the current list
      const latest = await db.getLatestRetiroTotal();
      setLastWithdrawal(latest);
    } catch (err) {
      console.error("Error loading rendiciones:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawal = async (e) => {
    if (e) e.preventDefault();
    if (!withdrawForm.monto || parseFloat(withdrawForm.monto) <= 0) return;
    
    setSaving(true);
    try {
      const mov = {
        fecha: new Date().toISOString(),
        concepto: withdrawForm.concepto || 'Retiro de efectivo',
        categoria: 'Retiro',
        debe: 0,
        haber: parseFloat(withdrawForm.monto),
        usuario: profile?.full_name || 'Usuario'
      };
      const res = await db.saveRendicion(mov);
      if (res.success) {
        setWithdrawForm({ concepto: '', monto: '' });
        setShowWithdrawModal(false);
        loadData();
      } else {
        alert("Error al registrar el retiro: " + res.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!depositForm.monto || parseFloat(depositForm.monto) <= 0) return;
    
    setSaving(true);
    try {
      const mov = {
        fecha: new Date().toISOString(),
        concepto: depositForm.concepto || 'Ingreso manual',
        categoria: 'Ingreso',
        debe: parseFloat(depositForm.monto),
        haber: 0,
        usuario: profile?.full_name || 'Usuario'
      };
      const res = await db.saveRendicion(mov);
      if (res.success) {
        setDepositForm({ concepto: '', monto: '' });
        setShowDepositModal(false);
        loadData();
      } else {
        alert("Error al registrar el ingreso: " + res.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleWithdrawAll = async () => {
    if (totals.saldo <= 0) {
      alert("No hay saldo para retirar.");
      return;
    }
    if (window.confirm(`¿Seguro que deseas retirar todo el saldo (${formatMoney(totals.saldo)})?\nEsto reiniciará los totales de ingresos y egresos.`)) {
      setSaving(true);
      try {
        const mov = {
          fecha: new Date().toISOString(),
          concepto: 'Retiro total',
          categoria: 'Retiro',
          debe: 0,
          haber: totals.saldo,
          usuario: profile?.full_name || 'Usuario'
        };
        const res = await db.saveRendicion(mov);
        if (res.success) {
          loadData();
        } else {
          alert("Error al vaciar el saldo: " + res.error);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
      }
    }
  };

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '';
    }
    return sortConfig.direction === 'asc' ? ' ▴' : ' ▾';
  };

  const sortedRendiciones = useMemo(() => {
    let sortableItems = [...rendiciones];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        if (sortConfig.key === 'debe' || sortConfig.key === 'haber') {
          aVal = parseFloat(aVal) || 0;
          bVal = parseFloat(bVal) || 0;
        } else if (sortConfig.key === 'fecha') {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        } else {
          aVal = String(aVal || '').toLowerCase();
          bVal = String(bVal || '').toLowerCase();
        }

        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [rendiciones, sortConfig]);

  const totalDebe = totals.debe;
  const totalHaber = totals.haber;
  const saldo = totals.saldo;

  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
  };

  return (
    <div className="page-card" style={{ borderLeft: '5px solid ' + (accentColor || '#10b981') }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 className="page-title text-dark" style={{ margin: 0 }}>
          <i className="bi bi-safe2 me-2" style={{ color: accentColor || '#10b981' }}></i> {rendConfig.caja_nombre}
        </h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-success px-4 rounded-pill fw-bold shadow-sm" onClick={() => setShowDepositModal(true)}>
            <i className="bi bi-plus-circle me-2"></i> Ingresar Dinero
          </button>
          {canWithdraw && (
            <button className="btn btn-danger px-4 rounded-pill fw-bold shadow-sm" onClick={() => setShowWithdrawModal(true)}>
              <i className="bi bi-box-arrow-up me-2"></i> Retirar Dinero
            </button>
          )}
        </div>
      </div>

      {/* Summary Row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
          <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>SALDO ACTUAL</span>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: '#166534' }}>{formatMoney(saldo)}</div>
        </div>
        <div style={{ flex: '0.8', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
          <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>TOTAL INGRESOS</span>
          <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#1e293b' }}>{formatMoney(totalDebe)}</div>
        </div>
        <div style={{ flex: '0.8', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
          <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>TOTAL EGRESOS</span>
          <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#1e293b' }}>{formatMoney(totalHaber)}</div>
        </div>
      </div>

      {/* Last Withdrawal Info */}
      {lastWithdrawal && (
        <div style={{ 
          marginBottom: '25px', 
          padding: '12px 20px', 
          backgroundColor: '#fff7ed', 
          border: '1px solid #ffedd5', 
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#9a3412',
          fontSize: '0.9rem'
        }}>
          <i className="bi bi-info-circle-fill" style={{ fontSize: '1.1rem' }}></i>
          <span>
            <strong>Último vaciado de caja:</strong> {new Date(lastWithdrawal.fecha).toLocaleDateString('es-AR')} a las {new Date(lastWithdrawal.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} ({formatMoney(lastWithdrawal.haber)})
          </span>
        </div>
      )}

      {/* Movements Table */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '15px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 'bold', color: '#1e293b' }}>Historial de Movimientos</h4>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left', backgroundColor: '#e2e8f0', color: '#1e293b' }}>
                <th style={{ padding: '12px 15px', cursor: 'pointer', userSelect: 'none' }} onClick={() => requestSort('fecha')}>
                  Fecha{getSortIcon('fecha')}
                </th>
                <th style={{ padding: '12px 15px', cursor: 'pointer', userSelect: 'none' }} onClick={() => requestSort('concepto')}>
                  Concepto{getSortIcon('concepto')}
                </th>
                <th style={{ padding: '12px 15px', cursor: 'pointer', userSelect: 'none' }} onClick={() => requestSort('categoria')}>
                  Categoría{getSortIcon('categoria')}
                </th>
                <th style={{ padding: '12px 15px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => requestSort('debe')}>
                  Ingreso (+){getSortIcon('debe')}
                </th>
                <th style={{ padding: '12px 15px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => requestSort('haber')}>
                  Egreso (-){getSortIcon('haber')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>Cargando datos...</td></tr>
              ) : sortedRendiciones.length === 0 ? (
                <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>No hay movimientos registrados.</td></tr>
              ) : sortedRendiciones.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 15px' }}>{new Date(item.fecha).toLocaleDateString('es-AR')}</td>
                  <td style={{ padding: '12px 15px', fontWeight: '500' }}>{item.concepto}</td>
                  <td style={{ padding: '12px 15px' }}>
                    <span className="badge" style={{ 
                      backgroundColor: item.categoria === 'Ventas' ? '#dcfce7' : item.categoria === 'Retiro' ? '#fee2e2' : item.categoria === 'Ingreso' ? '#dcfce7' : item.categoria === 'Personal' ? '#fef9c3' : '#f1f5f9',
                      color: item.categoria === 'Ventas' ? '#166534' : item.categoria === 'Retiro' ? '#991b1b' : item.categoria === 'Ingreso' ? '#166534' : item.categoria === 'Personal' ? '#854d0e' : '#475569',
                      fontSize: '0.75rem', padding: '2px 8px'
                    }}>{item.categoria}</span>
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'right', color: '#166534', fontWeight: 'bold' }}>
                    {item.debe > 0 ? formatMoney(item.debe) : '-'}
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc2626', fontWeight: 'bold' }}>
                    {item.haber > 0 ? formatMoney(item.haber) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Retiro */}
      {showWithdrawModal && (
        <div className="modal-overlay">
          <div className="modal-content-card animate__animated animate__zoomIn" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h5 className="modal-title fw-bold">Retirar de {rendConfig.caja_nombre}</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowWithdrawModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body p-4">
              <form onSubmit={handleWithdrawal}>
                <div className="form-group mb-3">
                  <label className="form-label small fw-bold">Detalle / Motivo</label>
                  <input type="text" className="form-input" required placeholder="Ej: Pago de flete, Retiro dueño..." value={withdrawForm.concepto} onChange={e => setWithdrawForm({...withdrawForm, concepto: e.target.value})} />
                </div>
                <div className="form-group mb-4">
                  <label className="form-label small fw-bold">Monto a Retirar ($)</label>
                  <input type="number" step="100" className="form-input fw-bold" style={{ fontSize: '1.25rem' }} required placeholder="0.00" value={withdrawForm.monto} onChange={e => setWithdrawForm({...withdrawForm, monto: e.target.value})} />
                </div>
                <button type="submit" className="btn-submit py-3 fw-bold rounded-pill" disabled={saving} style={{ backgroundColor: '#dc2626' }}>
                  {saving ? 'Registrando...' : 'CONFIRMAR RETIRO'}
                </button>
                <div className="mt-3 text-center">
                  <button type="button" className="btn btn-link text-danger text-decoration-none fw-bold small" onClick={() => {
                    setShowWithdrawModal(false);
                    handleWithdrawAll();
                  }}>
                    <i className="bi bi-trash3 me-1"></i> RETIRAR TODO EL SALDO ({formatMoney(totals.saldo)})
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ingreso */}
      {showDepositModal && (
        <div className="modal-overlay">
          <div className="modal-content-card animate__animated animate__zoomIn" style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ backgroundColor: '#10b981' }}>
              <h5 className="modal-title fw-bold">Ingresar a {rendConfig.caja_nombre}</h5>
              <button type="button" className="modal-close-btn" onClick={() => setShowDepositModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body p-4">
              <form onSubmit={handleDeposit}>
                <div className="form-group mb-3">
                  <label className="form-label small fw-bold">Detalle / Concepto</label>
                  <input type="text" className="form-input" required placeholder="Ej: Carga inicial, Refuerzo de caja..." value={depositForm.concepto} onChange={e => setDepositForm({...depositForm, concepto: e.target.value})} />
                </div>
                <div className="form-group mb-4">
                  <label className="form-label small fw-bold">Monto a Ingresar ($)</label>
                  <input type="number" step="100" className="form-input fw-bold" style={{ fontSize: '1.25rem' }} required placeholder="0.00" value={depositForm.monto} onChange={e => setDepositForm({...depositForm, monto: e.target.value})} />
                </div>
                <button type="submit" className="btn-submit py-3 fw-bold rounded-pill" disabled={saving} style={{ backgroundColor: '#10b981' }}>
                  {saving ? 'Registrando...' : 'CONFIRMAR INGRESO'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Rendiciones;
