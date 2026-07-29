import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react'
import { db, isSupabaseConfigured } from '../supabaseClient'
import {
  normalizeRolePermissions,
  hasModulePermission,
  getEnabledPermissionModules,
  getTaskRoleLabel,
  getTaskRoleOptions,
  taskVisibleForRole,
  normalizeRoleKey,
} from '../rolePermissions'
import { MODULE_LABELS, DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels'
import ModuleCardLabel, { REFERENCE_MODULE_LABEL } from '../components/ModuleCardLabel'

/** Ícono central: ~42% del alto del tile (entre 25% chico y ~58% grande). */
const MODULE_ICON_HEIGHT_RATIO = 0.42;
const MODULE_ICON_HEIGHT_RATIO_MOBILE = 0.36;

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
  const [newTaskRole, setNewTaskRole] = useState('operario');
  const [dbMode, setDbMode] = useState('demo');

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME
  });

  const [rolePermissions, setRolePermissions] = useState(null);
  const menuGridRef = useRef(null);
  const labelProbeRef = useRef(null);
  const [uniformLabelPx, setUniformLabelPx] = useState(null);
  const [moduleIconPx, setModuleIconPx] = useState(null);

  const hasPermission = (moduleId) =>
    hasModulePermission(rolePermissions, profile, moduleId, modules);

  const roleLabels = normalizeRolePermissions(rolePermissions).roles;
  const taskRoleOptions = getTaskRoleOptions(rolePermissions);
  const visibleTasks = tasks.filter((task) =>
    taskVisibleForRole(task.usuario, profile?.role)
  );

  // Load tasks on component mount
  useEffect(() => {
    loadTasks();
    setDbMode(isSupabaseConfigured() ? 'supabase' : 'demo');
    const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}"}`);
    setRendConfig(loadedRendConfig);

    db.getRolePermissions().then((perms) => {
      if (perms) {
        localStorage.setItem('role_permissions', JSON.stringify(perms));
        setRolePermissions(perms);
      }
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
        rol: newTaskRole,
      });
      setNewTaskText('');
      setNewTaskCaracter('Normal');
      setNewTaskRole(normalizeRoleKey(profile?.role) || 'operario');
      setModalOpen(false);
      loadTasks();
    } catch (e) {
      console.error("Error saving task:", e);
    }
  };

  // Grid of visible modules based on config AND permissions
  const visibleModules = [
    { id: 'cierre', label: MODULE_LABELS.cierre, icon: 'bi-currency-dollar', watermark: 'bi-shop', color: 'bg-cierre' },
    { id: 'compras', label: MODULE_LABELS.compras, icon: 'bi-cart-fill', watermark: 'bi-cart-x', color: 'bg-compras' },
    { id: 'adelantos', label: MODULE_LABELS.adelantos, icon: 'bi-cash-stack', watermark: 'bi-people', color: 'bg-adelantos' },
    { id: 'pago-proveedores', label: MODULE_LABELS['pago-proveedores'], icon: 'bi-wallet2', watermark: 'bi-cash', color: 'bg-success' },
    { id: 'pago-impuestos', label: MODULE_LABELS['pago-impuestos'], icon: 'bi-receipt', watermark: 'bi-cash-coin', color: 'bg-success' },
    { id: 'rendiciones', label: MODULE_LABELS.rendiciones, icon: 'bi-clipboard-data', watermark: 'bi-safe', color: 'bg-rendiciones' },
    { id: 'pagos-periodicos', label: MODULE_LABELS['pagos-periodicos'], icon: 'bi-calendar-check', watermark: 'bi-calendar2-week', color: 'bg-secondary' },
    { id: 'clientes', label: MODULE_LABELS.clientes, icon: 'bi-journal-text', watermark: 'bi-journal-text', color: 'bg-clientes' },
    { id: 'providers', label: MODULE_LABELS.proveedores, icon: 'bi-truck', watermark: 'bi-truck', color: 'bg-info' },
    { id: 'employees', label: MODULE_LABELS.empleados, icon: 'bi-person-badge', watermark: 'bi-people', color: 'bg-employees' },
    { id: 'results', label: MODULE_LABELS.resultados, icon: 'bi-graph-up', watermark: 'bi-bar-chart', color: 'bg-dark' }
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

  const longestModuleLabel = useMemo(() => {
    if (!visibleModules.length) return REFERENCE_MODULE_LABEL;
    return visibleModules.reduce((longest, module) =>
      module.label.length > longest.length ? module.label : longest,
    visibleModules[0].label);
  }, [visibleModules]);

  // Mismo tamaño de texto en todos los tiles (según el módulo más largo)
  useLayoutEffect(() => {
    const grid = menuGridRef.current;
    const probe = labelProbeRef.current;
    if (!grid || !probe) return;

    const wrap = probe.querySelector('.module-card-label-wrap');
    const text = probe.querySelector('.module-card-label');
    if (!wrap || !text) return;

    const fitUniform = () => {
      const style = getComputedStyle(grid);
      const colTracks = style.gridTemplateColumns.split(' ').filter(Boolean);
      const cols = colTracks.length || 3;
      const gap = parseFloat(style.columnGap) || 16;
      const cellWidth = (grid.clientWidth - gap * (cols - 1)) / cols;
      const isMobile = grid.clientWidth <= 480;
      const isTablet = grid.clientWidth <= 768;
      const iconRatio = isMobile ? MODULE_ICON_HEIGHT_RATIO_MOBILE : MODULE_ICON_HEIGHT_RATIO;

      const sampleCard = grid.querySelector('.module-card');
      if (sampleCard?.clientHeight > 0) {
        const iconPx = Math.round(sampleCard.clientHeight * iconRatio);
        setModuleIconPx((prev) => (prev === iconPx ? prev : iconPx));
      }

      const sampleWrap = grid.querySelector('.module-card .module-card-label-wrap');
      if (sampleWrap?.clientHeight > 0) {
        wrap.style.width = `${sampleWrap.clientWidth}px`;
        wrap.style.height = `${sampleWrap.clientHeight}px`;
      } else {
        const cardHeight = cellWidth * (isMobile ? 1 : 0.95);
        const iconSize = cardHeight * iconRatio;
        const textZoneHeight = cardHeight - iconSize - 30;
        wrap.style.width = `${Math.max(cellWidth - 16, 60)}px`;
        wrap.style.height = `${Math.max(textZoneHeight, 24)}px`;
      }

      let size = 12;
      const maxSize = isMobile ? 17 : isTablet ? 19 : 36;
      text.textContent = longestModuleLabel;
      text.style.fontSize = `${size}px`;
      while (size < maxSize && text.scrollHeight <= wrap.clientHeight + 1) {
        size += 1;
        text.style.fontSize = `${size}px`;
      }
      size = Math.max(11, size - 1);
      setUniformLabelPx(size);
    };

    fitUniform();
    const ro = new ResizeObserver(fitUniform);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [visibleModules, longestModuleLabel]);

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
        <>
          <div
            ref={labelProbeRef}
            aria-hidden="true"
            className="module-card-label-probe"
          >
            <div className="module-card-label-wrap">
              <span className="module-card-label">{longestModuleLabel}</span>
            </div>
          </div>
          <div className="menu-grid" ref={menuGridRef}>
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
                <div
                  className="card-icon"
                  style={moduleIconPx != null ? { fontSize: `${moduleIconPx}px`, lineHeight: 1 } : undefined}
                >
                  <i className={`bi ${m.icon}`}></i>
                </div>
                <ModuleCardLabel label={m.label} fontSize={uniformLabelPx} />
              </div>
            );
          })}
          </div>
        </>
      ) : (
        <div className="page-card text-center" style={{ padding: '40px 20px', borderRadius: '15px' }}>
          <i className="bi bi-shield-lock" style={{ fontSize: '3.5rem', color: '#dee2e6' }}></i>
          <h4 className="mt-3">Sin Módulos Asignados</h4>
          <p className="text-muted">No tienes permisos para acceder a ningún módulo. Contacta al administrador.</p>
        </div>
      )}

      {/* Task Checklist Panel */}
      {(profile?.role === 'admin' || hasPermission('tareas')) && modules.tareas !== false && (
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
            ) : visibleTasks.length > 0 ? (
              visibleTasks.map(task => {
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
                        {getTaskRoleLabel(task.usuario, roleLabels) && (
                          <span className="badge-tag">
                            <i className="bi bi-person-badge me-1"></i>
                            {getTaskRoleLabel(task.usuario, roleLabels)}
                          </span>
                        )}
                        {task.fecha && <span><i className="bi bi-calendar-event me-1"></i>{task.fecha}</span>}
                        {!task.fecha && task.created_at && (
                          <span>
                            <i className="bi bi-calendar-event me-1"></i>
                            {new Date(task.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                          </span>
                        )}
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
                  <label className="form-label" htmlFor="task-role">Rol destinatario</label>
                  <select
                    id="task-role"
                    name="task-role"
                    className="form-select"
                    value={newTaskRole}
                    onChange={(e) => setNewTaskRole(e.target.value)}
                  >
                    {taskRoleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="task-caracter">Carácter / Categoría</label>
                  <select
                    id="task-caracter"
                    name="task-caracter"
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
                  <label className="form-label" htmlFor="task-description">Descripción</label>
                  <textarea
                    id="task-description"
                    name="task-description"
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
