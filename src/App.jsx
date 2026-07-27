import React, { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import Configuration from './pages/Configuration'
import { db, setBusinessId } from './supabaseClient'
import Clientes from './pages/Clientes'
import Cierre from './pages/Cierre'
import Compras from './pages/Compras'
import Adelantos from './pages/Adelantos'
import Pagos from './pages/Pagos'
import PagoImpuestos from './pages/PagoImpuestos'
import Rendiciones from './pages/Rendiciones'
import Login from './pages/Login'
import Employees from './pages/Employees'
import Providers from './pages/Providers'
import Results from './pages/Results'
import PeriodicPayments from './pages/PeriodicPayments'

const DEFAULT_MODULE_COLORS = {
  cierre: '#f59e0b',
  compras: '#ef4444',
  adelantos: '#ec4899',
  'pago-proveedores': '#10b981',
  'pago-impuestos': '#0ea5e9',
  rendiciones: '#8b5cf6',
  'pagos-periodicos': '#f97316',
  clientes: '#3b82f6',
  proveedores: '#06b6d4',
  empleados: '#6366f1',
  resultados: '#52525b',
  tareas: '#14b8a6'
};

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [navState, setNavState] = useState(null);
  const [modules, setModules] = useState({});
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [moduleColors, setModuleColors] = useState(DEFAULT_MODULE_COLORS);

  const refreshModules = async () => {
    const modulesData = await db.getModules();
    if (modulesData) {
      const normalizedModules = {};
      const colors = { ...DEFAULT_MODULE_COLORS };
      Object.keys(modulesData).forEach(k => {
        let key = k;
        if (k === 'pagos') key = 'pago-proveedores'; // Backward compatibility

        if (modulesData[k] && typeof modulesData[k] === 'object') {
          normalizedModules[key] = modulesData[k].enabled === true;
          if (modulesData[k].color) colors[key] = modulesData[k].color;
        } else {
          normalizedModules[key] = modulesData[k] === true;
          if (typeof modulesData[k] === 'string' && modulesData[k].startsWith('#')) {
            colors[key] = modulesData[k];
            normalizedModules[key] = true;
          }
        }
      });
      setModules(normalizedModules);
      setModuleColors(colors);
    }
  };

  // Check auth session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const sessionData = await db.getCurrentSession();
        if (sessionData) {
          setSession(sessionData.user);
          setProfile(sessionData.profile);
          await refreshModules();
        }
      } catch (err) {
        console.error('Auth init error:', err);
      } finally {
        setIsInitializing(false);
      }
    };
    checkAuth();
  }, []);

  const handleLoginSuccess = async (user) => {
    setSession(user);
    const prof = await db.getUserProfile(user.id);
    if (prof) {
      setProfile(prof);
      if (prof.business_id) {
        setBusinessId(prof.business_id);
      }
      await refreshModules();
    }
  };

  const handleLogout = async () => {
    await db.signOut();
    setSession(null);
    setProfile(null);
    setCurrentPage('dashboard');
  };

  if (isInitializing) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 bg-dark text-white">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Cargando...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const navigate = (page, state = null) => {
    setCurrentPage(page);
    setNavState(state);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getActiveModuleColor = (page) => {
    if (!page) return '#64748b';
    let configId = page;
    if (page === 'providers') configId = 'proveedores';
    else if (page === 'employees') configId = 'empleados';
    else if (page === 'results') configId = 'resultados';
    return moduleColors[configId] || DEFAULT_MODULE_COLORS[configId] || '#64748b';
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard navigate={navigate} modules={modules} moduleColors={moduleColors} refreshModules={refreshModules} profile={profile} />;
      case 'configuration':
        return profile?.role === 'admin' ? (
          <Configuration navigate={navigate} modules={modules} moduleColors={moduleColors} refreshModules={refreshModules} />
        ) : (
          <Dashboard navigate={navigate} modules={modules} moduleColors={moduleColors} refreshModules={refreshModules} profile={profile} />
        );
      case 'employees':
        return <Employees navigate={navigate} accentColor={getActiveModuleColor('employees')} />;
      case 'providers':
        return <Providers navigate={navigate} accentColor={getActiveModuleColor('providers')} />;
      case 'results':
        return <Results navigate={navigate} accentColor={getActiveModuleColor('results')} />;
      case 'cierre':
        return <Cierre navigate={navigate} accentColor={getActiveModuleColor('cierre')} />;
      case 'compras':
        return <Compras navigate={navigate} refreshModules={refreshModules} modules={modules} navState={navState} accentColor={getActiveModuleColor('compras')} />;
      case 'adelantos':
        return <Adelantos navigate={navigate} modules={modules} navState={navState} accentColor={getActiveModuleColor('adelantos')} />;
      case 'pago-proveedores':
        return <Pagos navigate={navigate} modules={modules} navState={navState} accentColor={getActiveModuleColor('pago-proveedores')} />;
      case 'pago-impuestos':
        return <PagoImpuestos navigate={navigate} modules={modules} navState={navState} accentColor={getActiveModuleColor('pago-impuestos')} />;
      case 'rendiciones':
        return <Rendiciones navigate={navigate} profile={profile} navState={navState} accentColor={getActiveModuleColor('rendiciones')} />;
      case 'clientes':
        return <Clientes navigate={navigate} profile={profile} navState={navState} accentColor={getActiveModuleColor('clientes')} />;
      case 'pagos-periodicos':
        return <PeriodicPayments navigate={navigate} profile={profile} navState={navState} accentColor={getActiveModuleColor('pagos-periodicos')} />;
      default:
        return <Dashboard navigate={navigate} modules={modules} moduleColors={moduleColors} refreshModules={refreshModules} profile={profile} />;
    }
  };

  const businessName = profile?.gst_businesses?.name || profile?.GST_businesses?.name || 'Gestion360i';

  return (
    <div className="app-container">
      {/* Header General */}
      <header className="app-header">
        <div className="app-logo-section">
          <div className="app-logo">{businessName}</div>
          <div className="user-badge">
            <i className="bi bi-person-circle"></i>
            <span>{profile?.full_name || 'Usuario'}</span>
            {profile?.role === 'admin' && <span className="badge bg-danger ms-2" style={{ fontSize: '0.6rem' }}>OWNER</span>}
          </div>
        </div>
        <div className="header-actions">
          <h1 className="app-title">{profile?.role === 'admin' ? 'PANEL DE CONTROL' : 'TERMINAL DE EMPLEADOS'}</h1>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar Sesión">
            <i className="bi bi-box-arrow-right"></i>
          </button>
        </div>
      </header>

      {/* Navegación - Botón Volver al Menú si no está en Dashboard */}
      {currentPage !== 'dashboard' && (
        <div 
          className="nav-back-container"
          style={{ 
            borderLeft: `5px solid ${getActiveModuleColor(currentPage)}`,
            paddingLeft: '12px',
            transition: 'border-color 0.3s ease'
          }}
        >
          <button className="btn-nav-back" onClick={() => navigate('dashboard')}>
            <i className="bi bi-chevron-left"></i> Volver al Menú
          </button>
        </div>
      )}

      {/* Renderizado de Página Activa */}
      <main>
        {renderPage()}
      </main>

      {/* Botones de Administración (solo en Dashboard y para admin) */}
      {currentPage === 'dashboard' && profile?.role === 'admin' && (
        <div className="admin-floating-actions">
          <button 
            className="floating-config-btn" 
            onClick={() => navigate('configuration')}
            title="Configuración del Sistema"
          >
            <i className="bi bi-gear-fill"></i>
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>© {businessName} | Sistema modular v1.1</p>
      </footer>
    </div>
  );
}

export default App;
