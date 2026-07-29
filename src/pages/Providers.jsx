import React, { useState, useEffect } from 'react';
import { db } from '../supabaseClient';
import { MODULE_LABELS } from '../moduleLabels';

function Providers() {
  const [view, setView] = useState('saldos'); // 'saldos' or 'detalle'
  const [loading, setLoading] = useState(true);
  const [saldosData, setSaldosData] = useState({ listaSaldos: [], totalGlobalDeuda: 0 });
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [history, setHistory] = useState({ movimientos: [], total: 0 });
  const [showPagoModal, setShowPagoModal] = useState(false);
  const [pagoForm, setPagoForm] = useState({ monto: '', medio: 'Transferencia', observaciones: '', fecha_pago: new Date().toISOString().split('T')[0] });
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    loadSaldos();
  }, []);

  const loadSaldos = async () => {
    setLoading(true);
    const data = await db.getProveedoresSaldos();
    setSaldosData(data);
    setLoading(false);
  };

  const handleSelectProvider = async (nombre) => {
    setLoading(true);
    setSelectedProvider(nombre);
    const data = await db.getHistorialProveedor(nombre);
    setHistory(data);
    setView('detalle');
    setLoading(false);
  };

  const handleOpenPago = () => {
    setPagoForm({ ...pagoForm, monto: history.total > 0 ? history.total : '' });
    setShowPagoModal(true);
  };

  const handleSavePago = async (e) => {
    e.preventDefault();
    setSaveStatus('saving');
    const res = await db.saveProveedorPago({
      proveedor_nombre: selectedProvider,
      monto: parseFloat(pagoForm.monto),
      medio_pago: pagoForm.medio,
      observaciones: pagoForm.observaciones,
      fecha_pago: pagoForm.fecha_pago
    });

    if (res.success) {
      setSaveStatus('success');
      setTimeout(async () => {
        setShowPagoModal(false);
        setSaveStatus('');
        const data = await db.getHistorialProveedor(selectedProvider);
        setHistory(data);
      }, 1500);
    } else {
      setSaveStatus('error');
      alert("Error: " + res.error);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  };

  if (loading && view === 'saldos') {
    return <div className="p-5 text-center"><div className="spinner-border text-success"></div></div>;
  }

  return (
    <div className="page-container p-4">
      {view === 'saldos' ? (
        <div className="animate__animated animate__fadeIn">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 className="page-title m-0">
              <i className="bi bi-truck text-success me-2"></i> {MODULE_LABELS.proveedores}
            </h2>
          </div>

          <div className="row mb-4">
            <div className="col-md-4">
              <div className="card bg-success text-white shadow-sm border-0 p-4" style={{ borderRadius: '15px' }}>
                <div className="small opacity-75 text-uppercase fw-bold">Total Deuda Global</div>
                <div className="fs-1 fw-bold">{formatCurrency(saldosData.totalGlobalDeuda)}</div>
              </div>
            </div>
          </div>

          <div className="card shadow-sm border-0" style={{ borderRadius: '15px', overflow: 'hidden' }}>
            <div className="card-header bg-white py-3 border-0">
              <h5 className="m-0 fw-bold text-secondary">Saldos por Proveedor</h5>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="bg-light text-secondary">
                  <tr>
                    <th className="px-4">Proveedor</th>
                    <th className="text-end px-4">Saldo Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {saldosData.listaSaldos.length === 0 ? (
                    <tr><td colSpan="2" className="text-center py-4 text-muted">No hay deudas pendientes</td></tr>
                  ) : (
                    saldosData.listaSaldos.map((p, idx) => (
                      <tr key={idx} onClick={() => handleSelectProvider(p.nombre)} style={{ cursor: 'pointer' }}>
                        <td className="px-4 fw-bold">{p.nombre}</td>
                        <td className={`text-end px-4 fw-bold fs-5 ${p.saldo > 0 ? 'text-danger' : 'text-success'}`}>
                          {formatCurrency(p.saldo)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="animate__animated animate__fadeIn">
          <button className="btn btn-link text-decoration-none text-secondary p-0 mb-4" onClick={() => { setView('saldos'); loadSaldos(); }}>
            <i className="bi bi-arrow-left me-1"></i> Volver a saldos
          </button>

          <div className="d-flex justify-content-between align-items-start mb-4">
            <div>
              <h2 className="fw-bold m-0 text-dark">{selectedProvider}</h2>
              <div className={`fs-3 fw-bold ${history.total > 0 ? 'text-danger' : 'text-success'}`}>
                Saldo: {formatCurrency(history.total)}
              </div>
            </div>
            <button className="btn btn-success btn-lg px-4 shadow-sm" onClick={handleOpenPago} style={{ borderRadius: '12px' }}>
              <i className="bi bi-cash-stack me-2"></i> Registrar Pago
            </button>
          </div>

          <div className="card shadow-sm border-0" style={{ borderRadius: '15px', overflow: 'hidden' }}>
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead className="bg-light">
                  <tr>
                    <th className="px-4">Fecha</th>
                    <th>Detalle</th>
                    <th className="text-end">Monto</th>
                    <th className="text-end px-4">Saldo Acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {history.movimientos.map((m, idx) => (
                    <tr key={idx} className={m.tipo === 'PAGO' ? 'table-success' : ''}>
                      <td className="px-4 small text-muted">{new Date(m.fecha).toLocaleDateString()}</td>
                      <td>
                        <div className="fw-bold">{m.detalle}</div>
                        <span className={`badge ${m.tipo === 'PAGO' ? 'bg-success' : 'bg-warning'} small`}>
                          {m.tipo}
                        </span>
                      </td>
                      <td className={`text-end fw-bold ${m.tipo === 'PAGO' ? 'text-success' : 'text-danger'}`}>
                        {m.tipo === 'PAGO' ? '-' : ''}{formatCurrency(Math.abs(m.monto))}
                      </td>
                      <td className="text-end px-4 fw-bold">{formatCurrency(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pago */}
      {showPagoModal && (
        <div className="modal-backdrop fade show d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}>
          <div className="modal-dialog shadow-lg" style={{ width: '450px', backgroundColor: 'white', borderRadius: '20px', overflow: 'hidden' }}>
            <div className="modal-header p-4 border-0 pb-0 d-flex justify-content-between align-items-center">
              <h5 className="modal-title fw-bold">Registrar Pago a {selectedProvider}</h5>
              <button type="button" className="btn-close" onClick={() => setShowPagoModal(false)}></button>
            </div>
            <div className="modal-body p-4">
              <form onSubmit={handleSavePago}>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Monto del Pago</label>
                  <div className="input-group">
                    <span className="input-group-text">$</span>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control form-control-lg fw-bold text-success"
                      required
                      value={pagoForm.monto}
                      onChange={e => setPagoForm({ ...pagoForm, monto: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Medio de Pago</label>
                  <select className="form-select" value={pagoForm.medio} onChange={e => setPagoForm({ ...pagoForm, medio: e.target.value })}>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Tarjeta">Tarjeta</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Fecha de Pago</label>
                  <input type="date" className="form-control" value={pagoForm.fecha_pago} onChange={e => setPagoForm({ ...pagoForm, fecha_pago: e.target.value })} />
                </div>
                <div className="mb-4">
                  <label className="form-label small fw-bold">Observaciones</label>
                  <textarea className="form-control" rows="2" value={pagoForm.observaciones} onChange={e => setPagoForm({ ...pagoForm, observaciones: e.target.value })}></textarea>
                </div>

                {saveStatus === 'success' && <div className="alert alert-success">Pago registrado con éxito.</div>}
                
                <button type="submit" className="btn btn-success btn-lg w-100 fw-bold" disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Guardando...' : 'Confirmar Pago'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Providers;
