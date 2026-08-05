import React, { useState, useEffect } from 'react';
import { db, isSupabaseConfigured, testSupabaseConnection, forceHistoricalSync, hasEnvSupabaseCredentials } from '../supabaseClient'
import {
  normalizeRolePermissions,
  toggleMatrixPermission,
  updateRoleLabel,
  getEnabledPermissionModules,
  ROLE_KEYS,
} from '../rolePermissions'
import { MODULE_LABELS, MODULE_DESCRIPTIONS, getModuleLabel, DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels'
import { buildArcaConfigFromForm } from '../arcaConfig'
import { DEFAULT_COMPRAS_CATEGORIES, normalizeComprasCategories } from '../expenseTypes'
import { ADELANTO_EFECTIVO, ADELANTO_MERCADERIA } from '../adelantoConcepts'
import {
  CIERRE_MEDIOS_SLOTS,
  createDefaultCierreMedios,
  getConfiguredMedios,
  getNextEmptyMedioSlot,
  canDeleteMedio,
  canToggleMedio,
} from '../cierreMedios'
import {
  DEFAULT_CIERRE_TURNOS,
  normalizeCierreTurnos,
  getTurnoName,
  getCierreTurnoNames,
} from '../cierreTurnos'
import {
  normalizePedidosCajasConfig,
  togglePedidosCajaFlag,
  initPedidosCajaAssignment,
  normalizeCajaAssignment,
  localPedidosManagedExternally,
} from '../pedidosCajas'
import {
  notificationsConfigToForm,
  notificationsFormToConfig,
} from '../notificationConfig'

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

  // Supabase credentials state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  
  // Pedidos — mensaje WhatsApp para reparto
  const [whatsappTemplate, setWhatsappTemplate] = useState('Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!');
  
  // Cierre settings
  const [turnosList, setTurnosList] = useState([]);
  const [pedidosCajasConfig, setPedidosCajasConfig] = useState({ assignments: {} });
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
  const [openColorPickerModule, setOpenColorPickerModule] = useState(null);

  // Rendiciones configuration settings
  const [rendicionCajaNombre, setRendicionCajaNombre] = useState(DEFAULT_CAJA_FUERTE_NAME);
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

  const [notificationsForm, setNotificationsForm] = useState(() => notificationsConfigToForm(null));
  
  // UI States
  const [saveStatus, setSaveStatus] = useState(''); // 'success', 'error', ''
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const [testStatus, setTestStatus] = useState(''); // 'testing', 'success', 'error', ''
  const [testError, setTestError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [supabaseFromEnv, setSupabaseFromEnv] = useState(false);

  const [rolePermissionsConfig, setRolePermissionsConfig] = useState(() => normalizeRolePermissions(null, {}));

  // Load configuration on mount
  useEffect(() => {
    async function initConfig() {
      try {
        const [m, t, pc, c, cc, cco, cp, rp, arca, notifications] = await Promise.all([
          db.getModules(),
          db.getCierreTurnos(),
          db.getPedidosCajasConfig(),
          db.getCierreConceptos(),
          db.getComprasCategorias(),
          db.getComprasConceptos(),
          db.getComprasFormasPago(),
          db.getRolePermissions(),
          db.getArcaConfig(),
          db.getNotificationsConfig(),
        ]);
        
        setModules(m || {});
        setTurnosList(t || []);
        setPedidosCajasConfig(pc || { assignments: {} });
        
        const formattedCats = (cc || []).map(cat => {
          if (typeof cat === 'string') return { name: cat, details: [] };
          return cat;
        });
        setComprasCategoriasList(normalizeComprasCategories(formattedCats));
        
        setComprasConceptosList(cco || []);
        setComprasFormasPagoList(cp || []);
        
        if (rp) {
          setRolePermissionsConfig(normalizeRolePermissions(rp, m || {}));
        } else {
          const lp = JSON.parse(localStorage.getItem('role_permissions') || '{}');
          setRolePermissionsConfig(normalizeRolePermissions(lp, m || {}));
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

        if (arca) {
          setArcaCuit(formatCuit(arca.cuit || ''));
          setArcaRazonSocial(arca.razon_social || '');
          setArcaNombreComercial(arca.nombre_comercial || '');
          setArcaDireccion(arca.direccion || '');
          setArcaPuntoVenta(arca.punto_venta || '0001');
          setArcaAmbiente(arca.ambiente || 'homologacion');
          setArcaCert(arca.cert || '');
          setArcaKey(arca.private_key || '');
          setArcaToken(arca.token || '');
        }

        setNotificationsForm(notificationsConfigToForm(notifications));

      } catch (e) {
        console.error("Error loading config data:", e);
      }

      const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      const fromEnv = hasEnvSupabaseCredentials();
      setSupabaseFromEnv(fromEnv);
      setSupabaseUrl(localStorage.getItem('supabase_url') || envUrl || '');
      setSupabaseAnonKey(localStorage.getItem('supabase_anon_key') || envKey || '');
      setGeminiApiKey(localStorage.getItem('gemini_api_key') || '');
      setWhatsappTemplate(localStorage.getItem('whatsapp_template') || 'Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!');

      const rConf = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}","allow_adelantos":true,"allow_compras":true,"allow_pagos":true}`);
      setRendicionCajaNombre(rConf.caja_nombre || DEFAULT_CAJA_FUERTE_NAME);
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

  useEffect(() => {
    if (!openColorPickerModule) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.module-color-picker')) {
        setOpenColorPickerModule(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openColorPickerModule]);

  const getModuleUsingColor = (color, excludeModuleKey) =>
    Object.keys(moduleColors).find(
      (k) =>
        k !== excludeModuleKey &&
        moduleColors[k] === color &&
        modules[k] !== false
    );

  const handleModuleColorPick = (moduleKey, color) => {
    const usedBy = getModuleUsingColor(color, moduleKey);
    if (usedBy) {
      const previousColor =
        moduleColors[moduleKey] || DEFAULT_MODULE_COLORS[moduleKey] || PRESET_COLORS[0];
      setModuleColors((prev) => ({
        ...prev,
        [moduleKey]: color,
        [usedBy]: previousColor,
      }));
    } else {
      setModuleColors((prev) => ({ ...prev, [moduleKey]: color }));
    }
    setOpenColorPickerModule(null);
  };

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
    const shiftName = String(shift || '').trim();
    setCajasPosibles(prev =>
      prev.includes(shiftName) ? prev.filter(s => s !== shiftName) : [...prev, shiftName]
    );
  };

  const handleAddTurnoTag = (e) => {
    if (e) e.preventDefault();
    const val = newTurnoInput.trim();
    if (!val) return;
    const exists = turnosList.some((t) => String(t).trim().toLowerCase() === val.toLowerCase());
    if (!exists) {
      setTurnosList((prev) => [...prev, val]);
      setPedidosCajasConfig((prev) => initPedidosCajaAssignment(prev, val));
      setNewTurnoInput('');
    }
  };

  const handleRemoveTurnoTag = (index) => {
    const removed = turnosList[index];
    setTurnosList((prev) => prev.filter((_, i) => i !== index));
    if (removed) {
      setPedidosCajasConfig((prev) => {
        const next = { ...(prev || {}), assignments: { ...(prev?.assignments || {}) } };
        delete next.assignments[String(removed).trim()];
        return next;
      });
    }
  };

  const handlePedidosCajaToggle = (turnoName, field, checked) => {
    setPedidosCajasConfig((prev) => togglePedidosCajaFlag(prev, turnoName, field, checked));
  };

  const handleAddConceptTag = (e) => {
    if (e) e.preventDefault();
    const val = newConceptInput.trim();
    if (!val) return;

    const emptySlot = getNextEmptyMedioSlot(conceptsList);
    if (!emptySlot) {
      alert(`Ya configuraste los ${CIERRE_MEDIOS_SLOTS} medios de cobro disponibles.`);
      return;
    }

    const duplicate = conceptsList.find(
      (c) => c.label?.trim().toLowerCase() === val.toLowerCase()
    );
    if (duplicate) {
      if (!duplicate.enabled) {
        setConceptsList((prev) =>
          prev.map((c) => (c.id === duplicate.id ? { ...c, enabled: true } : c))
        );
      }
      setNewConceptInput('');
      return;
    }

    setConceptsList((prev) =>
      prev.map((c) =>
        c.id === emptySlot.id ? { ...c, label: val, enabled: true } : c
      )
    );
    setNewConceptInput('');
  };

  const handleRemoveConceptTag = (id) => {
    const target = conceptsList.find((c) => c.id === id);
    if (!target) return;
    if (!canDeleteMedio(target)) {
      alert('Este medio ya fue usado en un cierre. Podés deshabilitarlo, pero no eliminarlo.');
      return;
    }
    setConceptsList((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, label: '', enabled: false, used: false } : c
      )
    );
  };

  const handleToggleConceptEnabled = (id) => {
    const target = conceptsList.find((c) => c.id === id);
    if (!target || !canToggleMedio(target)) return;
    setConceptsList((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
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
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0);
      const pedidosCajasToSave = normalizePedidosCajasConfig(cleanTurnos, pedidosCajasConfig);

      // Save all database settings concurrently and await them
      const saveResults = await Promise.all([
        db.saveModules(modulesWithColors),
        db.saveCierreTurnos(cleanTurnos.length > 0 ? cleanTurnos : getCierreTurnoNames(DEFAULT_CIERRE_TURNOS)),
        db.savePedidosCajasConfig(pedidosCajasToSave),
        db.saveCierreConceptos(conceptsList),
        db.saveComprasCategorias(comprasCategoriasList),
        db.saveComprasConceptos(comprasConceptosList),
        db.saveComprasFormasPago(comprasFormasPagoList),
        db.saveRolePermissions(normalizeRolePermissions(rolePermissionsConfig, modules)),
        db.saveArcaConfig(buildArcaConfigFromForm({
          cuit: arcaCuit,
          razonSocial: arcaRazonSocial,
          nombreComercial: arcaNombreComercial,
          direccion: arcaDireccion,
          puntoVenta: arcaPuntoVenta,
          ambiente: arcaAmbiente,
          cert: arcaCert,
          privateKey: arcaKey,
          token: arcaToken,
        })),
        db.saveNotificationsConfig(notificationsFormToConfig(notificationsForm)),
      ]);

      const failedSave = saveResults.find(
        (result) => result && (result.success === false || result.ok === false)
      );
      if (failedSave) {
        throw new Error(failedSave.error || 'No se pudo guardar la configuración');
      }

      // Save Pedidos / Compras settings to localStorage
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
        caja_nombre: rendicionCajaNombre.trim() || DEFAULT_CAJA_FUERTE_NAME,
        allow_adelantos: rendicionAllowAdelantos,
        allow_compras: rendicionAllowCompras,
        allow_pagos: rendicionAllowPagos
      };
      localStorage.setItem('rendiciones_config', JSON.stringify(rendicionesConfig));

      // Credenciales Supabase: globales (env). localStorage solo como override en desarrollo.
      if (!supabaseFromEnv) {
        if (supabaseUrl.trim() && supabaseAnonKey.trim()) {
          localStorage.setItem('supabase_url', supabaseUrl.trim());
          localStorage.setItem('supabase_anon_key', supabaseAnonKey.trim());
        } else {
          localStorage.removeItem('supabase_url');
          localStorage.removeItem('supabase_anon_key');
        }
      }

      localStorage.setItem('gemini_api_key', geminiApiKey.trim());

      setSaveStatus('success');
      setSaveErrorMessage('');
      refreshModules(); // Notify App.jsx about module updates
      
      // Auto close/redirect or show success message briefly
      setTimeout(() => {
        setSaveStatus('');
        navigate('dashboard');
      }, 1500);
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err.message || 'No se pudo guardar la configuración');
      setTimeout(() => {
        setSaveStatus('');
        setSaveErrorMessage('');
      }, 5000);
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

  const handleResetDemoMode = async () => {
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
      localStorage.removeItem('cierre_medios_used');
      localStorage.removeItem('repartidores_list');
      localStorage.removeItem('rendiciones_config');
      setRendicionCajaNombre(DEFAULT_CAJA_FUERTE_NAME);
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
      setTurnosList(getCierreTurnoNames(DEFAULT_CIERRE_TURNOS));
      setPedidosCajasConfig(normalizePedidosCajasConfig(getCierreTurnoNames(DEFAULT_CIERRE_TURNOS), null));
      setConceptsList(createDefaultCierreMedios());
      setComprasCategoriasList(DEFAULT_COMPRAS_CATEGORIES.map((cat) => ({ ...cat, details: [...(cat.details || [])] })));
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
      await db.saveModules(defaultModules);
      
      setSaveStatus('success');
      refreshModules();
      
      setTimeout(() => {
        setSaveStatus('');
        navigate('dashboard');
      }, 1500);
    }
  };

  const renderModuleColorPicker = (moduleKey) => {
    const currentColor =
      moduleColors[moduleKey] || DEFAULT_MODULE_COLORS[moduleKey] || PRESET_COLORS[0];
    const isOpen = openColorPickerModule === moduleKey;

    return (
      <div
        className="module-color-picker"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="module-color-picker__trigger"
          style={{ backgroundColor: currentColor }}
          onClick={() => setOpenColorPickerModule(isOpen ? null : moduleKey)}
          title="Elegir color"
          aria-label={`Color de ${getModuleLabel(moduleKey)}`}
          aria-expanded={isOpen}
        />
        {isOpen && (
          <div className="module-color-picker__panel" role="listbox" aria-label="Colores disponibles">
            {PRESET_COLORS.map((color) => {
              const usedBy = getModuleUsingColor(color, moduleKey);
              const isCurrent = color === currentColor;

              return (
                <button
                  key={color}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={[
                    'module-color-picker__swatch',
                    usedBy ? 'is-used' : '',
                    isCurrent ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ backgroundColor: color }}
                  title={usedBy ? `En uso: ${getModuleLabel(usedBy)}` : undefined}
                  onClick={() => handleModuleColorPick(moduleKey, color)}
                >
                  {usedBy && <span className="module-color-picker__used-mark" aria-hidden="true" />}
                  {isCurrent && <i className="bi bi-check-lg module-color-picker__check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderModuleHeader = (moduleKey, label, desc, iconClass, colorClass) => {
    const hasDetails = ['cierre', 'compras', 'adelantos', 'rendiciones', 'clientes'].includes(moduleKey);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            {renderModuleColorPicker(moduleKey)}
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
      </div>
    );
  };

  return (
    <div className="page-card" style={{ borderLeft: '5px solid #64748b' }}>
      <h2 className="page-title text-dark">
        <i className="bi bi-gear-fill text-secondary"></i> Configuración del Sistema
      </h2>
      <p className="text-muted small mb-3">
        Solo el administrador de la empresa puede modificar esta configuración. Hay un único administrador por empresa.
      </p>

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
                      <div className="toggle-desc">Credenciales globales del sistema (iguales para todas las empresas).</div>
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
                    {supabaseFromEnv && (
                      <div className="alert-box-success" style={{ marginBottom: '15px' }}>
                        <i className="bi bi-cloud-check-fill"></i>
                        <div>
                          Las credenciales de Supabase están definidas en el servidor (Vercel / <code>.env</code>).
                          Son compartidas por todas las empresas del sistema.
                        </div>
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Supabase Project URL</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="https://xxxxxx.supabase.co"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                        readOnly={supabaseFromEnv}
                        style={supabaseFromEnv ? { backgroundColor: '#f1f5f9', cursor: 'not-allowed' } : undefined}
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
                        readOnly={supabaseFromEnv}
                        style={supabaseFromEnv ? { backgroundColor: '#f1f5f9', cursor: 'not-allowed' } : undefined}
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

              {/* Config: Notificaciones */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: expandedModule === 'notifications' ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: expandedModule === 'notifications' ? '10px' : '15px' }}>
                  <div
                    className="toggle-info"
                    onClick={() => setExpandedModule(expandedModule === 'notifications' ? null : 'notifications')}
                    style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center' }}
                  >
                    <i
                      className={`bi bi-chevron-${expandedModule === 'notifications' ? 'down' : 'right'}`}
                      style={{ fontSize: '1.25rem', color: 'var(--text-dark)', marginRight: '12px', fontWeight: 'bold', WebkitTextStroke: '0.8px', width: '16px', textAlign: 'center' }}
                    ></i>
                    <div className="toggle-icon bg-primary"><i className="bi bi-bell-fill"></i></div>
                    <div>
                      <div className="toggle-label">Notificaciones</div>
                      <div className="toggle-desc">Pushover al cerrar caja y base para app propia / webhooks</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'notifications' && (
                  <div style={{ paddingLeft: '28px', paddingTop: '8px' }}>
                    <div className="small text-muted mb-3" style={{ padding: '10px', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                      El <strong>App Token</strong> de Pushover se configura como secret en Supabase (<code>PUSHOVER_APP_TOKEN</code>).
                      Acá solo cargás el User Key y activás los eventos.
                    </div>

                    <div className="form-check form-switch mb-3" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        className="task-checkbox"
                        id="notifCierreCaja"
                        checked={notificationsForm.cierreCajaEnabled}
                        onChange={(e) => setNotificationsForm((prev) => ({ ...prev, cierreCajaEnabled: e.target.checked }))}
                      />
                      <label htmlFor="notifCierreCaja" className="form-check-label fw-bold" style={{ cursor: 'pointer' }}>
                        Notificar al cerrar caja
                      </label>
                    </div>

                    <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px', marginBottom: '12px', backgroundColor: '#f8fafc' }}>
                      <div className="form-check form-switch mb-2" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="checkbox"
                          className="task-checkbox"
                          id="notifPushover"
                          checked={notificationsForm.pushoverEnabled}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, pushoverEnabled: e.target.checked }))}
                        />
                        <label htmlFor="notifPushover" className="form-check-label fw-bold" style={{ cursor: 'pointer' }}>
                          Pushover (celular)
                        </label>
                      </div>
                      <div className="form-group mb-0">
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>User Key</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Ej: uw4mn8r356h94rsgzw5gmffppnwn9j"
                          value={notificationsForm.pushoverUserKey}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, pushoverUserKey: e.target.value.trim() }))}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>
                    </div>

                    <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px', marginBottom: '12px', backgroundColor: '#f8fafc' }}>
                      <div className="form-check form-switch mb-2" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="checkbox"
                          className="task-checkbox"
                          id="notifWebhook"
                          checked={notificationsForm.webhookEnabled}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, webhookEnabled: e.target.checked }))}
                        />
                        <label htmlFor="notifWebhook" className="form-check-label fw-bold" style={{ cursor: 'pointer' }}>
                          Webhook (app propia / integraciones)
                        </label>
                      </div>
                      <div className="form-group mb-2">
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>URL</label>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="https://tu-servidor.com/api/notifications"
                          value={notificationsForm.webhookUrl}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, webhookUrl: e.target.value.trim() }))}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>
                      <div className="form-group mb-0">
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Secret (opcional, header X-Gestion360i-Secret)</label>
                        <input
                          type="password"
                          className="form-input"
                          value={notificationsForm.webhookSecret}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, webhookSecret: e.target.value }))}
                          style={{ fontSize: '0.85rem', padding: '6px 10px', height: '34px' }}
                        />
                      </div>
                    </div>

                    <div style={{ border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '14px', backgroundColor: '#fff' }}>
                      <div className="form-check form-switch mb-0" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="checkbox"
                          className="task-checkbox"
                          id="notifInternalApp"
                          checked={notificationsForm.internalAppEnabled}
                          onChange={(e) => setNotificationsForm((prev) => ({ ...prev, internalAppEnabled: e.target.checked }))}
                        />
                        <label htmlFor="notifInternalApp" className="form-check-label" style={{ cursor: 'pointer' }}>
                          <strong>Cola interna</strong> — guarda eventos en <code>gst_notification_outbox</code> para una app futura
                        </label>
                      </div>
                    </div>
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
                      <div className="toggle-desc">Exclusivas de esta empresa. Se guardan en la nube por business_id.</div>
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
                    <div className="small text-muted mb-3" style={{ padding: '10px', backgroundColor: '#ecfdf5', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                      <i className="bi bi-building me-1"></i>
                      Estos datos son <strong>por empresa</strong> (CUIT, certificado y clave privada de facturación).
                      Cada negocio cargado en el sistema tiene su propia configuración ARCA en <code>gst_configs</code>.
                    </div>
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

              {/* Config: Permisos por Rol */}
              <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)', paddingBottom: expandedModule === 'role_perms' ? '15px' : '0' }}>
                <div className="toggle-item" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: expandedModule === 'role_perms' ? '10px' : '15px' }}>
                  <div 
                    className="toggle-info" 
                    onClick={() => setExpandedModule(expandedModule === 'role_perms' ? null : 'role_perms')} 
                    style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center' }}
                  >
                    <i 
                      className={`bi bi-chevron-${expandedModule === 'role_perms' ? 'down' : 'right'}`} 
                      style={{ fontSize: '1.25rem', color: 'var(--text-dark)', marginRight: '12px', fontWeight: 'bold', WebkitTextStroke: '0.8px', width: '16px', textAlign: 'center' }}
                    ></i>
                    <span className="toggle-icon" style={{ backgroundColor: '#475569' }}><i className="bi bi-shield-lock-fill"></i></span>
                    <div>
                      <div className="toggle-label">Permisos por Rol</div>
                      <div className="toggle-desc">Por empresa: qué módulos están activos y permisos por rol.</div>
                    </div>
                  </div>
                </div>

                {expandedModule === 'role_perms' && (
                  <div style={{ padding: '5px 20px 15px 55px' }}>
                    <p className="small text-muted mb-3">
                      Solo se listan módulos activos. El rol Administrador siempre tiene acceso total.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                      {ROLE_KEYS.map((roleKey) => (
                        <div key={roleKey}>
                          <label className="form-label small fw-bold mb-1">
                            {roleKey === 'admin' ? 'Rol fijo' : 'Nombre del rol'}
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ fontSize: '0.85rem', padding: '8px 10px' }}
                            value={rolePermissionsConfig.roles[roleKey] || ''}
                            disabled={roleKey === 'admin'}
                            onChange={(e) => setRolePermissionsConfig(updateRoleLabel(rolePermissionsConfig, roleKey, e.target.value))}
                          />
                        </div>
                      ))}
                    </div>

                    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <table className="table table-sm mb-0" style={{ fontSize: '0.85rem' }}>
                        <thead style={{ backgroundColor: 'var(--bg-light)' }}>
                          <tr>
                            <th style={{ minWidth: '160px', padding: '10px' }}>Módulo</th>
                            {ROLE_KEYS.map((roleKey) => (
                              <th key={roleKey} style={{ textAlign: 'center', padding: '10px', minWidth: '90px' }}>
                                {rolePermissionsConfig.roles[roleKey]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {getEnabledPermissionModules(modules).map((mod) => (
                            <tr key={mod.id}>
                              <td style={{ padding: '10px', fontWeight: 600 }}>{mod.label}</td>
                              {ROLE_KEYS.map((roleKey) => {
                                const checked = rolePermissionsConfig.matrix[roleKey]?.[mod.id] === true;
                                const isAdmin = roleKey === 'admin';
                                return (
                                  <td key={roleKey} style={{ textAlign: 'center', padding: '10px' }}>
                                    <input
                                      type="checkbox"
                                      checked={isAdmin ? true : checked}
                                      disabled={isAdmin}
                                      onChange={(e) => {
                                        setRolePermissionsConfig(
                                          toggleMatrixPermission(rolePermissionsConfig, roleKey, mod.id, e.target.checked)
                                        );
                                      }}
                                      style={{ width: '18px', height: '18px', cursor: isAdmin ? 'not-allowed' : 'pointer' }}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
              {renderModuleHeader('cierre', MODULE_LABELS.cierre, MODULE_DESCRIPTIONS.cierre, 'bi-currency-dollar', 'bg-cierre')}
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
                    <label className="form-label fw-bold small text-muted mb-2">
                      Medios de Cobro ({getConfiguredMedios(conceptsList).length}/{CIERRE_MEDIOS_SLOTS})
                    </label>
                    <div className="small text-muted mb-2">
                      El slot 1 es <strong>Efectivo</strong> (fijo). Los demás se asignan al crearlos. Si un medio ya se usó en un cierre, no se puede eliminar pero sí deshabilitar.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff' }}>
                      {getConfiguredMedios(conceptsList).map((c) => (
                        <div key={c.id} className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                          <div className="d-flex align-items-center gap-2">
                            <span className="badge bg-secondary">{c.slot}</span>
                            <span className="fw-semibold">{c.label}</span>
                            {c.locked && <span className="badge bg-light text-dark border">Fijo</span>}
                            {c.used && <span className="badge bg-warning text-dark">Usado</span>}
                          </div>
                          <div className="d-flex align-items-center gap-3">
                            {canToggleMedio(c) && (
                              <label className="small d-flex align-items-center gap-1 mb-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={c.enabled !== false}
                                  onChange={() => handleToggleConceptEnabled(c.id)}
                                />
                                Habilitado
                              </label>
                            )}
                            {canDeleteMedio(c) ? (
                              <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => handleRemoveConceptTag(c.id)}>
                                Eliminar
                              </button>
                            ) : c.slot > 1 ? (
                              <span className="small text-muted">No eliminable</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="d-flex gap-2">
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Nuevo medio de cobro..."
                        value={newConceptInput}
                        onChange={(e) => setNewConceptInput(e.target.value)}
                        disabled={!getNextEmptyMedioSlot(conceptsList)}
                      />
                      <button
                        type="button"
                        className="btn-new-task"
                        onClick={handleAddConceptTag}
                        disabled={!getNextEmptyMedioSlot(conceptsList)}
                      >
                        <i className="bi bi-plus-lg"></i>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Compras */}
              {renderModuleHeader('compras', MODULE_LABELS.compras, MODULE_DESCRIPTIONS.compras, 'bi-cart-fill', 'bg-compras')}
              {modules.compras && expandedModule === 'compras' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div className="small text-muted">Las categorías y formas de pago de compras se configuran en sus respectivas secciones del módulo.</div>
                  </div>
                </div>
              )}

              {/* Adelantos */}
              {renderModuleHeader('adelantos', MODULE_LABELS.adelantos, MODULE_DESCRIPTIONS.adelantos, 'bi-cash-stack', 'bg-adelantos')}
              {modules.adelantos && expandedModule === 'adelantos' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label className="d-flex align-items-center gap-2 small cursor-pointer">
                      <input type="checkbox" checked={allowDinero} onChange={e => setAllowDinero(e.target.checked)} /> {ADELANTO_EFECTIVO}
                    </label>
                    <label className="d-flex align-items-center gap-2 small cursor-pointer">
                      <input type="checkbox" checked={allowMercaderia} onChange={e => setAllowMercaderia(e.target.checked)} /> {ADELANTO_MERCADERIA}
                    </label>
                  </div>
                  {allowDinero && (
                    <div className="mt-2">
                      <label className="form-label fw-bold small text-muted mb-2">Cajas habilitadas para {ADELANTO_EFECTIVO.toLowerCase()}</label>
                      <div className="d-flex flex-wrap gap-2">
                        <label className="small d-flex align-items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={rendicionAllowAdelantos} onChange={e => setRendicionAllowAdelantos(e.target.checked)} /> {rendicionCajaNombre}
                        </label>
                        {turnosList.map((t, idx) => (
                          <label key={`${t}_${idx}`} className="small d-flex align-items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={cajasPosibles.includes(t)} onChange={() => handleToggleCajaPosible(t)} /> {t}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Rendiciones */}
              {renderModuleHeader('rendiciones', MODULE_LABELS.rendiciones, MODULE_DESCRIPTIONS.rendiciones, 'bi-clipboard-data', 'bg-rendiciones')}
              {modules.rendiciones && expandedModule === 'rendiciones' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div className="form-group" style={{ maxWidth: '280px', margin: 0 }}>
                    <label className="form-label fw-bold small text-muted">Nombre de la Caja / Fondo</label>
                    <input 
                      type="text" 
                      placeholder={DEFAULT_CAJA_FUERTE_NAME}
                      className="form-input" 
                      value={rendicionCajaNombre}
                      onChange={(e) => setRendicionCajaNombre(e.target.value)}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', height: '36px', marginTop: '5px' }}
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block', marginTop: '4px' }}>
                      Nombre a mostrar en los listados y formularios (ej: {DEFAULT_CAJA_FUERTE_NAME}, Rendición, Caja Chica).
                    </small>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label fw-bold small text-muted">Módulos habilitados para su uso</label>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '5px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                        <input type="checkbox" checked={rendicionAllowCompras} onChange={(e) => setRendicionAllowCompras(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                        {MODULE_LABELS.compras}
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                        <input type="checkbox" checked={rendicionAllowPagos} onChange={(e) => setRendicionAllowPagos(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                        Pagos
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                        <input type="checkbox" checked={rendicionAllowAdelantos} onChange={(e) => setRendicionAllowAdelantos(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                        {MODULE_LABELS.adelantos}
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Clientes / Pedidos */}
              {renderModuleHeader('clientes', MODULE_LABELS.clientes, MODULE_DESCRIPTIONS.clientes, 'bi-journal-text', 'bg-clientes')}
              {modules.clientes && expandedModule === 'clientes' && (
                <div style={{ padding: '5px 20px 10px 48px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <i className="bi bi-whatsapp text-success" style={{ fontSize: '1.1rem' }}></i>
                      <span className="fw-bold small text-muted">WhatsApp — mensaje de reparto</span>
                    </div>
                    <label className="form-label fw-bold small text-muted mb-1">
                      Personalizar mensajes de envío de pedidos
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Hola! Estoy por llegar con su pedido..."
                      value={whatsappTemplate}
                      onChange={(e) => setWhatsappTemplate(e.target.value)}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', height: '36px', margin: 0 }}
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>
                      Se usa en el QR de WhatsApp al imprimir comandas de delivery.
                    </small>
                  </div>
                  <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <i className="bi bi-cash-stack text-primary"></i>
                      <span className="fw-bold small text-muted">Cajas para pedidos (Delivery / Local)</span>
                    </div>
                    <div className="small text-muted mb-3">
                      Las cajas se crean en <strong>Cierre → Turnos / Cajas</strong>. Marcá <strong>Delivery</strong> y/o <strong>Local</strong> según corresponda (podés marcar ambos en la misma caja). Las que no usen pedidos dejalas sin marcar.
                    </div>
                    {turnosList.length === 0 ? (
                      <div className="small text-muted">Primero creá cajas en el módulo Cierre.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {turnosList.map((turnoName) => {
                          const flags = normalizeCajaAssignment(pedidosCajasConfig?.assignments?.[turnoName]);
                          return (
                            <div key={turnoName} className="d-flex align-items-center justify-content-between gap-3 flex-wrap py-1 border-bottom">
                              <strong className="small">{turnoName}</strong>
                              <div className="d-flex align-items-center gap-3 flex-wrap">
                                <label className="small d-flex align-items-center gap-1 mb-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={flags.delivery}
                                    onChange={(e) => handlePedidosCajaToggle(turnoName, 'delivery', e.target.checked)}
                                  />
                                  Delivery
                                </label>
                                <label className="small d-flex align-items-center gap-1 mb-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={flags.local}
                                    onChange={(e) => handlePedidosCajaToggle(turnoName, 'local', e.target.checked)}
                                  />
                                  Local
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {turnosList.length > 0 && localPedidosManagedExternally(pedidosCajasConfig, turnosList) && (
                      <div
                        className="small mt-3"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#1e40af',
                        }}
                      >
                        <i className="bi bi-info-circle me-1"></i>
                        Los pedidos <strong>LOCAL</strong> los gestiona otra caja. Al cobrarlos verás todos los medios excepto <strong>Tarjeta</strong>; el efectivo aparece como <strong>Pagado en caja</strong>.
                      </div>
                    )}
                  </div>
                  <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <i className="bi bi-truck text-primary"></i>
                      <span className="fw-bold small text-muted">Precio de envío</span>
                    </div>
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>
                      Se toma del producto <strong>Envio</strong> o <strong>Envío</strong> en el inventario de Pedidos. Creá o editá ese producto para cambiar el valor.
                    </small>
                  </div>
                </div>
              )}

              {/* Pago Proveedores */}
              {renderModuleHeader('pago-proveedores', MODULE_LABELS['pago-proveedores'], MODULE_DESCRIPTIONS['pago-proveedores'], 'bi-wallet2', 'bg-success')}

              {/* Pagos */}
              {renderModuleHeader('pago-impuestos', MODULE_LABELS['pago-impuestos'], MODULE_DESCRIPTIONS['pago-impuestos'], 'bi-receipt', 'bg-success')}

              {/* Tareas */}
              {renderModuleHeader('tareas', MODULE_LABELS.tareas, MODULE_DESCRIPTIONS.tareas, 'bi-list-check', 'bg-config')}

              {/* Proveedores */}
              {renderModuleHeader('proveedores', MODULE_LABELS.proveedores, MODULE_DESCRIPTIONS.proveedores, 'bi-truck', 'bg-info')}

              {/* Empleados */}
              {renderModuleHeader('empleados', MODULE_LABELS.empleados, MODULE_DESCRIPTIONS.empleados, 'bi-person-badge', 'bg-primary')}

              {/* Resultados */}
              {renderModuleHeader('resultados', MODULE_LABELS.resultados, MODULE_DESCRIPTIONS.resultados, 'bi-graph-up', 'bg-dark')}

              {/* Pagos Periódicos */}
              {renderModuleHeader('pagos-periodicos', MODULE_LABELS['pagos-periodicos'], MODULE_DESCRIPTIONS['pagos-periodicos'], 'bi-calendar-check', 'bg-secondary')}

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
              <div>{saveErrorMessage || 'No se pudo guardar la configuración.'}</div>
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
