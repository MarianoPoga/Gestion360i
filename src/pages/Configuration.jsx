import React, { useState, useEffect } from 'react'
import { db, isSupabaseConfigured, testSupabaseConnection, forceHistoricalSync } from '../supabaseClient'

const formatCuit = (val) => {
  if (!val) return '';
  if (val === 'N/A') return 'N/A';
  const clean = val.replace(/[^0-9]/g, '');
  let formatted = '';
  if (clean.length > 0) {
    formatted += clean.substring(0, 2);
  }
  if (clean.length > 2) {
    formatted += '-' + clean.substring(2, 10);
  }
  if (clean.length > 10) {
    formatted += '-' + clean.substring(10, 11);
  }
  return formatted;
};

const handleCuitChange = (val, setter) => {
  let clean = val.replace(/[^0-9]/g, '');
  if (clean.length > 11) {
    clean = clean.substring(0, 11);
  }
  let formatted = '';
  if (clean.length > 0) {
    formatted += clean.substring(0, 2);
  }
  if (clean.length > 2) {
    formatted += '-' + clean.substring(2, 10);
  }
  if (clean.length > 10) {
    formatted += '-' + clean.substring(10, 11);
  }
  setter(formatted);
};

const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
  '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#14b8a6', 
  '#84cc16', '#eab308', '#a855f7', '#d946ef', '#0ea5e9', 
  '#4ade80', '#f472b6', '#fbbf24', '#fb7185', '#c084fc', 
  '#818cf8', '#2dd4bf', '#fb923c', '#22d3ee', '#94a3b8', 
  '#52525b', '#4338ca', '#b91c1c', '#15803d', '#0369a1'
];

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

