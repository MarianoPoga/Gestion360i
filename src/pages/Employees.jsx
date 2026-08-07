import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../supabaseClient';
import {
  normalizeRolePermissions,
  updateRoleLabel,
  ROLE_KEYS,
  DEFAULT_ROLE_LABELS,
  hasModulePermission,
} from '../rolePermissions';
import { MODULE_LABELS } from '../moduleLabels';

function Employees({ navigate, accentColor, profile, modules = {} }) {
  const [view, setView] = useState('list'); // 'list', 'detalle', 'edit'
  const [employees, setEmployees] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [history, setHistory] = useState([]);
  const [showMovModal, setShowMovModal] = useState(false);
  const [movForm, setMovForm] = useState({ concepto: '', monto: '', tipo: 'Debe', medio: 'Efectivo' });
  const [employeeForm, setEmployeeForm] = useState({ nombre: '', apodo: '', cuit: '', cbu: '', telefono: '', direccion: '', is_active: true });
  const [saveStatus, setSaveStatus] = useState('');
  const [accessErrorMessage, setAccessErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('nombre');
  const [sortAsc, setSortAsc] = useState(true);
  const [activeTab, setActiveTab] = useState('rrhh');
  const [showGuide, setShowGuide] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [accessForm, setAccessForm] = useState({ email: '', password: '', role: 'cajero', assigned_cajas: [] });
  const [roleOptions, setRoleOptions] = useState([]);
  const [roleLabels, setRoleLabels] = useState({ ...DEFAULT_ROLE_LABELS });
  const [rolePermissions, setRolePermissions] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const canAccessEmployees = useMemo(
    () => hasModulePermission(rolePermissions, profile, 'empleados', modules),
    [rolePermissions, profile, modules]
  );

  useEffect(() => {
    db.getRolePermissions().then((perms) => {
      if (perms) setRolePermissions(perms);
      setAccessChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!accessChecked) return;
    if (!canAccessEmployees) {
      navigate('adelantos');
    }
  }, [accessChecked, canAccessEmployees, navigate]);

  useEffect(() => {
    if (!canAccessEmployees) return;
    loadAllData();
  }, [canAccessEmployees]);

  const loadAllData = async () => {
    setListLoading(true);
    try {
      const [e, p, c, rp] = await Promise.all([
        db.getEmpleados(),
        db.getProfiles(),
        db.getCierreTurnoNames(),
        db.getRolePermissions()
      ]);
      setEmployees(e || []);
      setProfiles(p || []);
      setCajas(c || []);
      if (rp) {
        const normalized = normalizeRolePermissions(rp);
        setRoleLabels(normalized.roles);
        setRoleOptions(
          ROLE_KEYS.filter((k) => k !== 'admin').map((key) => ({
            value: key,
            label: normalized.roles[key] || DEFAULT_ROLE_LABELS[key],
          }))
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filteredEmployees = employees.filter(emp => 
    emp.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (emp.cuit && emp.cuit.includes(searchQuery))
  ).sort((a, b) => {
    let aVal = a[sortField] || '';
    let bVal = b[sortField] || '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSelectEmployee = async (emp) => {
    setDetailLoading(true);
    try {
      setSelectedEmployee(emp);
      const data = await db.getEmpleadoMovimientos(emp.id);
      setHistory(Array.isArray(data) ? data : []);

      const profile = profiles.find(p => p.employee_id === emp.id);
      if (profile) {
        setAccessForm({
          email: '',
          role: profile.role || 'cajero',
          assigned_cajas: profile.assigned_cajas || []
        });
      } else {
        setAccessForm({ email: '', password: '', role: 'cajero', assigned_cajas: [] });
      }

      setShowGuide(false);
      setView('detalle');
      setActiveTab('rrhh');
    } catch (err) {
      console.error('Error abriendo ficha de empleado:', err);
      alert('No se pudo abrir la ficha del empleado.');
    } finally {
      setDetailLoading(false);
    }
  };

  const [errorMessage, setErrorMessage] = useState('');

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    setSaveStatus('saving');
    setErrorMessage('');
    const res = await db.saveEmpleado(employeeForm);
    if (res.success) {
      setSaveStatus('success');
      setTimeout(() => {
        setView('list');
        loadAllData();
        setSaveStatus('');
      }, 1000);
    } else {
      setSaveStatus('error');
      setErrorMessage(res.error || 'Error desconocido al guardar');
    }
  };
  const handleUpdateExistingAccess = async () => {
    setDetailLoading(true);
    const res = await db.updateEmployeeAccess(selectedEmployee.id, accessForm.role, accessForm.assigned_cajas);
    if (res.success) {
      setSaveStatus('success');
      await loadAllData();
      setTimeout(() => setSaveStatus(''), 2000);
    } else {
      setSaveStatus('error');
    }
    setDetailLoading(false);
  };

  const handleCreateNewAccess = async (e) => {
    e.preventDefault();
    if (!accessForm.email || !accessForm.password) {
      alert("Email y Contraseña son obligatorios");
      return;
    }
    setDetailLoading(true);
    setAccessErrorMessage('');
    const res = await db.createEmployeeUser(
      accessForm.email, 
      accessForm.password, 
      selectedEmployee.nombre, 
      accessForm.role, 
      selectedEmployee.id
    );
    if (res.success) {
      setSaveStatus('success');
      setAccessForm({ email: '', password: '', role: accessForm.role, assigned_cajas: [] });
      await loadAllData();
      const profile = (await db.getProfiles()).find(p => p.employee_id === selectedEmployee.id);
      if (profile) {
        setAccessForm({
          email: '',
          role: profile.role || 'cajero',
          assigned_cajas: profile.assigned_cajas || [],
        });
      }
      if (res.needsEmailConfirmation) {
        setAccessErrorMessage('Usuario creado. Si Supabase exige confirmar email, el empleado debe confirmar el correo antes de ingresar.');
      }
      setTimeout(() => setSaveStatus(''), 3000);
    } else {
      setAccessErrorMessage(res.error || 'No se pudo crear el acceso');
      setSaveStatus('error');
    }
    setDetailLoading(false);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  };

  const calculateBalance = (movs) => {
    return movs.reduce((acc, curr) => acc + (parseFloat(curr.haber || 0) - parseFloat(curr.debe || 0)), 0);
  };

  if (!accessChecked || !canAccessEmployees) {
    return <div className="p-5 text-center"><div className="spinner-border text-primary"></div></div>;
  }

  if (listLoading && view === 'list') {
    return <div className="p-5 text-center"><div className="spinner-border text-primary"></div></div>;
  }
  return (
    <div className="page-card animate__animated animate__fadeIn" style={{ borderLeft: '5px solid #6610f2' }}>
      {/* TABS HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid var(--border-color)', paddingBottom: '12px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <i className="bi bi-person-badge" style={{ color: '#6610f2' }}></i>
          {view === 'list' ? MODULE_LABELS.empleados : view === 'detalle' ? 'Ficha de Empleado' : 'Editar Empleado'}
        </h2>
        
        <div className="flex-row-group">
          {view !== 'list' && (
            <button 
              className="btn-new-task" 
              style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
              onClick={() => setView('list')}
            >
              <i className="bi bi-arrow-left me-1"></i> Volver
            </button>
          )}
          {view === 'list' && (
            <button 
              className="btn-new-task" 
              style={{ backgroundColor: '#6610f2', color: 'white' }}
              onClick={() => { 
                setEmployeeForm({ nombre: '', apodo: '', cuit: '', cbu: '', telefono: '', direccion: '', is_active: true }); 
                setView('edit'); 
              }}
            >
              <i className="bi bi-plus-lg me-1"></i> Nuevo Empleado
            </button>
          )}
        </div>
      </div>

      {view === 'list' && (
        <div className="animate__animated animate__fadeIn">
          {/* Search and Filters */}
          <div style={{ 
            backgroundColor: 'var(--bg-light)', 
            padding: '15px', 
            borderRadius: '12px', 
            marginBottom: '20px',
            display: 'flex',
            gap: '15px',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <i className="bi bi-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}></i>
              <input 
                type="text" 
                className="form-input" 
                style={{ paddingLeft: '35px', margin: 0 }}
                placeholder="Buscar por nombre o CUIT..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="btn-group" style={{ backgroundColor: 'white', borderRadius: '8px', padding: '2px', border: '1px solid var(--border-color)' }}>
              <button 
                className={`btn btn-sm px-3 ${sortField === 'nombre' ? 'btn-primary' : 'btn-light text-muted'}`} 
                style={{ borderRadius: '6px', border: 'none' }}
                onClick={() => handleSort('nombre')}
              >
                Nombre
              </button>
              <button 
                className={`btn btn-sm px-3 ${sortField === 'is_active' ? 'btn-primary' : 'btn-light text-muted'}`} 
                style={{ borderRadius: '6px', border: 'none' }}
                onClick={() => handleSort('is_active')}
              >
                Estado
              </button>
            </div>
          </div>

          {/* Employee Table */}
          <div className="table-responsive" style={{ borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table className="table" style={{ margin: 0 }}>
              <thead style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border-color)' }}>
                <tr>
                  <th style={{ padding: '12px 15px', width: '60px' }}></th>
                  <th style={{ padding: '12px 15px' }}>Nombre / Apodo</th>
                  <th style={{ padding: '12px 15px' }}>CUIT / Identificación</th>
                  <th style={{ padding: '12px 15px', textAlign: 'center' }}>Nivel de Acceso</th>
                  <th style={{ padding: '12px 15px', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No se encontraron empleados.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map(emp => {
                    const profile = profiles.find(p => p.employee_id === emp.id);
                    return (
                      <tr key={emp.id} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px 15px' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                            <i className="bi bi-person-fill"></i>
                          </div>
                        </td>
                        <td style={{ padding: '10px 15px' }}>
                          <div className="fw-bold" style={{ color: 'var(--text-main)' }}>{emp.nombre}</div>
                          <div className="small text-muted">{emp.apodo || '-'}</div>
                        </td>
                        <td style={{ padding: '10px 15px' }}>
                          <span className="small font-monospace">{emp.cuit || 'Sin CUIT'}</span>
                        </td>
                        <td style={{ padding: '10px 15px', textAlign: 'center' }}>
                          {profile ? (
                            <span className="badge-tag" style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', textTransform: 'capitalize' }}>
                              <i className="bi bi-shield-lock-fill me-1"></i> {roleLabels[profile.role] || profile.role}
                            </span>
                          ) : (
                            <span className="badge-tag" style={{ backgroundColor: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1' }}>
                              Sin Acceso
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 15px', textAlign: 'center' }}>
                          <span className={`badge-tag ${emp.is_active ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}`} style={{ border: '1px solid transparent' }}>
                            {emp.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 15px', textAlign: 'right' }}>
                          <button 
                            className="btn btn-sm btn-light shadow-sm" 
                            style={{ borderRadius: '8px', padding: '5px 10px' }}
                            onClick={() => handleSelectEmployee(emp)}
                          >
                            Ver Ficha <i className="bi bi-chevron-right ms-1"></i>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'detalle' && selectedEmployee && (
        <div className="animate__animated animate__fadeIn">
          {detailLoading && (
            <div className="text-center py-2 mb-2">
              <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
            </div>
          )}
          {/* Header Ficha Simplificada */}
          <div style={{ display: 'flex', gap: '25px', marginBottom: '30px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '20px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6610f2', fontSize: '2rem' }}>
              <i className="bi bi-person-circle"></i>
            </div>
            <div style={{ flex: 1, minWidth: '250px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '5px' }}>
                <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.5rem' }}>{selectedEmployee.nombre}</h3>
                <span className={`badge-tag ${selectedEmployee.is_active ? 'bg-success' : 'bg-danger'} text-white`}>
                  {selectedEmployee.is_active ? 'ACTIVO' : 'INACTIVO'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                <span><i className="bi bi-tag me-1"></i> {selectedEmployee.apodo || 'Sin apodo'}</span>
                <span><i className="bi bi-card-text me-1"></i> {selectedEmployee.cuit || 'Sin CUIT'}</span>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={() => { setEmployeeForm(selectedEmployee); setView('edit'); }}>
                <i className="bi bi-pencil me-1"></i> Editar Perfil
              </button>
              <button 
                className={`btn btn-sm ${selectedEmployee.is_active ? 'btn-outline-danger' : 'btn-outline-success'} rounded-pill px-3`}
                onClick={async () => {
                  const res = await db.toggleEmpleadoActivo(selectedEmployee.id, !selectedEmployee.is_active);
                  if (res.success) {
                    setSelectedEmployee({...selectedEmployee, is_active: !selectedEmployee.is_active});
                    loadAllData();
                  }
                }}
              >
                {selectedEmployee.is_active ? 'Baja' : 'Reactivar'}
              </button>
            </div>
          </div>

          <div className="row g-4">
            {/* Columna Izquierda: Datos Personales */}
            <div className="col-lg-6">
              <h4 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '15px', color: '#334155' }}>
                <i className="bi bi-info-circle me-2"></i>Datos Personales
              </h4>
              <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <div className="row g-3">
                  {[
                    { label: 'Teléfono', value: selectedEmployee.telefono, icon: 'bi-telephone' },
                    { label: 'Dirección', value: selectedEmployee.direccion, icon: 'bi-geo-alt' },
                    { label: 'CBU / ALIAS', value: selectedEmployee.cbu, icon: 'bi-bank' },
                    { label: 'Fecha de Alta', value: selectedEmployee.created_at ? new Date(selectedEmployee.created_at).toLocaleDateString() : '-', icon: 'bi-calendar-check' }
                  ].map((item, i) => (
                    <div key={i} className="col-12">
                      <div className="d-flex align-items-center gap-3">
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6610f2', border: '1px solid #e2e8f0' }}>
                          <i className={`bi ${item.icon}`}></i>
                        </div>
                        <div>
                          <label className="small text-muted fw-bold d-block" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{item.label}</label>
                          <div className="fw-bold" style={{ fontSize: '0.95rem' }}>{item.value || '-'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Columna Derecha: Acceso al Sistema */}
            <div className="col-lg-6">
              <h4 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '15px', color: '#334155' }}>
                <i className="bi bi-shield-lock me-2"></i>Acceso al Sistema
              </h4>
              <div style={{ backgroundColor: '#f0f9ff', padding: '20px', borderRadius: '16px', border: '1px solid #bae6fd' }}>
                
                {/* Manual de Permisos / Role Guide (Collapsible) */}
                <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #bae6fd', marginBottom: '20px', overflow: 'hidden' }}>
                  <div 
                    onClick={() => setShowGuide(!showGuide)}
                    style={{ 
                      fontSize: '0.85rem', 
                      fontWeight: 'bold', 
                      color: '#0369a1', 
                      padding: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      backgroundColor: showGuide ? '#f0f9ff' : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i className="bi bi-info-circle-fill"></i> GUÍA DE ROLES Y PERMISOS
                    </div>
                    <i className={`bi bi-chevron-${showGuide ? 'up' : 'down'}`}></i>
                  </div>
                  
                  {showGuide && (
                    <div style={{ padding: '12px', paddingTop: 0, display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #e0f2fe' }}>
                      <div style={{ fontSize: '0.75rem', lineHeight: '1.4', marginTop: '10px' }} className="text-muted">
                        Los permisos de cada rol se configuran en <strong>Configuración → Permisos por Rol</strong>.
                        Podés renombrar los roles y habilitar módulos en la grilla.
                      </div>
                    </div>
                  )}
                </div>

                {!profiles.some(p => p.employee_id === selectedEmployee.id) ? (
                  <form onSubmit={handleCreateNewAccess} className="row g-3">
                    <div className="col-12">
                      <p className="small text-info-emphasis mb-3">Este empleado no tiene acceso. Completa los datos para habilitarlo.</p>
                      {saveStatus === 'success' && (
                        <div className="alert alert-success py-2 small mb-3">Acceso creado correctamente.</div>
                      )}
                      {accessErrorMessage && (
                        <div className="alert alert-danger py-2 small mb-3">{accessErrorMessage}</div>
                      )}
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-bold">Correo Electrónico</label>
                      <input type="email" className="form-control form-control-sm" required value={accessForm.email} onChange={e => setAccessForm({...accessForm, email: e.target.value})} placeholder="ejemplo@empresa.com" />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-bold">Contraseña</label>
                      <input type="password" className="form-control form-control-sm" required value={accessForm.password} onChange={e => setAccessForm({...accessForm, password: e.target.value})} placeholder="Mínimo 6 caracteres" />
                    </div>
                    <div className="col-md-12">
                      <label className="form-label small fw-bold">Rol / Categoría</label>
                      <select className="form-select form-select-sm" value={accessForm.role} onChange={e => setAccessForm({...accessForm, role: e.target.value})}>
                        {roleOptions.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12 mt-3">
                       <button type="submit" className="btn btn-primary btn-sm rounded-pill px-4 fw-bold" disabled={detailLoading}>
                         Habilitar Acceso
                       </button>
                    </div>
                  </form>
                ) : (
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="d-flex align-items-center gap-2 mb-2 text-success">
                        <i className="bi bi-check-circle-fill"></i>
                        <span className="small fw-bold">Cuenta vinculada correctamente</span>
                      </div>
                    </div>
                    <div className="col-md-12">
                      <label className="form-label small fw-bold">Rol / Categoría</label>
                      <select className="form-select form-select-sm" value={accessForm.role} onChange={e => setAccessForm({...accessForm, role: e.target.value})}>
                        {roleOptions.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12 mt-3">
                      <button type="button" className="btn btn-dark btn-sm rounded-pill px-4 fw-bold" onClick={handleUpdateExistingAccess} disabled={detailLoading}>
                        Guardar Cambios
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'edit' && (
        <div className="animate__animated animate__fadeIn" style={{ maxWidth: '800px' }}>
          <form onSubmit={handleSaveEmployee}>
            <div className="row g-4">
              <div className="col-md-8">
                <label className="form-label fw-bold">Nombre Completo</label>
                <input type="text" className="form-control form-control-lg" required value={employeeForm.nombre} onChange={e => setEmployeeForm({ ...employeeForm, nombre: e.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label fw-bold">Apodo / Corto</label>
                <input type="text" className="form-control form-control-lg" value={employeeForm.apodo} onChange={e => setEmployeeForm({ ...employeeForm, apodo: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label fw-bold">CUIT</label>
                <input type="text" className="form-control" value={employeeForm.cuit} onChange={e => setEmployeeForm({ ...employeeForm, cuit: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label fw-bold">Teléfono</label>
                <input type="text" className="form-control" value={employeeForm.telefono} onChange={e => setEmployeeForm({ ...employeeForm, telefono: e.target.value })} />
              </div>
              <div className="col-12">
                <label className="form-label fw-bold">Dirección</label>
                <input type="text" className="form-control" value={employeeForm.direccion} onChange={e => setEmployeeForm({ ...employeeForm, direccion: e.target.value })} />
              </div>
              <div className="col-12">
                <label className="form-label fw-bold">CBU / ALIAS Bancario</label>
                <input type="text" className="form-control" value={employeeForm.cbu} onChange={e => setEmployeeForm({ ...employeeForm, cbu: e.target.value })} />
              </div>
            </div>

            <div className="mt-5 border-top pt-4">
              {saveStatus === 'success' && <div className="alert alert-success rounded-pill py-2 text-center small mb-3">¡Guardado con éxito!</div>}
              {saveStatus === 'error' && <div className="alert alert-danger rounded-pill py-2 text-center small mb-3">{errorMessage}</div>}
              
              <div className="d-flex gap-3">
                <button type="submit" className="btn btn-primary px-5 py-3 rounded-pill fw-bold" style={{ flex: 1 }} disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Guardando...' : 'Guardar Empleado'}
                </button>
                <button type="button" className="btn btn-light px-4 py-3 rounded-pill" onClick={() => setView('list')}>Cancelar</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal Movimiento (Improved styles) */}
      {showMovModal && (
        <div className="modal-backdrop fade show d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}>
          <div className="modal-dialog shadow-lg animate__animated animate__zoomIn" style={{ width: '450px', backgroundColor: 'white', borderRadius: '24px', overflow: 'hidden' }}>
            <div className="modal-header p-4 border-0 pb-0 d-flex justify-content-between align-items-center">
              <h5 className="modal-title fw-bold" style={{ fontSize: '1.25rem' }}>Nuevo Movimiento</h5>
              <button type="button" className="btn-close" onClick={() => setShowMovModal(false)}></button>
            </div>
            <div className="modal-body p-4 pt-2">
              <form onSubmit={async (e) => {
                e.preventDefault();
                setSaveStatus('saving');
                const mov = {
                  empleado_id: selectedEmployee.id,
                  nombre_empleado: selectedEmployee.nombre,
                  concepto: movForm.concepto,
                  debe: movForm.tipo === 'Debe' ? parseFloat(movForm.monto) : 0,
                  haber: movForm.tipo === 'Haber' ? parseFloat(movForm.monto) : 0,
                  medio_pago: movForm.medio,
                  fecha: new Date().toISOString()
                };
                const res = await db.saveEmpleadoMovimiento(mov);
                if (res.success) {
                  setSaveStatus('success');
                  setTimeout(async () => {
                    setShowMovModal(false);
                    setSaveStatus('');
                    const data = await db.getEmpleadoMovimientos(selectedEmployee.id);
                    setHistory(data);
                  }, 1000);
                } else { 
                  setSaveStatus('error');
                  setErrorMessage(res.error || 'Error al guardar movimiento');
                }
              }}>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Tipo de Operación</label>
                  <div className="btn-group w-100" style={{ padding: '4px', backgroundColor: '#f1f5f9', borderRadius: '12px' }}>
                    <button type="button" className={`btn btn-sm rounded-pill ${movForm.tipo === 'Haber' ? 'btn-white shadow-sm active' : 'btn-link text-muted'}`} onClick={() => setMovForm({...movForm, tipo: 'Haber'})} style={{ textDecoration: 'none', fontWeight: 'bold' }}>Sueldo / Premio</button>
                    <button type="button" className={`btn btn-sm rounded-pill ${movForm.tipo === 'Debe' ? 'btn-white shadow-sm active' : 'btn-link text-muted'}`} onClick={() => setMovForm({...movForm, tipo: 'Debe'})} style={{ textDecoration: 'none', fontWeight: 'bold' }}>Pago / Adelanto</button>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Concepto</label>
                  <input type="text" className="form-control" required value={movForm.concepto} onChange={e => setMovForm({ ...movForm, concepto: e.target.value })} placeholder="Ej: Adelanto quincena" />
                </div>
                <div className="mb-4">
                  <label className="form-label small fw-bold">Monto ($)</label>
                  <input type="number" step="0.01" className="form-control form-control-lg fw-bold" required value={movForm.monto} onChange={e => setMovForm({ ...movForm, monto: e.target.value })} placeholder="0.00" />
                </div>
                
                {saveStatus === 'success' && <div className="alert alert-success py-2 text-center small mb-3">¡Registrado!</div>}
                {saveStatus === 'error' && <div className="alert alert-danger py-2 text-center small mb-3">{errorMessage}</div>}

                <button type="submit" className="btn btn-primary w-100 py-3 fw-bold rounded-pill shadow-sm" disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Procesando...' : 'Confirmar Registro'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Employees;
