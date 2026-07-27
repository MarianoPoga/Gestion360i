import React, { useState, useEffect } from 'react'
import { db, isSupabaseConfigured } from '../supabaseClient'

const DEFAULT_MODULE_COLORS = {
  cierre: '#f59e0b',
  compras: '#ef4444',
  adelantos: '#ec4899',
  pagos: '#10b981',
  rendiciones: '#8b5cf6',
  'pagos-periodicos': '#f97316',
  clientes: '#3b82f6',
  proveedores: '#06b6d4',
  empleados: '#6366f1',
  resultados: '#52525b',
  tareas: '#14b8a6'
};

function Dashboard({ navigate, modules, moduleColors, refreshModules, profile }) {
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskCaracter, setNewTaskCaracter] = useState('Normal');
  const [dbMode, setDbMode] = useState('demo');

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: 'Caja fuerte'
  });

  // Helper to check permissions
  const hasPermission = (moduleId) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;

    // Load custom role permissions from DB/Local
    const rolePerms = JSON.parse(localStorage.getItem('role_permissions') || '{"cajero_can_compras":false,"operario_can_retiros":false}');
    
    const role = profile.role; // 'admin', 'operario', 'cajero'

    // Basic Cajero permissions
    const cajeroAllowed = ['cierre', 'clientes', 'pagos-periodicos'];
    if (rolePerms.cajero_can_compras) cajeroAllowed.push('compras');

    // Operario inherits Cajero + specific ones
    const operarioAllowed = [...cajeroAllowed, 'adelantos', 'pago-proveedores', 'pago-impuestos'];
    if (rolePerms.operario_can_retiros) operarioAllowed.push('rendiciones');

    if (role === 'cajero') {
      return cajeroAllowed.includes(moduleId);
    }
    if (role === 'operario') {
      return operarioAllowed.includes(moduleId);
    }

    return false;
  };

  // Load tasks on component mount
  useEffect(() => {
    loadTasks();
    setDbMode(isSupabaseConfigured() ? 'supabase' : 'demo');
    const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || '{"caja_nombre":"Caja fuerte"}');
    setRendConfig(loadedRendConfig);

    // Also fetch role permissions to sync with localStorage
    db.getRolePermissions().then(perms => {
      if (perms) localStorage.setItem('role_permissions', JSON.stringify(perms));
    });
  }, []);

  const loadTasks = async () => {
    if (!modules.tareas) return;
    setLoadingTasks(true);
    try {
      const data = await db.getTasks();
      setTasks(data);
    } catch (e) {
      console.error("Error loading tasks:", e);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleToggleTask = async (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, estado: t.estado === 'Pendiente' ? 'Realizada' : 'Pendiente' } : t));
    try {
      await db.toggleTask(id);
      loadTasks();
    } catch (e) {
      console.error("Error toggling task:", e);
      loadTasks();
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    try {
      await db.saveTask({
        tarea: newTaskText,
        caracter: newTaskCaracter,
        usuario: profile?.full_name || 'Usuario'
      });
      setNewTaskText('');
      setNewTaskCaracter('Normal');
      setModalOpen(false);
      loadTasks();
    } catch (e) {
      console.error("Error saving task:", e);
    }
  };

  // Grid of visible modules based on config AND permissions
  const visibleModules = [
    { id: 'cierre', label: 'Cerrar Caja', icon: 'bi-currency-dollar', watermark: 'bi-shop', color: 'bg-cierre' },
    { id: 'compras', label: 'Compras', icon: 'bi-cart-fill', watermark: 'bi-cart-x', color: 'bg-compras' },
    { id: 'adelantos', label: 'Adelantos', icon: 'bi-cash-stack', watermark: 'bi-people', color: 'bg-adelantos' },
    { id: 'pago-proveedores', label: 'Pago Proveedores', icon: 'bi-wallet2', watermark: 'bi-cash', color: 'bg-success' },
    { id: 'pago-impuestos', label: 'Pago Impuestos/Servicios', icon: 'bi-receipt', watermark: 'bi-cash-coin', color: 'bg-success' },
    { id: 'rendiciones', label: 'Caja fuerte', icon: 'bi-clipboard-data', watermark: 'bi-safe', color: 'bg-rendiciones' },
    { id: 'pagos-periodicos', label: 'Pagos Periódicos', icon: 'bi-calendar-check', watermark: 'bi-calendar2-week', color: 'bg-secondary' },
    { id: 'clientes', label: 'Pedidos', icon: 'bi-journal-text', watermark: 'bi-journal-text', color: 'bg-clientes' },
    { id: 'providers', label: 'Proveedores', icon: 'bi-truck', watermark: 'bi-truck', color: 'bg-info' },
    { id: 'employees', label: 'Empleados', icon: 'bi-person-badge', watermark: 'bi-people', color: 'bg-employees' },
    { id: 'results', label: 'Resultados', icon: 'bi-graph-up', watermark: 'bi-bar-chart', color: 'bg-dark' }
  ].filter(m => {
    // Map providers/employees/results to their config keys if needed
    const permId = m.id === 'providers' ? 'proveedores' : 
                   m.id === 'employees' ? 'empleados' : 
                   m.id === 'results' ? 'resultados' : m.id;
    
    // 1. Check if module is enabled globally in Configuration
    if (modules[permId] === false) return false;

    // 2. Check if user has permission for this module
    return hasPermission(permId);
  });

  return (
    <div className="animate__animated animate__fadeIn">
      {/* DB Connection Mode Badge */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        <span 
          className={`badge-tag shadow-sm`} 
          style={{ 
            fontSize: '0.75rem', 
            fontWeight: '600', 
            padding: '6px 12px', 
            borderRadius: '20px', 
            backgroundColor: dbMode === 'supabase' ? '#ecfdf5' : '#fef3c7',
            borderColor: dbMode === 'supabase' ? '#a7f3d0' : '#fde68a',
            color: dbMode === 'supabase' ? '#065f46' : '#92400e',
            border: '1px solid'
          }}
        >
          <i className={`bi ${dbMode === 'supabase' ? 'bi-database-fill-check' : 'bi-database-fill-exclamation'} me-1`}></i>
          {dbMode === 'supabase' ? 'Conectado a la Nube' : 'Modo Local (Sin Supabase)'}
        </span>
      </div>

      {/* Grid of Modules */}
      {visibleModules.length > 0 ? (
        <div className="menu-grid">
          {visibleModules.map(m => {
            const configId = m.id === 'providers' ? 'proveedores' : 
                             m.id === 'employees' ? 'empleados' : 
                             m.id === 'results' ? 'resultados' : m.id;
            return (
              <div key={m.id} 
                className={`module-card animate__animated animate__zoomIn`} 
                onClick={() => navigate(m.id)}
                style={{ backgroundColor: (moduleColors && moduleColors[configId]) || DEFAULT_MODULE_COLORS[configId] || 'var(--card-bg)' }}
              >
                <i className={`bi ${m.watermark} watermark-icon`}></i>
                <div className="card-icon"><i className={`bi ${m.icon}`}></i></div>
                <h3 className="card-title">{m.label}</h3>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="page-card text-center" style={{ padding: '40px 20px', borderRadius: '15px' }}>
          <i className="bi bi-shield-lock" style={{ fontSize: '3.5rem', color: '#dee2e6' }}></i>
          <h4 className="mt-3">Sin Módulos Asignados</h4>
          <p className="text-muted">No tienes permisos para acceder a ningún módulo. Contacta al administrador.</p>
        </div>
      )}

      {/* Task Checklist Panel */}
      {(profile?.role === 'admin' || hasPermission('tareas')) && (
        <div style={{ marginTop: '30px' }}>
          <div className="section-header d-flex justify-content-between align-items-center mb-3">
            <h5 className="section-title m-0 fw-bold">
              <i className="bi bi-list-check me-2 text-primary"></i> Tareas de hoy
            </h5>
            <button className="btn btn-sm btn-primary px-3 rounded-pill" onClick={() => setModalOpen(true)}>
              <i className="bi bi-plus-lg me-1"></i> Nueva
            </button>
          </div>

          <div className="tasks-container">
            {loadingTasks ? (
              <div className="spinner-container">
                <div className="spinner"></div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cargando tareas...</span>
              </div>
            ) : tasks.length > 0 ? (
              tasks.map(task => {
                const isDone = task.estado === 'Realizada';
                const charLower = String(task.caracter || '').toLowerCase();
                let charClass = '';
                if (charLower.includes('urgente')) charClass = 'urgent';
                else if (charLower.includes('mantenimiento')) charClass = 'mantenimiento';
                else if (charLower.includes('limpieza')) charClass = 'limpieza';

                return (
                  <div key={task.id} className={`task-item ${isDone ? 'done' : ''} ${!isDone ? charClass : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="checkbox" 
                        className="task-checkbox" 
                        checked={isDone}
                        onChange={() => handleToggleTask(task.id)}
                      />
                    </div>
                    <div className="task-content">
                      <div className="task-text">{task.tarea}</div>
                      <div className="task-meta">
                        <span className="badge-tag">{task.caracter}</span>
                        {task.fecha && <span><i className="bi bi-calendar-event me-1"></i>{task.fecha}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="page-card text-center" style={{ padding: '30px 10px', boxShadow: 'none', borderStyle: 'dashed' }}>
                <i className="bi bi-clipboard-check text-success" style={{ fontSize: '2rem' }}></i>
                <div className="empty-message">No hay tareas pendientes.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header">
              <h5 className="modal-title">Nueva Tarea</h5>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">

              <form onSubmit={handleCreateTask}>
                <div className="form-group">
                  <label className="form-label">Carácter / Categoría</label>
                  <select 
                    className="form-select"
                    value={newTaskCaracter}
                    onChange={(e) => setNewTaskCaracter(e.target.value)}
                  >
                    <option value="Normal">Normal</option>
                    <option value="Urgente 🔴">Urgente 🔴</option>
                    <option value="Mantenimiento 🛠️">Mantenimiento 🛠️</option>
                    <option value="Limpieza 🧹">Limpieza 🧹</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Descripción</label>
                  <textarea 
                    className="form-textarea"
                    rows="3"
                    required
                    placeholder="Ej: Limpiar freezer, Reponer stock de jugos..."
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                  ></textarea>
                </div>
                <button type="submit" className="btn-submit">
                  AGREGAR TAREA
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard;