function Configuration({ navigate, modules: initialModules, moduleColors: initialModuleColors, refreshModules }) {
  // Module configuration state
  const [modules, setModules] = useState({
    cierre: true,
    compras: true,
    adelantos: true,
    rendiciones: true,
    clientes: true,
    tareas: true,
    proveedores: true,
    empleados: true,
    resultados: true,
    'pagos-periodicos': true,
    'pago-proveedores': true,
    'pago-impuestos': true
  });
  const [moduleColors, setModuleColors] = useState(DEFAULT_MODULE_COLORS);
  const [dragOverModule, setDragOverModule] = useState(null);
  const [selectedModuleForColor, setSelectedModuleForColor] = useState(null);

  // Supabase credentials state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  
  // WhatsApp settings
  const [whatsappTemplate, setWhatsappTemplate] = useState('Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!');
  
  // Cierre settings
  const [turnosList, setTurnosList] = useState([]);
  const [conceptsList, setConceptsList] = useState([]);
  const [newTurnoInput, setNewTurnoInput] = useState('');
  const [newConceptInput, setNewConceptInput] = useState('');

  // Compras configuration settings
  const [comprasCategoriasList, setComprasCategoriasList] = useState([]);
  const [newComprasCategoriaInput, setNewComprasCategoriaInput] = useState('');
  const [editingCatIdx, setEditingCatIdx] = useState(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [comprasConceptosList, setComprasConceptosList] = useState([]);
  const [newComprasConceptoInput, setNewComprasConceptoInput] = useState('');
  const [newComprasConceptoIva, setNewComprasConceptoIva] = useState('21');
  const [comprasFormasPagoList, setComprasFormasPagoList] = useState([]);
  const [newComprasFormaPagoInput, setNewComprasFormaPagoInput] = useState('');
  const [comprasWaReclaimTemplate, setComprasWaReclaimTemplate] = useState('Hola, te reclamo la factura pendiente del proveedor *{proveedor}* (Factura: {nro_factura}) por la compra de fecha *{fecha}* por un total de *${monto}*. Gracias.');

  // Adelantos configuration settings
  const [allowMercaderia, setAllowMercaderia] = useState(true);
  const [allowDinero, setAllowDinero] = useState(true);
  const [allowPagosProveedores, setAllowPagosProveedores] = useState(true);
  const [allowAdelantos, setAllowAdelantos] = useState(true);
  const [cajasPosibles, setCajasPosibles] = useState([]);
  const [montoMaximo, setMontoMaximo] = useState('');

  // Accordion state
  const [expandedModule, setExpandedModule] = useState(null);
  const [configExpanded, setConfigExpanded] = useState(true);
  const [modulesExpanded, setModulesExpanded] = useState(true);

  // Rendiciones configuration settings
  const [rendicionCajaNombre, setRendicionCajaNombre] = useState('Caja fuerte');
  const [rendicionAllowAdelantos, setRendicionAllowAdelantos] = useState(true);
  const [rendicionAllowCompras, setRendicionAllowCompras] = useState(true);
  const [rendicionAllowPagos, setRendicionAllowPagos] = useState(true);

  // ARCA settings
  const [arcaCuit, setArcaCuit] = useState('');
  const [arcaRazonSocial, setArcaRazonSocial] = useState('');
  const [arcaNombreComercial, setArcaNombreComercial] = useState('');
  const [arcaDireccion, setArcaDireccion] = useState('');
  const [arcaPuntoVenta, setArcaPuntoVenta] = useState('0001');
  const [arcaAmbiente, setArcaAmbiente] = useState('homologacion');
  const [arcaCert, setArcaCert] = useState('');
  const [arcaKey, setArcaKey] = useState('');
  const [arcaToken, setArcaToken] = useState('');
  
  // UI States
  const [saveStatus, setSaveStatus] = useState(''); // 'success', 'error', ''
  const [testStatus, setTestStatus] = useState(''); // 'testing', 'success', 'error', ''
  const [testError, setTestError] = useState('');
  const [clearStatus, setClearStatus] = useState(''); // 'clearing', 'success', 'error', ''
  const [syncStatus, setSyncStatus] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  // Role-based extra permissions
  const [cajeroCanCompras, setCajeroCanCompras] = useState(false);
  const [operarioCanRetiros, setOperarioCanRetiros] = useState(false);

  // Load configuration on mount
  useEffect(() => {
    async function initConfig() {
      try {
        const [m, t, c, cc, cco, cp, rp] = await Promise.all([
          db.getModules(),
          db.getCierreTurnos(),
          db.getCierreConceptos(),
          db.getComprasCategorias(),
          db.getComprasConceptos(),
          db.getComprasFormasPago(),
          db.getRolePermissions()
        ]);
        
        setModules(m || {});
        setTurnosList(t || []);
        setConceptsList(c || []);
        
        const formattedCats = (cc || []).map(cat => {
          if (typeof cat === 'string') return { name: cat, details: [] };
          return cat;
        });
        setComprasCategoriasList(formattedCats);
        
        setComprasConceptosList(cco || []);
        setComprasFormasPagoList(cp || []);
        
        if (rp) {
          setCajeroCanCompras(rp.cajero_can_compras === true);
          setOperarioCanRetiros(rp.operario_can_retiros === true);
        } else {
          const lp = JSON.parse(localStorage.getItem('role_permissions') || '{}');
          setCajeroCanCompras(lp.cajero_can_compras === true);
          setOperarioCanRetiros(lp.operario_can_retiros === true);
        }

        // Normalize modules to be booleans and extract colors
        if (m) {
          const normalizedModules = {};
          const colors = { ...DEFAULT_MODULE_COLORS };
          Object.keys(m).forEach(k => {
            let key = k;
            if (k === 'pagos') key = 'pago-proveedores';

            if (m[k] && typeof m[k] === 'object') {
              normalizedModules[key] = m[k].enabled === true;
              if (m[k].color) colors[key] = m[k].color;
            } else {
              normalizedModules[key] = m[k] === true;
              if (typeof m[k] === 'string' && m[k].startsWith('#')) {
                colors[key] = m[k];
                normalizedModules[key] = true;
              }
            }
          });
          setModules(prev => ({ ...prev, ...normalizedModules }));
          setModuleColors(colors);
        }

      } catch (e) {
        console.error("Error loading config data:", e);
      }

      setSupabaseUrl(localStorage.getItem('supabase_url') || '');
      setSupabaseAnonKey(localStorage.getItem('supabase_anon_key') || '');
      setGeminiApiKey(localStorage.getItem('gemini_api_key') || '');
      setWhatsappTemplate(localStorage.getItem('whatsapp_template') || 'Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!');
      setArcaCuit(formatCuit(localStorage.getItem('arca_cuit') || ''));
      setArcaRazonSocial(localStorage.getItem('arca_razon_social') || '');
      setArcaNombreComercial(localStorage.getItem('arca_nombre_comercial') || '');
      setArcaDireccion(localStorage.getItem('arca_direccion') || '');
      setArcaPuntoVenta(localStorage.getItem('arca_punto_venta') || '0001');
      setArcaAmbiente(localStorage.getItem('arca_ambiente') || 'homologacion');
      setArcaCert(localStorage.getItem('arca_cert') || '');
      setArcaKey(localStorage.getItem('arca_key') || '');
      setArcaToken(localStorage.getItem('arca_token') || '');

      const rConf = JSON.parse(localStorage.getItem('rendiciones_config') || '{"caja_nombre":"Caja fuerte","allow_adelantos":true,"allow_compras":true,"allow_pagos":true}');
      setRendicionCajaNombre(rConf.caja_nombre || 'Caja fuerte');
      setRendicionAllowAdelantos(rConf.allow_adelantos !== false);
      setRendicionAllowCompras(rConf.allow_compras !== false);
      setRendicionAllowPagos(rConf.allow_pagos !== false);

      const aConf = JSON.parse(localStorage.getItem('adelantos_config') || '{"allow_mercaderia":true,"allow_dinero":true,"allow_pagos_proveedores":true,"allow_adelantos":true,"cajas_posibles":[],"monto_maximo":""}');
      setAllowMercaderia(aConf.allow_mercaderia !== false);
      setAllowDinero(aConf.allow_dinero !== false);
      setAllowPagosProveedores(aConf.allow_pagos_proveedores !== false);
      setAllowAdelantos(aConf.allow_adelantos !== false);
      setCajasPosibles(aConf.cajas_posibles || []);
      setMontoMaximo(aConf.monto_maximo || '');

      setComprasWaReclaimTemplate(localStorage.getItem('compras_wa_reclaim_template') || 'Hola, te reclamo la factura pendiente del proveedor *{proveedor}* (Factura: {nro_factura}) por la compra de fecha *{fecha}* por un total de *${monto}*. Gracias.');
    }

    initConfig();
  }, []);

  const handleToggleModule = (moduleKey) => {
    setModules(prev => {
      const newVal = !prev[moduleKey];
      if ((moduleKey === 'clientes' || moduleKey === 'cierre' || moduleKey === 'compras' || moduleKey === 'adelantos') && !newVal) {
        setExpandedModule(null);
      }
      return {
        ...prev,
        [moduleKey]: newVal
      };
    });
  };

  const handleToggleCajaPosible = (shift) => {
    setCajasPosibles(prev =>
      prev.includes(shift) ? prev.filter(s => s !== shift) : [...prev, shift]
    );
  };

  const handleAddTurnoTag = (e) => {
    if (e) e.preventDefault();
    const val = newTurnoInput.trim();
    if (val && !turnosList.includes(val)) {
      setTurnosList(prev => [...prev, val]);
      setNewTurnoInput('');
    }
  };

  const handleRemoveTurnoTag = (index) => {
    setTurnosList(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddConceptTag = (e) => {
    if (e) e.preventDefault();
    const val = newConceptInput.trim();
    if (val) {
      const existing = conceptsList.find(c => c.label.toLowerCase() === val.toLowerCase());
      if (existing) {
        if (!existing.enabled) {
          setConceptsList(prev => prev.map(c => c.id === existing.id ? { ...c, enabled: true } : c));
        }
      } else {
        const newId = `concept_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        setConceptsList(prev => [...prev, { id: newId, label: val, enabled: true }]);
      }
      setNewConceptInput('');
    }
  };

  const handleRemoveConceptTag = (id) => {
    setConceptsList(prev => prev.map(c => c.id === id ? { ...c, enabled: false } : c));
  };

  // Categorías de Compra Helpers
  const handleAddComprasCategoria = (e) => {
    if (e) e.preventDefault();
    const val = newComprasCategoriaInput.trim();
    if (val && !comprasCategoriasList.some(c => c.name === val)) {
      setComprasCategoriasList(prev => [...prev, { name: val, details: [] }]);
      setNewComprasCategoriaInput('');
    }
  };

  const handleAddCategoriaDetail = (catIdx, detailLabel, ivaValue) => {
    if (!detailLabel.trim()) return;
    setComprasCategoriasList(prev => {
      const newList = [...prev];
      const details = newList[catIdx].details || [];
      if (!details.some(d => d.label === detailLabel.trim())) {
        newList[catIdx].details = [...details, { label: detailLabel.trim(), iva: parseFloat(ivaValue) || 0 }];
      }
      return newList;
    });
  };

  const handleRemoveCategoriaDetail = (catIdx, detailIdx) => {
    setComprasCategoriasList(prev => {
      const newList = [...prev];
      newList[catIdx].details = newList[catIdx].details.filter((_, i) => i !== detailIdx);
      return newList;
    });
  };

  const handleRemoveComprasCategoria = (index) => {
    setComprasCategoriasList(prev => prev.filter((_, i) => i !== index));
    if (editingCatIdx === index) {
      setEditingCatIdx(null);
      setEditingCatName('');
    }
  };

  const handleStartEditCategoria = (index, name) => {
    setEditingCatIdx(index);
    setEditingCatName(name);
  };

  const handleSaveEditCategoria = () => {
    if (editingCatIdx === null || !editingCatName.trim()) return;
    setComprasCategoriasList(prev => {
      const newList = [...prev];
      newList[editingCatIdx].name = editingCatName.trim();
      return newList;
    });
    setEditingCatIdx(null);
    setEditingCatName('');
  };

  // Formas de Pago de Compra Helpers
  const handleAddComprasFormaPago = (e) => {
    if (e) e.preventDefault();
    const val = newComprasFormaPagoInput.trim();
    if (val && !comprasFormasPagoList.includes(val)) {
      setComprasFormasPagoList(prev => [...prev, val]);
      setNewComprasFormaPagoInput('');
    }
  };

  const handleRemoveComprasFormaPago = (index) => {
    setComprasFormasPagoList(prev => prev.filter((_, i) => i !== index));
  };

  // Conceptos / Detalles Helpers (con IVA)
  const handleAddComprasConcepto = (e) => {
    if (e) e.preventDefault();
    const val = newComprasConceptoInput.trim();
    if (val) {
      const existing = comprasConceptosList.find(c => c.label.toLowerCase() === val.toLowerCase());
      if (existing) {
        setComprasConceptosList(prev => prev.map(c => c.id === existing.id ? { ...c, iva: parseFloat(newComprasConceptoIva) } : c));
      } else {
        const newId = `cc_${Date.now()}`;
        setComprasConceptosList(prev => [...prev, { id: newId, label: val, iva: parseFloat(newComprasConceptoIva) }]);
      }
      setNewComprasConceptoInput('');
    }
  };

  const handleRemoveComprasConcepto = (id) => {
    setComprasConceptosList(prev => prev.filter(c => c.id !== id));
  };

  const handleChangeComprasConceptoIva = (id, ivaVal) => {
    setComprasConceptosList(prev => prev.map(c => c.id === id ? { ...c, iva: parseFloat(ivaVal) } : c));
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      // Merge colors into modules object for storage
      const modulesWithColors = {};
      Object.keys(modules).forEach(k => {
        modulesWithColors[k] = {
          enabled: modules[k],
          color: moduleColors[k] || null
        };
      });

      // Save Cierre configurations list
      const cleanTurnos = turnosList
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Save all database settings concurrently and await them
      await Promise.all([
        db.saveModules(modulesWithColors),
        db.saveCierreTurnos(cleanTurnos.length > 0 ? cleanTurnos : ["Mañana", "Tarde", "Delivery", "Noche"]),
        db.saveCierreConceptos(conceptsList),
        db.saveComprasCategorias(comprasCategoriasList),
        db.saveComprasFormasPago(comprasFormasPagoList),
        db.saveRolePermissions({
          cajero_can_compras: cajeroCanCompras,
          operario_can_retiros: operarioCanRetiros
        })
      ]);

      // Save WhatsApp and Compras settings to localStorage
      localStorage.setItem('whatsapp_template', whatsappTemplate);
      localStorage.setItem('compras_wa_reclaim_template', comprasWaReclaimTemplate);

      // Save Adelantos configurations
      const adelantosConfig = {
        allow_mercaderia: allowMercaderia,
        allow_dinero: allowDinero,
        allow_pagos_proveedores: allowPagosProveedores,
        allow_adelantos: allowAdelantos,
        cajas_posibles: cajasPosibles,
        monto_maximo: montoMaximo ? parseFloat(montoMaximo) : null
      };
      localStorage.setItem('adelantos_config', JSON.stringify(adelantosConfig));

      // Save Rendiciones configurations
      const rendicionesConfig = {
        caja_nombre: rendicionCajaNombre.trim() || 'Caja fuerte',
        allow_adelantos: rendicionAllowAdelantos,
        allow_compras: rendicionAllowCompras,
        allow_pagos: rendicionAllowPagos
      };
      localStorage.setItem('rendiciones_config', JSON.stringify(rendicionesConfig));

      // Save credentials
      if (supabaseUrl.trim() && supabaseAnonKey.trim()) {
        localStorage.setItem('supabase_url', supabaseUrl.trim());
        localStorage.setItem('supabase_anon_key', supabaseAnonKey.trim());
      } else {
        // If one is empty, clear both to fall back to demo mode safely
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_anon_key');
      }

      localStorage.setItem('gemini_api_key', geminiApiKey.trim());

      // Save ARCA settings
      localStorage.setItem('arca_cuit', arcaCuit.replace(/[^0-9]/g, ''));
      localStorage.setItem('arca_razon_social', arcaRazonSocial);
      localStorage.setItem('arca_nombre_comercial', arcaNombreComercial);
      localStorage.setItem('arca_direccion', arcaDireccion);
      localStorage.setItem('arca_punto_venta', arcaPuntoVenta);
      localStorage.setItem('arca_ambiente', arcaAmbiente);
      localStorage.setItem('arca_cert', arcaCert);
      localStorage.setItem('arca_key', arcaKey);
      localStorage.setItem('arca_token', arcaToken);

      setSaveStatus('success');
      refreshModules(); // Notify App.jsx about module updates
      
      // Auto close/redirect or show success message briefly
      setTimeout(() => {
        setSaveStatus('');
        navigate('dashboard');
      }, 1500);
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const handleHistoricalSync = async () => {
    setSyncStatus('syncing');
    setSyncMessage('');
    try {
      await forceHistoricalSync();
      setSyncStatus('success');
      setSyncMessage('Sincronización completada. Recargá Clientes/Empleados para ver los datos importados.');
    } catch (err) {
      setSyncStatus('error');
      setSyncMessage(err.message || 'No se pudo sincronizar.');
    }
  };

  const handleTestConnection = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setTestStatus('error');
      setTestError('Debes completar la URL y la Anon Key para probar la conexión.');
      return;
    }

    setTestStatus('testing');
    setTestError('');

    try {
      const result = await testSupabaseConnection(supabaseUrl, supabaseAnonKey);
      if (!result.success) throw new Error(result.error);
      setTestStatus('success');
    } catch (err) {
      setTestStatus('error');
      setTestError(err.message || 'Error de red o credenciales inválidas.');
    }
  };

  const handleResetDemoMode = () => {
    if (window.confirm('¿Seguro que deseas limpiar las credenciales y volver al Modo Demo (con guardado local)?')) {
      localStorage.removeItem('supabase_url');
      localStorage.removeItem('supabase_anon_key');
      localStorage.removeItem('gemini_api_key');
      localStorage.removeItem('compras_categorias');
      localStorage.removeItem('compras_conceptos');
      localStorage.removeItem('compras_formas_pago');
      localStorage.removeItem('whatsapp_template');
      localStorage.removeItem('cierre_turnos');
      localStorage.removeItem('cierre_conceptos');
      localStorage.removeItem('rendiciones_config');
      setRendicionCajaNombre('Caja fuerte');
      setRendicionAllowAdelantos(true);
      setRendicionAllowCompras(true);
      setRendicionAllowPagos(true);
      localStorage.removeItem('arca_cuit');
      localStorage.removeItem('arca_razon_social');
      localStorage.removeItem('arca_nombre_comercial');
      localStorage.removeItem('arca_direccion');
      localStorage.removeItem('arca_punto_venta');
      localStorage.removeItem('arca_ambiente');
      localStorage.removeItem('arca_cert');
      localStorage.removeItem('arca_key');
      localStorage.removeItem('arca_token');
      setSupabaseUrl('');
      setSupabaseAnonKey('');
      setGeminiApiKey('');
      setWhatsappTemplate('Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!');
      setArcaCuit('');
      setArcaRazonSocial('');
      setArcaNombreComercial('');
      setArcaDireccion('');
      setArcaPuntoVenta('0001');
      setArcaAmbiente('homologacion');
      setArcaCert('');
      setArcaKey('');
      setArcaToken('');
      setTurnosList(["Mañana", "Tarde", "Delivery", "Noche"]);
      setConceptsList([
        { id: 'transferencia', label: 'Transferencia Bancaria', enabled: true },
        { id: 'tarjeta', label: 'Tarjeta (Crédito/Débito)', enabled: true },
        { id: 'qrPago', label: 'QR / Mercado Pago', enabled: true },
        { id: 'linkPago', label: 'Link de Pago', enabled: true },
        { id: 'ctaCte', label: 'Cuenta Corriente (Deuda)', enabled: true }
      ]);
      setComprasCategoriasList(["Mercadería", "Gasto", "Mantenimiento", "Inversión", "Servicio", "Impuesto"]);
      setComprasConceptosList([
        { id: 'c1', label: 'Alquiler', iva: 0 },
        { id: 'c2', label: 'Luz', iva: 21 },
        { id: 'c3', label: 'Gas', iva: 21 },
        { id: 'c4', label: 'Sueldos', iva: 0 },
        { id: 'c5', label: 'Repuestos', iva: 21 },
        { id: 'c6', label: 'Bolsas y descartables', iva: 21 },
        { id: 'c7', label: 'Fiambrería', iva: 21 },
        { id: 'c8', label: 'Bebidas', iva: 21 },
        { id: 'c9', label: 'Limpieza', iva: 21 },
        { id: 'c10', label: 'Insumos', iva: 21 }
      ]);
      setComprasFormasPagoList(["Efectivo", "Caja", "Rendición", "Transferencia", "Tarjeta", "Mercado Pago"]);
      setNewComprasCategoriaInput('');
      setNewComprasConceptoInput('');
      setNewComprasFormaPagoInput('');
      
      const defaultModules = {
        cierre: true,
        compras: true,
        adelantos: true,
        rendiciones: true,
        clientes: true,
        tareas: true,
        proveedores: true,
        empleados: true,
        resultados: true
      };
      setModules(defaultModules);
      db.saveModules(defaultModules);
      
      setSaveStatus('success');
      refreshModules();
      
      setTimeout(() => {
        setSaveStatus('');
        navigate('dashboard');
      }, 1500);
    }
  };

  const handleClearPedidos = async () => {
    if (window.confirm('¿Seguro que deseas eliminar todos los pedidos actuales? Esto vaciará el listado de pedidos y recalculará los saldos de clientes correspondientes. Esta acción no se puede deshacer.')) {
      setClearStatus('clearing');
      try {
        await db.clearAllPedidos();
        setClearStatus('success');
        setTimeout(() => {
          setClearStatus('');
        }, 3000);
      } catch (err) {
        console.error(err);
        setClearStatus('error');
        setTimeout(() => {
          setClearStatus('');
        }, 3000);
      }
    }
  };

  const handleClearCompras = async () => {
    if (window.confirm('¿Seguro que deseas eliminar todo el historial de compras? Esta acción no se puede deshacer.')) {
      setClearComprasStatus('clearing');
      try {
        await db.clearAllCompras();
        setClearComprasStatus('success');
        setTimeout(() => {
          setClearComprasStatus('');
        }, 3000);
      } catch (err) {
        console.error(err);
        setClearComprasStatus('error');
        setTimeout(() => {
          setClearComprasStatus('');
        }, 3000);
      }
    }
  };

  const ColorPicker = ({ moduleKey, showLabel = true }) => {
    const currentColor = moduleColors[moduleKey] || '';
    const usedColors = Object.values(moduleColors);

    return (
      <div className={showLabel ? "mt-3" : ""}>
        {showLabel && <label className="form-label fw-bold small text-muted mb-2">Color del Módulo</label>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '8px' }}>
          {PRESET_COLORS.map(color => {
            const isUsed = usedColors.includes(color) && currentColor !== color;
            const isSelected = currentColor === color;
            
            return (
              <div 
                key={color}
                onClick={() => !isUsed && setModuleColors(prev => ({ ...prev, [moduleKey]: color }))}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  backgroundColor: color,
                  cursor: isUsed ? 'not-allowed' : 'pointer',
                  border: isSelected ? '2px solid #1e293b' : '1px solid rgba(0,0,0,0.1)',
                  boxShadow: isSelected ? '0 0 0 2px white, 0 0 0 4px #3b82f6' : 'none',
                  opacity: isUsed ? 0.3 : 1,
                  position: 'relative',
                  transition: 'transform 0.1s ease',
                  zIndex: isSelected ? 1 : 0
                }}
                className={!isUsed ? 'hover-scale' : ''}
                title={isUsed ? 'Ya seleccionado en otro módulo' : ''}
              >
                {isSelected && (
                  <i className="bi bi-check" style={{ color: 'white', fontSize: '14px', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold' }}></i>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderModuleHeader = (moduleKey, label, desc, iconClass, colorClass) => {
    const hasDetails = ['cierre', 'compras', 'adelantos', 'rendiciones'].includes(moduleKey);
    const isExpanded = hasDetails && expandedModule === moduleKey;
    const isEnabled = modules[moduleKey] !== false;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: (isEnabled && isExpanded) ? '15px' : '0' }}>
        <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: (isEnabled && isExpanded) ? '10px' : '15px' }}>
          <div 
            className="toggle-info" 
            onClick={() => {
              if (isEnabled && hasDetails) {
                setExpandedModule(isExpanded ? null : moduleKey);
              }
            }} 
            style={{ 
              cursor: (isEnabled && hasDetails) ? 'pointer' : 'default', 
              opacity: isEnabled ? 1 : 0.6,
              flex: 1, 
              display: 'flex', 
              alignItems: 'center' 
            }}
          >
            <div style={{ width: '20px', marginRight: '10px', display: 'flex', justifyContent: 'center' }}>
              {isEnabled && hasDetails ? (
                <i 
                  className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} 
                  style={{ fontSize: '0.8rem', color: '#64748b' }}
                ></i>
              ) : null}
            </div>
            <span className={`toggle-icon ${colorClass}`} style={{ backgroundColor: moduleColors[moduleKey] || undefined }}>
              <i className={`bi ${iconClass}`}></i>
            </span>
            <div>
              <div className="toggle-label">{label}</div>
              <div className="toggle-desc">{desc}</div>
            </div>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isEnabled}
              onChange={() => handleToggleModule(moduleKey)}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>
    );
  };

  const getModuleIcon = (key) => {
    switch (key) {
      case 'cierre': return 'bi-currency-dollar';
      case 'compras': return 'bi-cart-fill';
      case 'adelantos': return 'bi-cash-stack';
      case 'pago-proveedores': return 'bi-wallet2';
      case 'pago-impuestos': return 'bi-receipt';
      case 'rendiciones': return 'bi-clipboard-data';
      case 'pagos-periodicos': return 'bi-calendar-check';
      case 'clientes': return 'bi-journal-text';
      case 'tareas': return 'bi-list-check';
      case 'proveedores': return 'bi-truck';
      case 'empleados': return 'bi-person-badge';
      case 'resultados': return 'bi-graph-up';
      default: return 'bi-grid';
    }
  };

  const handleColorDrop = (targetModuleKey, color) => {
    setModuleColors(prev => {
      const nextColors = { ...prev };
      const duplicateKey = Object.keys(nextColors).find(key => nextColors[key] === color && key !== targetModuleKey);
      
      if (duplicateKey) {
        // Swap colors!
        const oldColor = nextColors[targetModuleKey];
        nextColors[duplicateKey] = oldColor;
      }
      
      nextColors[targetModuleKey] = color;
      return nextColors;
    });
  };

  return (
    <div className="page-card" style={{ borderLeft: '5px solid #64748b' }}>
      <h2 className="page-title text-dark">
        <i className="bi bi-gear-fill text-secondary"></i> Configuración del Sistema
      </h2>

      {/* Mode Info Alert */}
      <div className="alert-box" style={{ backgroundColor: '#f1f5f9', borderColor: '#cbd5e1', color: '#334155' }}>
        <i className="bi bi-info-circle-fill text-secondary"></i>
        <div>
          <strong>Información:</strong> Puedes configurar la conexión a tu base de datos de <strong>Supabase</strong> para sincronizar los datos en la nube. Si dejas las credenciales vacías, la terminal funcionará en <strong>Modo Demo</strong> guardando datos temporalmente en tu navegador.
        </div>
      </div>

      <form onSubmit={handleSaveConfig}>
        {/* GROUP 1: CONFIGURACIÓN */}
        <div style={{ marginBottom: '35px' }}>
          <div 
            onClick={() => setConfigExpanded(!configExpanded)}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              borderBottom: '2px solid var(--border-color)', 
              paddingBottom: '8px', 
              marginBottom: '20px', 
              cursor: 'pointer' 
            }}
          >
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-dark)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className={`bi bi-chevron-${configExpanded ? 'down' : 'right'}`} style={{ fontSize: '1rem' }}></i>
              <i className="bi bi-gear-fill text-secondary"></i> Configuración
            </h3>
          </div>

          {configExpanded && (
            <div style={{ 
              padding: '20px', 
              backgroundColor: '#f8fafc', 
              borderRadius: '10px', 
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '15px'
            }}>
              
              {/* Config: Base de Datos Supabase */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: expandedModule === 'db' ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: expandedModule === 'db' ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'db' ? null : 'db')} 
                    style={{ 
                      cursor: 'pointer', 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <i 
                      className={`bi bi-chevron-${expandedModule === 'db' ? 'down' : 'right'}`} 
                      style={{ 
                        fontSize: '1.25rem', 
                        color: 'var(--text-dark)', 
                        marginRight: '12px',
                        fontWeight: 'bold',
                        WebkitTextStroke: '0.8px',
                        cursor: 'pointer',
                        display: 'inline-block',
                        width: '16px',
                        textAlign: 'center'
                      }}
                    ></i>
                    <span className="toggle-icon bg-config"><i className="bi bi-database-fill"></i></span>
                    <div>
                      <div className="toggle-label">Base de Datos Supabase</div>
                      <div className="toggle-desc">Configurar credenciales de conexión en la nube y probar enlace.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'db' && (
                  <div style={{ 
                    padding: '15px 20px', 
                    backgroundColor: '#fff', 
                    borderRadius: '8px', 
                    border: '1px solid #cbd5e1',
                    marginLeft: '55px',
                    marginTop: '4px',
                    marginBottom: '5px'
                  }}>
                    <div className="form-group">
                      <label className="form-label">Supabase Project URL</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="https://xxxxxx.supabase.co"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Supabase Anon Key</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        value={supabaseAnonKey}
                        onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      />
                    </div>

                    <div className="form-group" style={{ marginTop: '15px' }}>
                      <label className="form-label">Gemini API Key (Para lectura de facturas con IA)</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="AIzaSy..."
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                      <button 
                        type="button" 
                        className="btn-new-task" 
                        style={{ backgroundColor: '#475569', padding: '8px 16px', fontSize: '0.85rem' }}
                        onClick={handleTestConnection}
                        disabled={testStatus === 'testing'}
                      >
                        {testStatus === 'testing' ? (
                          <span><i className="bi bi-hourglass-split me-2"></i>Conectando...</span>
                        ) : (
                          <span><i className="bi bi-cloud-lightning-fill me-2"></i>Probar Conexión</span>
                        )}
                      </button>

                      <button 
                        type="button" 
                        className="btn-new-task" 
                        style={{ backgroundColor: '#0ea5e9', padding: '8px 16px', fontSize: '0.85rem' }}
                        onClick={handleHistoricalSync}
                        disabled={syncStatus === 'syncing'}
                      >
                        {syncStatus === 'syncing' ? (
                          <span><i className="bi bi-hourglass-split me-2"></i>Sincronizando...</span>
                        ) : (
                          <span><i className="bi bi-database-down me-2"></i>Importar Datos Viejos</span>
                        )}
                      </button>

                      {(supabaseUrl || supabaseAnonKey) && (
                        <button 
                          type="button" 
                          className="btn-nav-back" 
                          style={{ padding: '8px 16px', fontSize: '0.85rem', color: '#ef4444' }}
                          onClick={handleResetDemoMode}
                        >
                          <i className="bi bi-trash-fill me-2"></i>Limpiar Credenciales
                        </button>
                      )}
                    </div>

                    {syncStatus === 'success' && (
                      <div className="alert-box-success" style={{ marginTop: '15px' }}>
                        <i className="bi bi-check-circle-fill"></i>
                        <div>{syncMessage}</div>
                      </div>
                    )}

                    {syncStatus === 'error' && (
                      <div className="alert-box" style={{ marginTop: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                        <i className="bi bi-exclamation-triangle-fill"></i>
                        <div>{syncMessage}</div>
                      </div>
                    )}

                    {testStatus === 'success' && (
                      <div className="alert-box-success" style={{ marginTop: '15px' }}>
                        <i className="bi bi-check-circle-fill"></i>
                        <div><strong>¡Conexión Exitosa!</strong> Las tablas son accesibles y el cliente se inicializó correctamente.</div>
                      </div>
                    )}

                    {testStatus === 'error' && (
                      <div className="alert-box" style={{ marginTop: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                        <i className="bi bi-exclamation-triangle-fill"></i>
                        <div><strong>Error de Conexión:</strong> {testError}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Config: Credenciales ARCA */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: expandedModule === 'arca' ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: expandedModule === 'arca' ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'arca' ? null : 'arca')} 
                    style={{ 
                      cursor: 'pointer', 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <i 
                      className={`bi bi-chevron-${expandedModule === 'arca' ? 'down' : 'right'}`} 
                      style={{ 
                        fontSize: '1.25rem', 
                        color: 'var(--text-dark)', 
                        marginRight: '12px',
                        fontWeight: 'bold',
                        WebkitTextStroke: '0.8px',
                        cursor: 'pointer',
                        display: 'inline-block',
                        width: '16px',
                        textAlign: 'center'
                      }}
                    ></i>
                    <span className="toggle-icon" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}><i className="bi bi-file-earmark-text-fill"></i></span>
                    <div>
                      <div className="toggle-label">Credenciales ARCA (Facturación Electrónica)</div>
                      <div className="toggle-desc">Configurar CUIT, razón social, certificados y token para emitir facturas.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'arca' && (
                  <div style={{ 
                    padding: '15px 20px', 
                    backgroundColor: '#fff', 
                    borderRadius: '8px', 
                    border: '1px solid #cbd5e1',
                    marginLeft: '55px',
                    marginTop: '4px',
                    marginBottom: '5px'
                  }}>
                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '15px' }}>
                      <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>CUIT del Emisor</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Ej: 20-12345678-9"
                          value={arcaCuit}
                          onChange={(e) => handleCuitChange(e.target.value, setArcaCuit)}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>

                      <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Razón Social / Nombre Emisor</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Ej: Rincón Natural S.H."
                          value={arcaRazonSocial}
                          onChange={(e) => setArcaRazonSocial(e.target.value)}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>

                      <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Nombre Comercial (Fantasía)</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Ej: Rincón Natural"
                          value={arcaNombreComercial}
                          onChange={(e) => setArcaNombreComercial(e.target.value)}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '15px' }}>
                      <div className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Dirección Comercial</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Ej: Av. Argentina 123, Neuquén"
                          value={arcaDireccion}
                          onChange={(e) => setArcaDireccion(e.target.value)}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>

                      <div className="form-group" style={{ flex: '1 1 100px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Punto de Venta</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Ej: 0001"
                          value={arcaPuntoVenta}
                          onChange={(e) => setArcaPuntoVenta(e.target.value.replace(/\D/g, '').substring(0, 4))}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>

                      <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Ambiente</label>
                        <select 
                          className="form-select"
                          value={arcaAmbiente}
                          onChange={(e) => setArcaAmbiente(e.target.value)}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        >
                          <option value="homologacion">Homologación (Pruebas)</option>
                          <option value="produccion">Producción (Real)</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group" style={{ margin: '0 0 15px 0' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Token de Acceso AfipSDK (Requerido para evitar bloqueos de IP en producción)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Pegar token de app.afipsdk.com..."
                        value={arcaToken}
                        onChange={(e) => setArcaToken(e.target.value)}
                        style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px', fontFamily: 'monospace' }}
                      />
                    </div>

                    <div className="form-group" style={{ margin: '0 0 15px 0' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Certificado Digital (.crt)</label>
                      <textarea 
                        className="form-input" 
                        placeholder="-----BEGIN CERTIFICATE-----\nMIIEADCCAuegAwIBAgII..."
                        value={arcaCert}
                        onChange={(e) => setArcaCert(e.target.value)}
                        style={{ minHeight: '80px', fontSize: '0.75rem', fontFamily: 'monospace' }}
                      />
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Clave Privada (.key)</label>
                      <textarea 
                        className="form-input" 
                        placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC..."
                        value={arcaKey}
                        onChange={(e) => setArcaKey(e.target.value)}
                        style={{ minHeight: '80px', fontSize: '0.75rem', fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Config: Acciones de Datos */}
              <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: expandedModule === 'datos' ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: expandedModule === 'datos' ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'datos' ? null : 'datos')} 
                    style={{ 
                      cursor: 'pointer', 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <i 
                      className={`bi bi-chevron-${expandedModule === 'datos' ? 'down' : 'right'}`} 
                      style={{ 
                        fontSize: '1.25rem', 
                        color: 'var(--text-dark)', 
                        marginRight: '12px',
                        fontWeight: 'bold',
                        WebkitTextStroke: '0.8px',
                        cursor: 'pointer',
                        display: 'inline-block',
                        width: '16px',
                        textAlign: 'center'
                      }}
                    ></i>
                    <span className="toggle-icon" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)' }}><i className="bi bi-trash-fill"></i></span>
                    <div>
                      <div className="toggle-label">Acciones de Datos</div>
                      <div className="toggle-desc">Vaciar historial de pedidos o compras del sistema local/nube.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'datos' && (
                  <div style={{ 
                    padding: '15px 20px', 
                    backgroundColor: '#fff', 
                    borderRadius: '8px', 
                    border: '1px solid #cbd5e1',
                    marginLeft: '55px',
                    marginTop: '4px',
                    marginBottom: '5px'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Permite vaciar las tablas de pedidos y restablecer los saldos deudores de las cuentas corrientes de los clientes correspondientes.
                      </div>
                      <button 
                        type="button" 
                        className="btn-nav-back" 
                        style={{ 
                          padding: '10px 16px', 
                          fontSize: '0.85rem', 
                          color: '#ffffff', 
                          backgroundColor: '#ef4444', 
                          border: 'none',
                          alignSelf: 'flex-start',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onClick={handleClearPedidos}
                        disabled={clearStatus === 'clearing'}
                      >
                        <i className="bi bi-trash-fill"></i>
                        {clearStatus === 'clearing' ? 'Eliminando...' : 'Eliminar todos los pedidos actuales'}
                      </button>
                      {clearStatus === 'success' && (
                        <div className="alert-box-success" style={{ marginTop: '10px' }}>
                          <i className="bi bi-check-circle-fill"></i>
                          <div>Todos los pedidos han sido eliminados y los saldos de clientes restablecidos.</div>
                        </div>
                      )}
                      {clearStatus === 'error' && (
                        <div className="alert-box" style={{ marginTop: '10px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                          <i className="bi bi-exclamation-triangle-fill"></i>
                          <div>Error al intentar eliminar los pedidos del sistema.</div>
                        </div>
                      )}

                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '20px', borderTop: '1px dashed var(--border-color)', paddingTop: '15px' }}>
                        Permite vaciar todo el historial de compras registradas en el sistema.
                      </div>
                      <button 
                        type="button" 
                        className="btn-nav-back" 
                        style={{ 
                          padding: '10px 16px', 
                          fontSize: '0.85rem', 
                          color: '#ffffff', 
                          backgroundColor: '#ef4444', 
                          border: 'none',
                          alignSelf: 'flex-start',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onClick={handleClearCompras}
                        disabled={clearComprasStatus === 'clearing'}
                      >
                        <i className="bi bi-trash-fill"></i>
                        {clearComprasStatus === 'clearing' ? 'Eliminando...' : 'Eliminar historial de compras'}
                      </button>
                      {clearComprasStatus === 'success' && (
                        <div className="alert-box-success" style={{ marginTop: '10px' }}>
                          <i className="bi bi-check-circle-fill"></i>
                          <div>Todo el historial de compras ha sido eliminado del sistema.</div>
                        </div>
                      )}
                      {clearComprasStatus === 'error' && (
                        <div className="alert-box" style={{ marginTop: '10px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                          <i className="bi bi-exclamation-triangle-fill"></i>
                          <div>Error al intentar eliminar el historial de compras del sistema.</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* GROUP 2: MÓDULOS OPERATIVOS */}
        <div style={{ marginBottom: '30px' }}>
          <div 
            onClick={() => setModulesExpanded(!modulesExpanded)}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              borderBottom: '2px solid var(--border-color)', 
              paddingBottom: '8px', 
              marginBottom: '20px', 
              cursor: 'pointer' 
            }}
          >
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-dark)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className={`bi bi-chevron-${modulesExpanded ? 'down' : 'right'}`} style={{ fontSize: '1rem' }}></i>
              <i className="bi bi-grid-fill text-secondary"></i> Módulos
            </h3>
          </div>

          {modulesExpanded && (
            <div style={{ 
              padding: '20px', 
              backgroundColor: '#f8fafc', 
              borderRadius: '10px', 
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '15px'
            }}>
              
              {/* Cierre */}
              {renderModuleHeader('cierre', 'Cerrar Caja', 'Cierre de turnos y arqueo de efectivo.', 'bi-currency-dollar', 'bg-cierre')}
              {modules.cierre && expandedModule === 'cierre' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label className="form-label fw-bold small text-muted mb-2">Turnos / Cajas disponibles</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff' }}>
                      {turnosList.map((t, i) => (
                        <span key={i} className="badge bg-light text-dark border d-flex align-items-center gap-2">
                          {t} <i className="bi bi-x cursor-pointer" onClick={() => handleRemoveTurnoTag(i)}></i>
                        </span>
                      ))}
                    </div>
                    <div className="d-flex gap-2">
                      <input type="text" className="form-input" placeholder="Nueva caja..." value={newTurnoInput} onChange={e => setNewTurnoInput(e.target.value)} />
                      <button type="button" className="btn-new-task" onClick={handleAddTurnoTag}><i className="bi bi-plus-lg"></i></button>
                    </div>
                  </div>
                  <div>
                    <label className="form-label fw-bold small text-muted mb-2">Medios de Cobro Habilitados</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff' }}>
                      {conceptsList.filter(c => c.enabled).map((c) => (
                        <span key={c.id} className="badge bg-light text-dark border d-flex align-items-center gap-2">
                          {c.label} <i className="bi bi-x cursor-pointer" onClick={() => handleRemoveConceptTag(c.id)}></i>
                        </span>
                      ))}
                    </div>
                    <div className="d-flex gap-2">
                      <input type="text" className="form-input" placeholder="Nuevo medio..." value={newConceptInput} onChange={e => setNewConceptInput(e.target.value)} />
                      <button type="button" className="btn-new-task" onClick={handleAddConceptTag}><i className="bi bi-plus-lg"></i></button>
                    </div>
                  </div>
                </div>
              )}

              {/* Compras */}
              {renderModuleHeader('compras', 'Compras', 'Registro de egresos y facturas de proveedores.', 'bi-cart-fill', 'bg-compras')}
              {modules.compras && expandedModule === 'compras' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div className="small text-muted">Las categorías y formas de pago de compras se configuran en sus respectivas secciones.</div>
                  </div>
                </div>
              )}

              {/* Adelantos */}
              {renderModuleHeader('adelantos', 'Adelantos', 'Retiros de empleados (Dinero/Mercadería).', 'bi-cash-stack', 'bg-adelantos')}
              {modules.adelantos && expandedModule === 'adelantos' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label className="d-flex align-items-center gap-2 small cursor-pointer">
                      <input type="checkbox" checked={allowDinero} onChange={e => setAllowDinero(e.target.checked)} /> Permitir Efectivo
                    </label>
                    <label className="d-flex align-items-center gap-2 small cursor-pointer">
                      <input type="checkbox" checked={allowMercaderia} onChange={e => setAllowMercaderia(e.target.checked)} /> Permitir Mercadería
                    </label>
                  </div>
                  {allowDinero && (
                    <div className="mt-2">
                      <label className="form-label fw-bold small text-muted mb-2">Cajas habilitadas para dinero</label>
                      <div className="d-flex flex-wrap gap-2">
                        <label className="small d-flex align-items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={rendicionAllowAdelantos} onChange={e => setRendicionAllowAdelantos(e.target.checked)} /> {rendicionCajaNombre}
                        </label>
                        {turnosList.map(t => (
                          <label key={t} className="small d-flex align-items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={cajasPosibles.includes(t)} onChange={() => handleToggleCajaPosible(t)} /> {t}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Rendiciones */}
              {renderModuleHeader('rendiciones', 'Caja fuerte', 'Historial y saldos de caja fuerte (Rendiciones).', 'bi-clipboard-data', 'bg-rendiciones')}

                {modules.rendiciones && expandedModule === 'rendiciones' && (
                  <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* Caja Nombre input */}
                    <div className="form-group" style={{ maxWidth: '280px', margin: 0 }}>
                      <label className="form-label fw-bold small text-muted">Nombre de la Caja / Fondo</label>
                      <input 
                        type="text" 
                        placeholder="Caja fuerte"
                        className="form-input" 
                        value={rendicionCajaNombre}
                        onChange={(e) => setRendicionCajaNombre(e.target.value)}
                        style={{ fontSize: '0.85rem', padding: '8px 10px', height: '36px', marginTop: '5px' }}
                      />
                      <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block', marginTop: '4px' }}>
                        Nombre a mostrar en los listados y formularios de registro (ej: Caja fuerte, Rendición, Caja Chica).
                      </small>
                    </div>

                    {/* New: Operarios can withdraw money (Top and Right-aligned) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed #e2e8f0', marginBottom: '10px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-dark)' }}>Operarios pueden retirar dinero</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Habilita el botón de retiro en Caja fuerte para usuarios con nivel Operario.</div>
                      </div>
                      <label className="switch" style={{ marginLeft: '15px' }}>
                        <input 
                          type="checkbox" 
                          checked={operarioCanRetiros}
                          onChange={(e) => setOperarioCanRetiros(e.target.checked)}
                        />
                        <span className="slider round"></span>
                      </label>
                    </div>

                    {/* Permissions / Usage Checkboxes */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label fw-bold small text-muted">MODULOS habilitados para su Uso</label>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '5px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                          <input 
                            type="checkbox" 
                            checked={rendicionAllowCompras} 
                            onChange={(e) => setRendicionAllowCompras(e.target.checked)} 
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          Compras
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                          <input 
                            type="checkbox" 
                            checked={rendicionAllowPagos} 
                            onChange={(e) => setRendicionAllowPagos(e.target.checked)} 
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          Pagos
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                          <input 
                            type="checkbox" 
                            checked={rendicionAllowAdelantos} 
                            onChange={(e) => setRendicionAllowAdelantos(e.target.checked)} 
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          Adelantos
                        </label>
                      </div>

                    </div>
                  </div>
                )}

              {/* Clientes / Pedidos */}
              {renderModuleHeader('clientes', 'Pedidos', 'Registro de pedidos, direcciones y saldos de clientes.', 'bi-journal-text', 'bg-clientes')}

              {/* Pago Proveedores */}
              {renderModuleHeader('pago-proveedores', 'Pago Proveedores', 'Gestión de pagos a proveedores y caja chica.', 'bi-wallet2', 'bg-success')}

              {/* Pago Impuestos/Servicios */}
              {renderModuleHeader('pago-impuestos', 'Pago Impuestos/Servicios', 'Pago de servicios, tasas e impuestos periódicos sin factura.', 'bi-receipt', 'bg-success')}

              {/* Tareas */}
              {renderModuleHeader('tareas', 'Tareas del Dashboard', 'Listado de tareas de mantenimiento/limpieza.', 'bi-list-check', 'bg-config')}

              {/* Proveedores */}
              {renderModuleHeader('proveedores', 'Módulo Proveedores', 'Cuenta corriente y registro de pagos a proveedores.', 'bi-truck', 'bg-info')}

              {/* Empleados */}
              {renderModuleHeader('empleados', 'Módulo Empleados', 'Gestión de personal y adelantos/sueldos.', 'bi-person-badge', 'bg-primary')}

              {/* Resultados */}
              {renderModuleHeader('resultados', 'Módulo Resultados', 'Dashboard de estadísticas y utilidad.', 'bi-graph-up', 'bg-dark')}

              {/* Pagos Periódicos */}
              {renderModuleHeader('pagos-periodicos', 'Módulo Pagos Periódicos', 'Gestión de gastos recurrentes y vencimientos.', 'bi-calendar-check', 'bg-secondary')}

              {/* Permisos por Categoría (No es módulo, no lleva color picker) */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: (expandedModule === 'role_perms') ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: (expandedModule === 'role_perms') ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'role_perms' ? null : 'role_perms')} 
                    style={{ 
                      cursor: 'pointer', 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <i 
                      className={`bi bi-chevron-${expandedModule === 'role_perms' ? 'down' : 'right'}`} 
                      style={{ 
                        fontSize: '1.25rem', 
                        color: 'var(--text-dark)', 
                        marginRight: '12px',
                        fontWeight: 'bold',
                        WebkitTextStroke: '0.8px',
                        cursor: 'pointer',
                        display: 'inline-block',
                        width: '16px',
                        textAlign: 'center'
                      }}
                    ></i>
                    <span className="toggle-icon" style={{ backgroundColor: '#475569' }}><i className="bi bi-shield-lock-fill"></i></span>
                    <div>
                      <div className="toggle-label">Permisos por Categoría</div>
                      <div className="toggle-desc">Habilitar accesos extras para Operarios y Cajeros.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'role_perms' && (
                  <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Cajero puede ver Compras</div>
                        <div className="small text-muted">Habilita el acceso al módulo de Compras para el nivel Cajero.</div>
                      </div>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={cajeroCanCompras}
                          onChange={(e) => setCajeroCanCompras(e.target.checked)}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Operario puede ver Caja fuerte</div>
                        <div className="small text-muted">Habilita el acceso al módulo de Rendiciones (Caja fuerte) para el nivel Operario.</div>
                      </div>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={operarioCanRetiros}
                          onChange={(e) => setOperarioCanRetiros(e.target.checked)}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Configuración WhatsApp (No es módulo, no lleva color picker) */}
              <div className="toggle-item" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="toggle-info" onClick={() => setExpandedModule(expandedModule === 'whatsapp' ? null : 'whatsapp')} style={{ cursor: 'pointer' }}>
                  <div style={{ width: '16px', marginRight: '12px' }}>
                    <i className={`bi bi-chevron-${expandedModule === 'whatsapp' ? 'down' : 'right'}`} style={{ fontSize: '0.8rem' }}></i>
                  </div>
                  <span className="toggle-icon bg-success"><i className="bi bi-whatsapp"></i></span>
                  <div>
                    <div className="toggle-label">Configuración WhatsApp</div>
                    <div className="toggle-desc">Personalizar mensajes de envío.</div>
                  </div>
                </div>

                {expandedModule === 'whatsapp' && (
                  <div style={{ 
                    padding: '15px 15px 15px 45px', 
                    backgroundColor: 'var(--bg-light)', 
                    borderRadius: '8px',
                    marginTop: '10px',
                    marginBottom: '5px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)', minWidth: '150px' }}>
                        Mensaje WhatsApp:
                      </span>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Mensaje de WhatsApp..."
                        value={whatsappTemplate}
                        onChange={(e) => setWhatsappTemplate(e.target.value)}
                        style={{ fontSize: '0.85rem', padding: '6px 10px', flex: '1 1 250px', height: '34px', margin: 0 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Colores de Módulos (Consolidado y Drag & Drop) */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: (expandedModule === 'colors') ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: (expandedModule === 'colors') ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'colors' ? null : 'colors')} 
                    style={{ 
                      cursor: 'pointer', 
                      flex: 1, 
                      display: 'flex', 
                      alignItems: 'center' 
                    }}
                  >
                    <div style={{ width: '16px', marginRight: '12px' }}>
                      <i className={`bi bi-chevron-${expandedModule === 'colors' ? 'down' : 'right'}`} style={{ fontSize: '0.8rem' }}></i>
                    </div>
                    <span className="toggle-icon" style={{ backgroundColor: '#f59e0b' }}><i className="bi bi-palette-fill"></i></span>
                    <div>
                      <div className="toggle-label">Colores de Módulos</div>
                      <div className="toggle-desc">Personalizar colores arrastrándolos sobre cada módulo.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'colors' && (
                  <div style={{ padding: '10px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div className="small text-muted" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                      <i className="bi bi-info-circle me-1 text-primary"></i>
                      <strong>¿Cómo usar?</strong> Arrastra un color de la paleta y suéltalo sobre un módulo. También puedes hacer clic en un módulo para seleccionarlo y luego tocar un color en la paleta. Si arrastras un color ya asignado, se intercambiarán.
                    </div>

                    {/* La Paleta Única */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Paleta de Colores</div>
                      <div style={{ 
                        display: 'flex', 
                        flexWrap: 'wrap', 
                        gap: '10px', 
                        padding: '12px', 
                        backgroundColor: '#f8fafc', 
                        borderRadius: '10px', 
                        border: '1px solid #e2e8f0',
                        justifyContent: 'center'
                      }}>
                        {PRESET_COLORS.map(color => {
                          const isUsed = Object.values(moduleColors).includes(color);
                          const associatedModuleKey = Object.keys(moduleColors).find(k => moduleColors[k] === color && modules[k] !== false);
                          
                          const associatedLabel = associatedModuleKey === 'cierre' ? 'Cerrar Caja' :
                                                   associatedModuleKey === 'compras' ? 'Compras' :
                                                   associatedModuleKey === 'adelantos' ? 'Adelantos' :
                                                   associatedModuleKey === 'pago-proveedores' ? 'Pago Proveedores' :
                                                   associatedModuleKey === 'pago-impuestos' ? 'Pago Impuestos/Servicios' :
                                                   associatedModuleKey === 'rendiciones' ? 'Caja fuerte' :
                                                   associatedModuleKey === 'pagos-periodicos' ? 'Pagos Periódicos' :
                                                   associatedModuleKey === 'clientes' ? 'Pedidos' :
                                                   associatedModuleKey === 'tareas' ? 'Tareas del Dashboard' :
                                                   associatedModuleKey === 'proveedores' ? 'Módulo Proveedores' :
                                                   associatedModuleKey === 'empleados' ? 'Módulo Empleados' :
                                                   associatedModuleKey === 'resultados' ? 'Módulo Resultados' : associatedModuleKey;

                          const tooltip = associatedModuleKey 
                            ? `En uso por: ${associatedLabel} (arrástralo para intercambiar)` 
                            : 'Disponible';

                          return (
                            <div
                              key={color}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("color", color);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onClick={() => {
                                if (selectedModuleForColor) {
                                  handleColorDrop(selectedModuleForColor, color);
                                  setSelectedModuleForColor(null);
                                }
                              }}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                backgroundColor: color,
                                cursor: selectedModuleForColor ? 'pointer' : 'grab',
                                border: '2px solid white',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                opacity: isUsed ? 0.35 : 1,
                                transform: selectedModuleForColor ? 'scale(1.15)' : 'scale(1)',
                                transition: 'all 0.15s ease'
                              }}
                              className="hover-scale"
                              title={tooltip}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Lista de Módulos Activos (Drop Targets) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Módulos Habilitados (Suelta el color aquí)</div>
                      {Object.keys(modules)
                        .filter(k => modules[k] !== false)
                        .map(k => {
                          const label = k === 'cierre' ? 'Cerrar Caja' :
                                        k === 'compras' ? 'Compras' :
                                        k === 'adelantos' ? 'Adelantos' :
                                        k === 'pago-proveedores' ? 'Pago Proveedores' :
                                        k === 'pago-impuestos' ? 'Pago Impuestos/Servicios' :
                                        k === 'rendiciones' ? 'Caja fuerte' :
                                        k === 'pagos-periodicos' ? 'Módulo Pagos Periódicos' :
                                        k === 'clientes' ? 'Pedidos' :
                                        k === 'tareas' ? 'Tareas del Dashboard' :
                                        k === 'proveedores' ? 'Módulo Proveedores' :
                                        k === 'empleados' ? 'Módulo Empleados' :
                                        k === 'resultados' ? 'Módulo Resultados' : k;

                          const isDragOver = dragOverModule === k;
                          const isSelected = selectedModuleForColor === k;

                          return (
                            <div
                              key={k}
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnter={() => setDragOverModule(k)}
                              onDragLeave={() => setDragOverModule(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverModule(null);
                                const droppedColor = e.dataTransfer.getData("color");
                                if (droppedColor) {
                                  handleColorDrop(k, droppedColor);
                                }
                              }}
                              onClick={() => setSelectedModuleForColor(isSelected ? null : k)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px 15px',
                                borderRadius: '8px',
                                border: isDragOver 
                                  ? '2px dashed #3b82f6' 
                                  : isSelected 
                                    ? '2px solid #3b82f6' 
                                    : '1px solid #e2e8f0',
                                backgroundColor: isDragOver 
                                  ? '#eff6ff' 
                                  : isSelected 
                                    ? '#f0f9ff' 
                                    : '#fff',
                                boxShadow: isSelected ? '0 2px 4px rgba(59,130,246,0.1)' : 'none',
                                transition: 'all 0.15s ease',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span 
                                  className="toggle-icon" 
                                  style={{ 
                                    backgroundColor: moduleColors[k] || '#cbd5e1', 
                                    width: '32px', 
                                    height: '32px', 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    borderRadius: '8px',
                                    color: '#fff',
                                    fontSize: '1rem',
                                    transition: 'background-color 0.2s ease'
                                  }}
                                >
                                  <i className={`bi ${getModuleIcon(k)}`}></i>
                                </span>
                                <div>
                                  <div style={{ fontWeight: 'bold', fontSize: '0.88rem', color: isSelected ? '#0369a1' : 'var(--text-dark)' }}>{label}</div>
                                  {isSelected && <span style={{ fontSize: '0.7rem', color: '#0284c7' }}>Seleccionado. Elige un color de la paleta arriba.</span>}
                                </div>
                              </div>

                              {/* Bubble Drop target / Current Color preview */}
                              <div style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                backgroundColor: moduleColors[k] || '#cbd5e1',
                                border: isDragOver ? '3px dashed #3b82f6' : isSelected ? '3px solid #3b82f6' : '3px solid #f1f5f9',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                transform: isDragOver ? 'scale(1.15)' : 'scale(1)',
                                transition: 'all 0.15s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}>
                                {isDragOver && (
                                  <i className="bi bi-download" style={{ color: 'white', fontSize: '1rem', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}></i>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Submit Save */}
        <div style={{ marginTop: '30px' }}>
          {saveStatus === 'success' && (
            <div className="alert-box-success" style={{ marginBottom: '15px' }}>
              <i className="bi bi-check-circle-fill"></i>
              <div>¡Configuración guardada correctamente! Redirigiendo...</div>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="alert-box" style={{ marginBottom: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
              <i className="bi bi-exclamation-circle-fill"></i>
              <div>Error al intentar guardar en el navegador.</div>
            </div>
          )}
          <button type="submit" className="btn-submit" style={{ padding: '14px', fontSize: '1.05rem' }}>
            GUARDAR Y APLICAR CAMBIOS
          </button>
        </div>
      </form>
    </div>
  )
}

export default Configuration;
