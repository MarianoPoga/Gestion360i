import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../supabaseClient';
import { DEFAULT_CAJA_FUERTE_NAME } from '../moduleLabels';
import {
  COMPRAS_CATEGORY_PERIODIC_SUBGROUP,
  getComprasConceptosForCategory,
  getProviderCategories,
  isComprasCalendarCategory,
  normalizeCategoryName,
  normalizeComprasCategories,
} from '../expenseTypes';
import {
  buildFullSubgroup,
  normalizePeriodicPayment,
  resolvePaymentSubgroupId,
  sortPeriodicPayments,
} from '../periodicPaymentsDefaults';
import ExpenseGuideModal from '../components/ExpenseGuideModal';
import { clampDateToToday, getTodayLocalDateString } from '../dateUtils';
function Compras({ navigate, refreshModules, modules, navState, accentColor }) {
  const isSameLocalDate = (isoString, localDateString) => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}` === localDateString;
  };

  const [fecha, setFecha] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [cuit, setCuit] = useState('');
  const [tipo, setTipo] = useState('Mercadería');
  const [detalle, setDetalle] = useState('');
  const [alias, setAlias] = useState('');
  
  // Tax breakdown states
  const [montoNeto, setMontoNeto] = useState('0'); // representing Neto 21%
  const [iva21, setIva21] = useState('0');
  const [montoNeto105, setMontoNeto105] = useState('0');
  const [iva105, setIva105] = useState('0');
  const [montoNeto27, setMontoNeto27] = useState('0');
  const [iva27, setIva27] = useState('0');
  
  const [montoExento, setMontoExento] = useState('0');
  const [montoNoGravado, setMontoNoGravado] = useState('0');
  
  const [percepIva, setPercepIva] = useState('0');
  const [percepIibb, setPercepIibb] = useState('0');
  const [iibbJurisdiccion, setIibbJurisdiccion] = useState('');
  const [percepGanancias, setPercepGanancias] = useState('0');
  
  const [impuestosInternos, setImpuestosInternos] = useState('0');
  const [tasasMunicipales, setTasasMunicipales] = useState('0');
  
  const [total, setTotal] = useState('0');
  const [montoNetoComprobante, setMontoNetoComprobante] = useState('');
  const [montoTotalComprobante, setMontoTotalComprobante] = useState('');
  const [lastUpdatedField, setLastUpdatedField] = useState('neto');
  const [pago, setPago] = useState('');
  const [turnoAsignado, setTurnoAsignado] = useState('');
   const [factura, setFactura] = useState('Sin factura');
   const [nroFactura, setNroFactura] = useState('');
   const [noComputarCompra, setNoComputarCompra] = useState(false);
 
   const formatNroFactura = (val) => {
     // Expected format ddddd-dddddddd
     const clean = val.replace(/[^0-9-]/g, '');
     if (!clean) return '';
     
     const parts = clean.split('-');
     let p1 = parts[0] || '';
     let p2 = parts[1] || '';
     
     if (parts.length === 1 && p1.length > 5) {
       // Auto split if someone just types 13 digits
       p2 = p1.substring(5);
       p1 = p1.substring(0, 5);
     }
 
     // We only pad if they finished typing the part or lost focus, 
     // but for live input we just limit length
     return { p1: p1.substring(0, 5), p2: p2.substring(0, 8), original: clean };
   };
 
   const handleNroFacturaBlur = () => {
     if (!nroFactura) return;
     const parts = nroFactura.split('-');
     let p1 = (parts[0] || '').padStart(5, '0');
     let p2 = (parts[1] || '').padStart(8, '0');
     setNroFactura(`${p1}-${p2}`);
   };

  // UI lists & autocompletes state
  const [proveedoresMap, setProveedoresMap] = useState({});
  const [uniqueDetails, setUniqueDetails] = useState([]);
  const [periodicPayments, setPeriodicPayments] = useState([]);
  const [uniquePayments, setUniquePayments] = useState([]);
  const [comprasCategorias, setComprasCategorias] = useState([]);
  const [showGuiaModal, setShowGuiaModal] = useState(false);
  const [cierreTurnos, setCierreTurnos] = useState([]);
  const [ultimosCierres, setUltimosCierres] = useState([]);

  const [rendConfig, setRendConfig] = useState({
    caja_nombre: DEFAULT_CAJA_FUERTE_NAME,
    allow_compras: true
  });

  // New Supplier Modal States
  const [showNuevoProveedorModal, setShowNuevoProveedorModal] = useState(false);
  const [newProvNombre, setNewProvNombre] = useState('');
  const [newProvAlias, setNewProvAlias] = useState('');
  const [newProvCuit, setNewProvCuit] = useState('');
  const [newProvTipo, setNewProvTipo] = useState('Mercadería');
  const [newProvDetalle, setNewProvDetalle] = useState('');
  const [newProvPago, setNewProvPago] = useState('Caja');
  const [newProvFactura, setNewProvFactura] = useState('Sin factura');
  const [newProvCelRepartidor, setNewProvCelRepartidor] = useState('');
  const [newProvCelAdmin, setNewProvCelAdmin] = useState('');
  const [showDetalleSuggestions, setShowDetalleSuggestions] = useState(false);
  const [showNewProvDetalleSuggestions, setShowNewProvDetalleSuggestions] = useState(false);
  const [showProvSuggestions, setShowProvSuggestions] = useState(false);
  const [showAliasSuggestions, setShowAliasSuggestions] = useState(false);
  const [products, setProducts] = useState([]);

  // Navigation & Proveedores ABM States
  const [viewMode, setViewMode] = useState('register'); // 'register' or 'suppliers'
  const [provSearchQuery, setProvSearchQuery] = useState('');
  const [editingProveedorOriginalName, setEditingProveedorOriginalName] = useState(null);
  const [provSortField, setProvSortField] = useState('nombre');
  const [provSortAsc, setProvSortAsc] = useState(true);

  const handleSortProveedores = (field) => {
    if (provSortField === field) {
      setProvSortAsc(!provSortAsc);
    } else {
      setProvSortField(field);
      setProvSortAsc(true);
    }
  };
  const getConceptosForCategory = (categoryName) =>
    getComprasConceptosForCategory(categoryName, comprasCategorias, periodicPayments, uniqueDetails);

  const initializeDefaultConceptInDesglose = (conceptName, defaultNeto = '', defaultIvaRate = null, categoryName = tipo) => {
    if (!conceptName) return;
    
    const concept = getConceptosForCategory(categoryName)
      .find(d => (d.label || d).toLowerCase().trim() === conceptName.toLowerCase().trim());
    let ivaRate = concept && concept.iva !== undefined ? concept.iva : 21;
    if (defaultIvaRate !== null) {
      ivaRate = defaultIvaRate;
    }
    
    let computedIva = 0;
    let computedSubtotal = 0;
    if (defaultNeto) {
      const netVal = parseFloat(defaultNeto) || 0;
      computedIva = parseFloat((netVal * (ivaRate / 100)).toFixed(2));
      computedSubtotal = parseFloat((netVal + computedIva).toFixed(2));
    }
    
    const newItem = {
      id: `dc_${Date.now()}`,
      concepto: conceptName,
      ivaRate: ivaRate,
      neto: defaultNeto ? parseFloat(defaultNeto).toFixed(2) : '',
      iva: computedIva,
      subtotal: computedSubtotal
    };
    
    setDesgloseConceptos([newItem]);
  };

  // Concept breakdown states
  const [desgloseConceptos, setDesgloseConceptos] = useState([]);
  const [selectedConceptToAdd, setSelectedConceptToAdd] = useState('');
  const [showAddConceptModal, setShowAddConceptModal] = useState(false);
  const [tempCategory, setTempCategory] = useState('');

  // New Concept Modal States
  const [showNuevoConceptoModal, setShowNuevoConceptoModal] = useState(false);
  const [newConceptNombre, setNewConceptNombre] = useState('');
  const [newConceptIva, setNewConceptIva] = useState('21');
  const [conceptTargetField, setConceptTargetField] = useState('main'); // 'main' or 'modal'

  // Calculator logic
  const handleOpenCalculator = (id, currentVal) => {
    setCalcTarget(id);
    setCalcInput('');
    const valNum = parseFloat(currentVal) || 0;
    setCalcItems(valNum > 0 ? [valNum] : []);
    setShowCalculator(true);
  };

  const handleAddCalcItem = (e) => {
    if (e) e.preventDefault();
    const val = parseFloat(calcInput);
    if (!isNaN(val) && val > 0) {
      setCalcItems(prev => [...prev, val]);
      setCalcInput('');
    }
  };

  const handleConfirmCalculator = () => {
    const sum = calcItems.reduce((a, b) => a + b, 0);
    if (calcTarget === 'main_total') {
      setMontoTotalComprobante(sum.toFixed(2));
      setLastUpdatedField('total');
    } else if (calcTarget === 'main_neto') {
      setMontoNetoComprobante(sum.toFixed(2));
      setLastUpdatedField('neto');
    } else {
      handleDesgloseNetoChange(calcTarget, sum.toFixed(2));
    }
    setShowCalculator(false);
  };

  // List states
  const [comprasHoy, setComprasHoy] = useState([]);
  const [historialList, setHistorialList] = useState([]);

  // Modals & loading states
  const [ocrStatus, setOcrStatus] = useState(''); // 'reading', 'success', 'error', ''
  const [ocrError, setOcrError] = useState('');
  const [saveStatus, setSaveStatus] = useState(''); // 'saving', 'success', 'error', ''
  const [saveError, setSaveError] = useState('');
  const [showHistorialModal, setShowHistorialModal] = useState(false);
  const [sortAscending, setSortAscending] = useState(false);
  const [sortByField, setSortByField] = useState('fecha'); // 'fecha', 'proveedor'
  const [todaySortAscending, setTodaySortAscending] = useState(false);
  const [todaySortByField, setTodaySortByField] = useState('fecha');
  
  // Calculator states
  const [showCalculator, setShowCalculator] = useState(false);
  const [calcTarget, setCalcTarget] = useState(null); // { id, type: 'desglose' | 'total' }
  const [calcInput, setCalcInput] = useState('');
  const [calcItems, setCalcItems] = useState([]);

  const handleDesgloseConceptoChange = (id, newVal) => {
    setDesgloseConceptos(prev => prev.map(item => 
      item.id === id ? { ...item, concepto: newVal } : item
    ));
    // If it's the first one, also sync with main 'detalle' for saving
    if (desgloseConceptos[0]?.id === id) {
      setDetalle(newVal);
    }
  };

  const proveedoresList = Object.entries(proveedoresMap).map(([name, info]) => ({
    nombre: name,
    ...info
  }));

  const filteredSuppliersList = proveedoresList.filter(p => {
    const q = provSearchQuery.toLowerCase().trim();
    if (!q) return true;
    return p.nombre.toLowerCase().includes(q) ||
           (p.alias && p.alias.toLowerCase().includes(q)) ||
           (p.cuit && p.cuit.includes(q)) ||
           (p.tipo && p.tipo.toLowerCase().includes(q)) ||
           (p.detalle && p.detalle.toLowerCase().includes(q));
  }).sort((a, b) => {
    const valA = (a[provSortField] || '').toString().toLowerCase().trim();
    const valB = (b[provSortField] || '').toString().toLowerCase().trim();
    if (valA < valB) return provSortAsc ? -1 : 1;
    if (valA > valB) return provSortAsc ? 1 : -1;
    return 0;
  });

  const filteredProveedores = proveedor.trim() === ''
    ? []
    : proveedoresList.filter(p => 
        p.nombre.toLowerCase().includes(proveedor.toLowerCase()) ||
        (p.alias && p.alias.toLowerCase().includes(proveedor.toLowerCase())) ||
        (p.cuit && p.cuit.includes(proveedor))
      );

  const filteredProveedoresByAlias = alias.trim() === ''
    ? []
    : proveedoresList.filter(p => 
        p.nombre.toLowerCase().includes(alias.toLowerCase()) ||
        (p.alias && p.alias.toLowerCase().includes(alias.toLowerCase())) ||
        (p.cuit && p.cuit.includes(alias))
      );

  // Autocomplete suffix for Provider input
  const provMatch = proveedor.trim() === ''
    ? null
    : proveedoresList.find(p => 
        p.nombre.toLowerCase().startsWith(proveedor.toLowerCase()) ||
        (p.alias && p.alias.toLowerCase().startsWith(proveedor.toLowerCase()))
      );

  let provAutocompleteSuffix = '';
  if (provMatch) {
    if (provMatch.nombre.toLowerCase().startsWith(proveedor.toLowerCase())) {
      provAutocompleteSuffix = provMatch.nombre.substring(proveedor.length);
    } else if (provMatch.alias && provMatch.alias.toLowerCase().startsWith(proveedor.toLowerCase())) {
      provAutocompleteSuffix = provMatch.alias.substring(proveedor.length);
    }
  }

  // Autocomplete suffix for Alias input
  const aliasMatch = alias.trim() === ''
    ? null
    : proveedoresList.find(p => 
        (p.alias && p.alias.toLowerCase().startsWith(alias.toLowerCase())) ||
        p.nombre.toLowerCase().startsWith(alias.toLowerCase())
      );

  let aliasAutocompleteSuffix = '';
  if (aliasMatch) {
    if (aliasMatch.alias && aliasMatch.alias.toLowerCase().startsWith(alias.toLowerCase())) {
      aliasAutocompleteSuffix = aliasMatch.alias.substring(alias.length);
    } else if (aliasMatch.nombre.toLowerCase().startsWith(alias.toLowerCase())) {
      aliasAutocompleteSuffix = aliasMatch.nombre.substring(alias.length);
    }
  }

  const fileInputRef = useRef(null);
  const montoNetoInputRef = useRef(null);

  // Load defaults on mount
  useEffect(() => {
    if (navState?.periodicPayment) {
      const p = navState.periodicPayment;
      setProveedor(p.nombre);
      setDetalle(p.nombre);
      // Extraer el nombre de la categoría del subgrupo (ej: "2.1. Personal" -> "Personal")
      const catName = p.subgrupo.includes('. ') ? p.subgrupo.split('. ')[1] : p.subgrupo;
      setTipo(catName);
      setMontoTotalComprobante(p.monto_mensual?.toString() || '');
      setFactura(p.tipo_factura || 'Sin factura');
      setPago(p.medio_pago || 'Caja');
      
      // Intentar inicializar el desglose con el concepto
      if (p.nombre && p.monto_mensual) {
        const calendarCategory = p.subgrupo.includes('. ') ? p.subgrupo.split('. ')[1] : p.subgrupo;
        initializeDefaultConceptInDesglose(
          p.nombre,
          p.monto_mensual.toString(),
          p.iva_alicuota,
          calendarCategory
        );
      }
    }
  }, [navState, uniqueDetails, periodicPayments, comprasCategorias]);

  useEffect(() => {
    setFecha(getTodayLocalDateString());

    // Load dynamic data from DB/LS
    loadDBData();
    loadPurchasesData();
  }, []);

  const closedTurnos = (() => {
    if (!fecha) return [];
    return ultimosCierres
      .filter(c => isSameLocalDate(c.fecha, fecha))
      .map(c => c.turno);
  })();

  const isCurrentTurnoClosed = closedTurnos.includes(turnoAsignado);

  // Auto-select first available unclosed shift when date or closures change
  useEffect(() => {
    if (!fecha) return;
    const closed = ultimosCierres
      .filter(c => isSameLocalDate(c.fecha, fecha))
      .map(c => c.turno);
    const available = cierreTurnos.filter(t => !closed.includes(t));
    if (available.length > 0) {
      if (!available.includes(turnoAsignado)) {
        setTurnoAsignado(available[0]);
      }
    } else if (cierreTurnos.length > 0) {
      if (!cierreTurnos.includes(turnoAsignado)) {
        setTurnoAsignado(cierreTurnos[0]);
      }
    }
  }, [fecha, ultimosCierres, cierreTurnos]);

  const loadDBData = async () => {
    try {
      const provData = await db.getProveedoresData();
      setProveedoresMap(provData || {});

      const uniqueOptions = await db.getUniqueDetailsAndPayments();
      // Keep uniqueDetails for legacy/fallback if needed, but we'll prioritize categories
      setUniqueDetails(uniqueOptions.detalles || []);
      setUniquePayments(uniqueOptions.pagos || []);


      const [pr, cierres, periodics] = await Promise.all([
        db.getProducts(),
        db.getUltimosCierres(),
        db.getPagosPeriodicos(),
      ]);
      setProducts(pr || []);
      setUltimosCierres(cierres || []);
      setPeriodicPayments(sortPeriodicPayments(periodics || []));

      const cats = normalizeComprasCategories(await db.getComprasCategorias());
      setComprasCategorias(cats);
      if (cats.length > 0) {
        setTipo((prev) => (cats.some((c) => c.name === prev) ? prev : cats[0].name));
      }

      const turnos = await db.getCierreTurnoNames();
      setCierreTurnos(turnos || ["Mañana", "Tarde", "Delivery", "Noche"]);
      if (turnos && turnos.length > 0) {
        setTurnoAsignado(turnos[0]);
      }

      const loadedRendConfig = JSON.parse(localStorage.getItem('rendiciones_config') || `{"caja_nombre":"${DEFAULT_CAJA_FUERTE_NAME}","allow_adelantos":true,"allow_compras":true,"allow_pagos":true}`);
      setRendConfig(loadedRendConfig);
    } catch (err) {
      console.error("Error loading DB configuration lists:", err);
    }
  };

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

  const applyDefaultIva = (currentDetalle, typedNet) => {
    if (!currentDetalle) return;
    
    const match = getConceptosForCategory(tipo).find(
      (d) => d.label && d.label.toLowerCase() === currentDetalle.trim().toLowerCase()
    );

    if (match) {
      const currentActiveNet = parseFloat(typedNet) || 
                               parseFloat(montoNeto) || 
                               parseFloat(montoNeto105) || 
                               parseFloat(montoNeto27) || 
                               parseFloat(montoExento) || 
                               parseFloat(montoNoGravado) || 0;
      
      const netStr = currentActiveNet.toString();

      if (match.iva === 21) {
        setMontoNeto(netStr);
        setIva21((currentActiveNet * 0.21).toFixed(2));
        setMontoNeto105('0');
        setIva105('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoExento('0');
        setMontoNoGravado('0');
      } else if (match.iva === 10.5) {
        setMontoNeto105(netStr);
        setIva105((currentActiveNet * 0.105).toFixed(2));
        setMontoNeto('0');
        setIva21('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoExento('0');
        setMontoNoGravado('0');
      } else if (match.iva === 27) {
        setMontoNeto27(netStr);
        setIva27((currentActiveNet * 0.27).toFixed(2));
        setMontoNeto('0');
        setIva21('0');
        setMontoNeto105('0');
        setIva105('0');
        setMontoExento('0');
        setMontoNoGravado('0');
      } else {
        setMontoExento(netStr);
        setMontoNeto('0');
        setIva21('0');
        setMontoNeto105('0');
        setIva105('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoNoGravado('0');
      }
    }
  };

  const handleDetalleChange = (val) => {
    setDetalle(val);
    applyDefaultIva(val, montoNeto);
    
    // Sync with breakdown
    if (desgloseConceptos.length <= 1) {
      if (val.trim() === '') {
        setDesgloseConceptos([]);
      } else {
        const concept = getConceptosForCategory(tipo).find(
          (d) => (d.label || d).toLowerCase().trim() === val.toLowerCase().trim()
        );
        const ivaRate = concept && concept.iva !== undefined ? concept.iva : 21;
        
        const newItem = {
          id: desgloseConceptos[0]?.id || `dc_${Date.now()}`,
          concepto: val,
          ivaRate: ivaRate,
          neto: montoNeto || '',
          iva: parseFloat(iva21) || 0,
          subtotal: (parseFloat(montoNeto) || 0) + (parseFloat(iva21) || 0)
        };
        setDesgloseConceptos([newItem]);
      }
    }
  };

  const handleMontoNetoChange = (val) => {
    setMontoNeto(val);
    const num = parseFloat(val) || 0;
    setIva21((num * 0.21).toFixed(2));
  };

  const handleMontoNeto105Change = (val) => {
    setMontoNeto105(val);
    const num = parseFloat(val) || 0;
    setIva105((num * 0.105).toFixed(2));
  };

  const handleMontoNeto27Change = (val) => {
    setMontoNeto27(val);
    const num = parseFloat(val) || 0;
    setIva27((num * 0.27).toFixed(2));
  };

  const getDefaultIvaRate = () => {
    let defaultIva = 21;
    if (desgloseConceptos.length === 1 && desgloseConceptos[0].ivaRate !== undefined && desgloseConceptos[0].ivaRate !== null) {
      defaultIva = parseFloat(desgloseConceptos[0].ivaRate);
    } else {
      const conceptMatch = getConceptosForCategory(tipo).find(
        (d) => d.label && d.label.toLowerCase() === detalle.trim().toLowerCase()
      );
      defaultIva = conceptMatch ? (conceptMatch.iva !== undefined ? conceptMatch.iva : 21) : 21;
    }
    return defaultIva;
  };

  // Recalculate total when inputs change
  useEffect(() => {
    const defaultIva = getDefaultIvaRate();
    let nVal = parseFloat(montoNetoComprobante) || 0;
    const tVal = parseFloat(montoTotalComprobante) || 0;

    if (lastUpdatedField === 'total' && tVal > 0) {
      const recalculatedNet = tVal / (1 + defaultIva / 100);
      const netStr = recalculatedNet.toFixed(2);
      if (montoNetoComprobante !== netStr) {
        setMontoNetoComprobante(netStr);
        nVal = recalculatedNet;
      }
    }

    if (nVal > 0 && desgloseConceptos.length <= 1) {
      if (defaultIva === 21) {
        const netStr = nVal.toFixed(2);
        const ivaStr = (nVal * 0.21).toFixed(2);
        if (montoNeto !== netStr) setMontoNeto(netStr);
        if (iva21 !== ivaStr) setIva21(ivaStr);

        setMontoNeto105('0');
        setIva105('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoExento('0');
      } else if (defaultIva === 10.5) {
        const netStr = nVal.toFixed(2);
        const ivaStr = (nVal * 0.105).toFixed(2);
        if (montoNeto105 !== netStr) setMontoNeto105(netStr);
        if (iva105 !== ivaStr) setIva105(ivaStr);

        setMontoNeto('0');
        setIva21('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoExento('0');
      } else if (defaultIva === 27) {
        const netStr = nVal.toFixed(2);
        const ivaStr = (nVal * 0.27).toFixed(2);
        if (montoNeto27 !== netStr) setMontoNeto27(netStr);
        if (iva27 !== ivaStr) setIva27(ivaStr);

        setMontoNeto('0');
        setIva21('0');
        setMontoNeto105('0');
        setIva105('0');
        setMontoExento('0');
      } else {
        // defaultIva === 0 (Exento)
        const netStr = nVal.toFixed(2);
        if (montoExento !== netStr) setMontoExento(netStr);

        setMontoNeto('0');
        setIva21('0');
        setMontoNeto105('0');
        setIva105('0');
        setMontoNeto27('0');
        setIva27('0');
      }
    }

    const n21 = parseFloat(montoNeto) || 0;
    const i21 = parseFloat(iva21) || 0;
    const n105 = parseFloat(montoNeto105) || 0;
    const i105 = parseFloat(iva105) || 0;
    const n27 = parseFloat(montoNeto27) || 0;
    const i27 = parseFloat(iva27) || 0;
    
    const exento = parseFloat(montoExento) || 0;
    const noGravado = parseFloat(montoNoGravado) || 0;
    
    const pIva = parseFloat(percepIva) || 0;
    const pIibb = parseFloat(percepIibb) || 0;
    const pGan = parseFloat(percepGanancias) || 0;
    
    const internos = parseFloat(impuestosInternos) || 0;
    const tasas = parseFloat(tasasMunicipales) || 0;
    
    const calculatedTotal = n21 + i21 + n105 + i105 + n27 + i27 + exento + noGravado + pIva + pIibb + pGan + internos + tasas;
    setTotal(calculatedTotal.toFixed(2));

    if (lastUpdatedField === 'neto' && nVal > 0) {
      const totStr = calculatedTotal.toFixed(2);
      if (montoTotalComprobante !== totStr) {
        setMontoTotalComprobante(totStr);
      }
    }
  }, [
    montoNetoComprobante, montoTotalComprobante, lastUpdatedField, detalle, uniqueDetails,
    montoNeto, iva21,
    montoNeto105, iva105,
    montoNeto27, iva27,
    montoExento, montoNoGravado,
    percepIva, percepIibb, percepGanancias,
    impuestosInternos, tasasMunicipales,
    desgloseConceptos
  ]);

  const loadPurchasesData = async () => {
    try {
      const allCompras = await db.getCompras(30);
      setHistorialList(allCompras || []);

      // Filter today's purchases using local timezone and robust date checking
      const today = new Date();
      const todayList = (allCompras || []).filter(c => {
        if (!c.fecha) return false;
        
        let d;
        if (typeof c.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha.trim())) {
          const parts = c.fecha.trim().split('-');
          d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
          d = new Date(c.fecha);
        }
        
        if (isNaN(d.getTime())) return false;
        
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear();
      });
      setComprasHoy(todayList);
    } catch (err) {
      console.error("Error loading purchases data:", err);
    }
  };

  const handleProveedorChange = (val) => {
    setProveedor(val);
    if (val === '') {
      setDesgloseConceptos([]);
      setAlias('');
      setCuit('');
      setDetalle('');
    }
    const info = proveedoresMap[val];
    if (info) {
      if (info.cuit) setCuit(formatCuit(info.cuit));
      if (info.alias) setAlias(info.alias);
      if (info.tipo) setTipo(info.tipo);
      if (info.detalle) {
        setDetalle(info.detalle);
        initializeDefaultConceptInDesglose(info.detalle);
      }
      if (info.pago) setPago(info.pago);
      if (info.factura) setFactura(info.factura === 'Entregada' ? 'Factura A' : info.factura);
    }
  };

  const handleAliasChange = (val) => {
    setAlias(val);
    if (val === '') {
      setDesgloseConceptos([]);
      setProveedor('');
      setCuit('');
      setDetalle('');
    }
    const match = proveedoresList.find(p => p.alias && p.alias.toLowerCase() === val.trim().toLowerCase());
    if (match) {
      setProveedor(match.nombre);
      if (match.cuit) setCuit(formatCuit(match.cuit));
      if (match.tipo) setTipo(match.tipo);
      if (match.detalle) {
        setDetalle(match.detalle);
        initializeDefaultConceptInDesglose(match.detalle);
      }
      if (match.pago) setPago(match.pago);
      if (match.factura) setFactura(match.factura === 'Entregada' ? 'Factura A' : match.factura);
    }
  };

  const handleCreateConcepto = async (e) => {
    if (e) e.preventDefault();
    const label = newConceptNombre.trim();
    if (!label) {
      alert("El nombre del concepto/detalle es obligatorio.");
      return;
    }

    const categoryConceptos = getConceptosForCategory(tempCategory);
    const exists = categoryConceptos.some(
      (d) => (d.label || d).toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      alert(`Este concepto ya existe en la categoría ${tempCategory}.`);
      return;
    }

    const newConcept = {
      id: `cc_${Date.now()}`,
      label,
      iva: parseFloat(newConceptIva),
    };

    if (isComprasCalendarCategory(tempCategory)) {
      const subgroupId = COMPRAS_CATEGORY_PERIODIC_SUBGROUP[tempCategory];
      const res = await db.savePagoPeriodico({
        subgrupo: buildFullSubgroup(subgroupId),
        nombre: label,
        monto_mensual: 0,
        dia_vencimiento: 10,
        tipo_factura: 'Factura B',
        iva_alicuota: parseFloat(newConceptIva),
        medio_pago: 'Banco',
        periodicidad: 'Mensual',
        estado_valor: 'VALOR ESTIMADO',
        orden: periodicPayments.filter((p) => resolvePaymentSubgroupId(p) === subgroupId).length,
        activo: true,
      });
      if (!res.success) {
        alert(res.error || 'No se pudo guardar el concepto en el calendario de pagos.');
        return;
      }
      setPeriodicPayments((prev) =>
        sortPeriodicPayments([...prev, normalizePeriodicPayment(res.data)])
      );
    } else {
      const updatedCategorias = comprasCategorias.map((cat) => {
        if (cat.name === tempCategory) {
          return {
            ...cat,
            details: [...(cat.details || []), newConcept],
          };
        }
        return cat;
      });

      setComprasCategorias(updatedCategorias);
      await db.saveComprasCategorias(updatedCategorias);

      const updatedFlatList = [...uniqueDetails, newConcept];
      setUniqueDetails(updatedFlatList);
    }

    // Auto-populate the target input field
    if (conceptTargetField === 'main') {
      handleDetalleChange(label);
    } else if (conceptTargetField === 'desglose') {
      const newItem = {
        id: `dc_${Date.now()}`,
        concepto: label,
        ivaRate: parseFloat(newConceptIva),
        neto: '',
        iva: 0,
        subtotal: 0
      };
      setDesgloseConceptos(prev => [...prev, newItem]);
    } else {
      setNewProvDetalle(label);
    }

    // Close and reset modal
    setShowNuevoConceptoModal(false);
    setNewConceptNombre('');
    setNewConceptIva('21');
  };

  const handleAddConceptToDesglose = () => {
    if (!selectedConceptToAdd) return;
    
    setTipo(tempCategory);
    const conceptsList = getConceptosForCategory(tempCategory);
    const concept = conceptsList.find(d => (d.label || d) === selectedConceptToAdd);
    let ivaRate = concept && concept.iva !== undefined ? concept.iva : 21;

    // Quick Add Override
    const quickCheckbox = document.getElementById('quick-no-considerar');
    if (quickCheckbox && quickCheckbox.checked && selectedConceptToAdd === 'No considerar') {
      const quickIva = document.getElementById('quick-iva-select')?.value;
      if (quickIva !== undefined) ivaRate = parseFloat(quickIva);
    }
    
    // Check for duplicate with SAME name AND SAME IVA
    const exists = desgloseConceptos.some(item => item.concepto === selectedConceptToAdd && item.ivaRate === ivaRate);
    if (exists) {
      alert("Este concepto con el mismo IVA ya está en el desglose.");
      return;
    }
    
    const newItem = {
      id: `dc_${Date.now()}`,
      concepto: selectedConceptToAdd,
      ivaRate: ivaRate,
      neto: '',
      iva: 0,
      subtotal: 0
    };
    
    setDesgloseConceptos(prev => {
      let list = [...prev];
      if (list.length === 1) {
        const n21 = parseFloat(montoNeto) || 0;
        const i21 = parseFloat(iva21) || 0;
        const n105 = parseFloat(montoNeto105) || 0;
        const i105 = parseFloat(iva105) || 0;
        const n27 = parseFloat(montoNeto27) || 0;
        const i27 = parseFloat(iva27) || 0;
        const exento = parseFloat(montoExento) || 0;

        const totalNeto = n21 + n105 + n27 + exento;
        const totalIva = i21 + i105 + i27;
        const totalSub = totalNeto + totalIva;

        list[0] = {
          ...list[0],
          neto: totalNeto > 0 ? totalNeto.toFixed(2) : '0.00',
          iva: totalIva,
          subtotal: totalSub
        };
      }
      return [...list, newItem];
    });
    setSelectedConceptToAdd('');
  };

  const handleRemoveConceptFromDesglose = (id) => {
    setDesgloseConceptos(prev => {
      const nextList = prev.filter(item => item.id !== id);
      if (nextList.length === 0) {
        setMontoNeto('');
        setIva21('');
        setMontoNeto105('');
        setIva105('');
        setMontoNeto27('');
        setIva27('');
        setMontoExento('');
        setDetalle('');
      }
      return nextList;
    });
  };

  const handleDesgloseNetoChange = (id, rawNetoValue) => {
    const value = parseFloat(rawNetoValue) || 0;
    setDesgloseConceptos(prev => {
      if (prev.length === 0) return prev;

      // 1. Calculate the new values for the edited concept
      let nextList = prev.map(item => {
        if (item.id !== id) return item;
        const rate = item.ivaRate || 0;
        const computedIva = parseFloat((value * (rate / 100)).toFixed(2));
        const computedSubtotal = parseFloat((value + computedIva).toFixed(2));
        return {
          ...item,
          neto: rawNetoValue,
          iva: computedIva,
          subtotal: computedSubtotal
        };
      });

      // 2. If there is a fixed net and the edited concept is NOT the first one:
      const fixedNet = parseFloat(montoNetoComprobante) || 0;
      if (fixedNet > 0 && prev.length > 1 && id !== prev[0].id) {
        // Sum of nets of all items excluding the first one in the nextList
        const otherItemsNetSum = nextList.slice(1).reduce((sum, item) => sum + (parseFloat(item.neto) || 0), 0);

        // Remaining net for the first concept
        const remainingNet = Math.max(0, fixedNet - otherItemsNetSum);

        // Calculate the IVA and subtotal for the first concept based on its ivaRate
        const firstItem = nextList[0];
        const firstRate = firstItem.ivaRate || 0;
        const computedIva = parseFloat((remainingNet * (firstRate / 100)).toFixed(2));
        const computedSubtotal = parseFloat((remainingNet + computedIva).toFixed(2));

        nextList[0] = {
          ...firstItem,
          neto: remainingNet.toFixed(2),
          iva: computedIva,
          subtotal: computedSubtotal
        };
      }

      return nextList;
    });
  };

  useEffect(() => {
    if (desgloseConceptos.length > 0) {
      const names = desgloseConceptos
        .map(item => item.concepto)
        .filter(Boolean)
        .join(', ');
      setDetalle(names);

      if (desgloseConceptos.length > 1) {
        let n21 = 0, i21 = 0;
        let n105 = 0, i105 = 0;
        let n27 = 0, i27 = 0;
        let exentoVal = 0;
        
        desgloseConceptos.forEach(item => {
          const itemNeto = parseFloat(item.neto) || 0;
          const itemIva = parseFloat(item.iva) || 0;
          const rate = parseFloat(item.ivaRate) || 0;
          
          if (rate === 21) {
            n21 += itemNeto;
            i21 += itemIva;
          } else if (rate === 10.5) {
            n105 += itemNeto;
            i105 += itemIva;
          } else if (rate === 27) {
            n27 += itemNeto;
            i27 += itemIva;
          } else if (rate === 0) {
            exentoVal += itemNeto;
          }
        });
        
        setMontoNeto(n21 > 0 ? n21.toFixed(2) : '');
        setIva21(i21 > 0 ? i21.toFixed(2) : '');
        setMontoNeto105(n105 > 0 ? n105.toFixed(2) : '');
        setIva105(i105 > 0 ? i105.toFixed(2) : '');
        setMontoNeto27(n27 > 0 ? n27.toFixed(2) : '');
        setIva27(i27 > 0 ? i27.toFixed(2) : '');
        setMontoExento(exentoVal > 0 ? exentoVal.toFixed(2) : '');
      }
    }
  }, [desgloseConceptos]);

  const handleCreateProveedor = async (e) => {
    e.preventDefault();
    if (!newProvNombre.trim()) {
      alert("El nombre del proveedor es obligatorio.");
      return;
    }

    try {
      const { success, data, error } = await db.saveProveedor({
        nombre: newProvNombre.trim(),
        alias: newProvAlias.trim(),
        cuit: newProvCuit.trim(),
        tipo: newProvTipo,
        detalle: newProvDetalle,
        pago: newProvPago,
        factura: newProvFactura,
        celular_repartidor: newProvCelRepartidor,
        celular_administracion: newProvCelAdmin
      }, editingProveedorOriginalName);

      if (success) {
        // Refresh supplier suggestions map
        await loadDBData();

        // Autocomplete main form with newly created supplier details (if not editing)
        if (!editingProveedorOriginalName) {
          handleProveedorChange(newProvNombre.trim());
        }

        closeProveedorModal();
      } else {
        alert("Error al guardar el proveedor: " + (error || ""));
      }
    } catch (err) {
      console.error(err);
      alert("Ocurrió un error al registrar el proveedor.");
    }
  };

  const closeProveedorModal = () => {
    setShowNuevoProveedorModal(false);
    setEditingProveedorOriginalName(null);
    setNewProvNombre('');
    setNewProvAlias('');
    setNewProvCuit('');
    setNewProvTipo('Mercadería');
    setNewProvDetalle('');
    setNewProvPago('Caja');
    setNewProvFactura('Sin factura');
    setNewProvCelRepartidor('');
    setNewProvCelAdmin('');
  };

  const handleDeleteProveedor = async (nombre) => {
    if (!window.confirm(`¿Seguro que deseas eliminar al proveedor "${nombre}"?`)) return;
    try {
      const res = await db.deleteProveedor(nombre);
      if (res.success) {
        await loadDBData();
      } else {
        alert(res.error || "No se pudo eliminar el proveedor.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al intentar eliminar el proveedor.");
    }
  };

  // Drag and drop / file selector OCR logic
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processInvoiceFile(file);
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const processInvoiceFile = async (file) => {
    setOcrStatus('reading');
    setOcrError('');

    try {
      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey || apiKey.trim() === '') {
        // Fallback: AI Simulator
        setTimeout(() => {
          const fakeResult = {
            proveedor: "Distribuidora Mayorista S.A.",
            cuit: "30708912345",
             fecha: (() => {
               const today = new Date();
               const yyyy = today.getFullYear();
               const mm = String(today.getMonth() + 1).padStart(2, '0');
               const dd = String(today.getDate()).padStart(2, '0');
               return `${yyyy}-${mm}-${dd}`;
             })(),
            tipo: "Mercadería",
            detalle: "Quesos, Lacteos y Jamones varios",
            monto_neto: 41322.31,
            iva_21: 8677.69,
            monto_neto_10_5: 0.00,
            iva_10_5: 0.00,
            monto_neto_27: 0.00,
            iva_27: 0.00,
            monto_exento: 0.00,
            monto_no_gravado: 0.00,
            percep_iva: 0.00,
            percep_iibb: 0.00,
            iibb_jurisdiccion: null,
            percep_ganancias: 0.00,
            impuestos_internos: 0.00,
            tasas_municipales: 0.00,
            total: 50000.00
          };

          setProveedor(fakeResult.proveedor);
          setCuit(formatCuit(fakeResult.cuit));
          setFecha(clampDateToToday(fakeResult.fecha));
          setTipo(fakeResult.tipo);
          setDetalle(fakeResult.detalle);
           
           let defaultIvaRate = 21;
           let predominantNeto = fakeResult.monto_neto;
           if (fakeResult.monto_neto_10_5 > 0) {
             defaultIvaRate = 10.5;
             predominantNeto = fakeResult.monto_neto_10_5;
           } else if (fakeResult.monto_neto_27 > 0) {
             defaultIvaRate = 27;
             predominantNeto = fakeResult.monto_neto_27;
           } else if (fakeResult.monto_exento > 0) {
             defaultIvaRate = 0;
             predominantNeto = fakeResult.monto_exento;
           }
           initializeDefaultConceptInDesglose(fakeResult.detalle, predominantNeto, defaultIvaRate);

          setMontoNeto(fakeResult.monto_neto.toFixed(2));
          setIva21(fakeResult.iva_21.toFixed(2));
          setMontoNeto105(fakeResult.monto_neto_10_5.toFixed(2));
          setIva105(fakeResult.iva_10_5.toFixed(2));
          setMontoNeto27(fakeResult.monto_neto_27.toFixed(2));
          setIva27(fakeResult.iva_27.toFixed(2));
          setMontoExento(fakeResult.monto_exento.toFixed(2));
          setMontoNoGravado(fakeResult.monto_no_gravado.toFixed(2));
          setPercepIva(fakeResult.percep_iva.toFixed(2));
          setPercepIibb(fakeResult.percep_iibb.toFixed(2));
          setIibbJurisdiccion(fakeResult.iibb_jurisdiccion || '');
          setPercepGanancias(fakeResult.percep_ganancias.toFixed(2));
          setImpuestosInternos(fakeResult.impuestos_internos.toFixed(2));
          setTasasMunicipales(fakeResult.tasas_municipales.toFixed(2));
          setTotal(fakeResult.total.toFixed(2));
          setFactura('Factura A');
          setOcrStatus('success');

          // Auto-focus supplier box

          // Clear status after delay
          setTimeout(() => setOcrStatus(''), 4000);
        }, 2000);
        return;
      }

      const base64Data = await fileToBase64(file);

      const prompt = `Analiza esta factura o ticket y extrae los siguientes datos. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código Markdown ni explicaciones, respetando este esquema:
{
  "proveedor": "Nombre comercial del proveedor",
  "cuit": "CUIT del emisor (solo números, 11 dígitos, sin guiones)",
  "fecha": "Fecha de emisión en formato YYYY-MM-DD",
  "tipo": "Mercadería" | "Mantenimiento" | "Inversión" | "Servicios" | "Estructura y Gestión" | "Seguros",
  "detalle": "Descripción breve de lo comprado",
  "monto_neto": neto gravado al 21% en número decimal (0.00 si no aplica),
  "iva_21": total IVA 21% en número decimal (0.00 si no aplica),
  "monto_neto_10_5": neto gravado al 10.5% en número decimal (0.00 si no aplica),
  "iva_10_5": total IVA 10.5% en número decimal (0.00 si no aplica),
  "monto_neto_27": neto gravado al 27% en número decimal (0.00 si no aplica),
  "iva_27": total IVA 27% en número decimal (0.00 si no aplica),
  "monto_exento": monto exento de IVA en número decimal (0.00 si no aplica),
  "monto_no_gravado": monto no gravado en número decimal (0.00 si no aplica),
  "percep_iva": percepción de IVA en número decimal (0.00 si no aplica),
  "percep_iibb": percepción de Ingresos Brutos en número decimal (0.00 si no aplica),
  "iibb_jurisdiccion": nombre de la provincia a la que pertenece la percepción de IIBB (CABA, Buenos Aires, Neuquén, Río Negro, etc. o null si no aplica),
  "percep_ganancias": percepción de Ganancias en número decimal (0.00 si no aplica),
  "impuestos_internos": impuestos internos en número decimal (0.00 si no aplica),
  "tasas_municipales": tasas municipales o municipales/servicios en número decimal (0.00 si no aplica),
  "total": total final a pagar en número decimal
}`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: file.type,
                      data: base64Data
                    }
                  },
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      const resJson = await response.json();
      const textOutput = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textOutput) {
        throw new Error("No se pudo leer la respuesta de la IA.");
      }

      const cleanJson = JSON.parse(textOutput.trim());

      setProveedor(cleanJson.proveedor || '');
      setCuit(formatCuit(cleanJson.cuit || ''));
      if (cleanJson.fecha) setFecha(clampDateToToday(cleanJson.fecha));
      if (cleanJson.tipo) setTipo(cleanJson.tipo);
      setDetalle(cleanJson.detalle || '');
      
      let defaultIvaRate = 21;
      let predominantNeto = parseFloat(cleanJson.monto_neto || 0);
      if (parseFloat(cleanJson.monto_neto_10_5 || 0) > 0) {
        defaultIvaRate = 10.5;
        predominantNeto = parseFloat(cleanJson.monto_neto_10_5 || 0);
      } else if (parseFloat(cleanJson.monto_neto_27 || 0) > 0) {
        defaultIvaRate = 27;
        predominantNeto = parseFloat(cleanJson.monto_neto_27 || 0);
      } else if (parseFloat(cleanJson.monto_exento || 0) > 0) {
        defaultIvaRate = 0;
        predominantNeto = parseFloat(cleanJson.monto_exento || 0);
      }
      initializeDefaultConceptInDesglose(cleanJson.detalle || 'Insumos varios', predominantNeto, defaultIvaRate);

      setMontoNeto(parseFloat(cleanJson.monto_neto || 0).toFixed(2));
      setIva21(parseFloat(cleanJson.iva_21 || 0).toFixed(2));
      setMontoNeto105(parseFloat(cleanJson.monto_neto_10_5 || 0).toFixed(2));
      setIva105(parseFloat(cleanJson.iva_10_5 || 0).toFixed(2));
      setMontoNeto27(parseFloat(cleanJson.monto_neto_27 || 0).toFixed(2));
      setIva27(parseFloat(cleanJson.iva_27 || 0).toFixed(2));
      setMontoExento(parseFloat(cleanJson.monto_exento || 0).toFixed(2));
      setMontoNoGravado(parseFloat(cleanJson.monto_no_gravado || 0).toFixed(2));
      setPercepIva(parseFloat(cleanJson.percep_iva || 0).toFixed(2));
      setPercepIibb(parseFloat(cleanJson.percep_iibb || 0).toFixed(2));
      setIibbJurisdiccion(cleanJson.iibb_jurisdiccion || '');
      setPercepGanancias(parseFloat(cleanJson.percep_ganancias || 0).toFixed(2));
      setImpuestosInternos(parseFloat(cleanJson.impuestos_internos || 0).toFixed(2));
      setTasasMunicipales(parseFloat(cleanJson.tasas_municipales || 0).toFixed(2));
      setTotal(parseFloat(cleanJson.total || 0).toFixed(2));
      setFactura('Factura A');
      setOcrStatus('success');

      // Check if new supplier

      setTimeout(() => setOcrStatus(''), 4000);
    } catch (err) {
      console.error(err);
      setOcrStatus('error');
      setOcrError(err.message || 'Error al procesar la factura con Gemini.');
    }
  };

  // Submit Handler
  const handleSaveCompra = async (e) => {
    e.preventDefault();
    if (!proveedor.trim()) {
      alert("Por favor introduce el nombre del proveedor.");
      return;
    }

    const todayStr = getTodayLocalDateString();
    if (fecha > todayStr) {
      alert("No se pueden registrar compras con fecha posterior a hoy.");
      return;
    }

    // Validation for invoices (not "Sin factura")
    if (factura !== 'Sin factura') {
      if (!cuit || cuit.replace(/[^0-9]/g, '').length < 11) {
        alert("Para este tipo de factura el CUIT del proveedor es obligatorio y debe ser válido.");
        return;
      }
      if (!nroFactura || nroFactura.replace(/[^0-9]/g, '').length === 0) {
        alert("Para este tipo de factura el NÚMERO DE FACTURA es obligatorio.");
        return;
      }
      
      const totalNetoBreakdown = desgloseConceptos.reduce((sum, item) => sum + (parseFloat(item.neto) || 0), 0);
      const singleNeto = (parseFloat(montoNeto) || 0) + (parseFloat(montoNeto105) || 0) + (parseFloat(montoNeto27) || 0) + (parseFloat(montoExento) || 0);
      
      if (desgloseConceptos.length > 1) {
        if (totalNetoBreakdown <= 0) {
          alert("Para este tipo de factura el monto NETO es obligatorio.");
          return;
        }
      } else {
        if (singleNeto <= 0) {
          alert("Para este tipo de factura el monto NETO es obligatorio.");
          return;
        }
      }
    }

    const numericTotal = parseFloat(total) || 0;
    if (numericTotal <= 0) {
      alert("El monto total de la compra debe ser mayor que 0.");
      return;
    }

    if (!pago) {
      alert("Por favor seleccione una forma de pago.");
      return;
    }

    let finalPago = pago;
    let isCajaPayment = pago.toLowerCase().includes("caja") || pago.toLowerCase().includes("efectivo");

    if (isCajaPayment) {
      if (!turnoAsignado) {
        alert("Debe seleccionar un turno para descontar el efectivo.");
        return;
      }
      // Form tag to link with cash shifts
      const dateParts = fecha.split("-"); // YYYY-MM-DD
      const visualDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`; // DD/MM/YYYY
      finalPago = `Caja ${visualDate} ${turnoAsignado}`;
    }

    setSaveStatus('saving');
    setSaveError('');

    try {
      let finalDesglose = [...desgloseConceptos];
      if (finalDesglose.length === 1) {
        const n21 = parseFloat(montoNeto) || 0;
        const i21 = parseFloat(iva21) || 0;
        const n105 = parseFloat(montoNeto105) || 0;
        const i105 = parseFloat(iva105) || 0;
        const n27 = parseFloat(montoNeto27) || 0;
        const i27 = parseFloat(iva27) || 0;
        const exento = parseFloat(montoExento) || 0;

        const totalNeto = n21 + n105 + n27 + exento;
        const totalIva = i21 + i105 + i27;
        const totalSub = totalNeto + totalIva;

        finalDesglose = [{
          ...finalDesglose[0],
          neto: totalNeto > 0 ? totalNeto.toFixed(2) : '0.00',
          iva: totalIva,
          subtotal: totalSub
        }];
      }

      const dataToSave = {
        fecha: new Date(fecha + "T12:00:00").toISOString(), // midday local time to keep date uniform
        proveedor: proveedor.trim(),
        cuit: cuit.replace(/[^0-9]/g, '') || null,
        alias: alias.trim() || null,
        tipo,
        detalle: detalle.trim() || '',
        monto_neto: parseFloat(montoNeto) || 0,
        iva_21: parseFloat(iva21) || 0,
        monto_neto_10_5: parseFloat(montoNeto105) || 0,
        iva_10_5: parseFloat(iva105) || 0,
        monto_neto_27: parseFloat(montoNeto27) || 0,
        iva_27: parseFloat(iva27) || 0,
        monto_exento: parseFloat(montoExento) || 0,
        monto_no_gravado: parseFloat(montoNoGravado) || 0,
        percep_iva: parseFloat(percepIva) || 0,
        percep_iibb: parseFloat(percepIibb) || 0,
        iibb_jurisdiccion: (parseFloat(percepIibb) || 0) > 0 ? iibbJurisdiccion.trim() : null,
        percep_ganancias: parseFloat(percepGanancias) || 0,
        impuestos_internos: parseFloat(impuestosInternos) || 0,
        tasas_municipales: parseFloat(tasasMunicipales) || 0,
        total: numericTotal,
        pago: finalPago,
        factura,
        nro_factura: nroFactura,
        no_computar_compra: noComputarCompra,
        caja_cierre: null,
        conceptos_desglose: finalDesglose
      };

      const res = await db.saveCompra(dataToSave);
      if (res.success) {
        setSaveStatus('success');

        // Update periodic payment status if applicable
        if (navState?.periodicPayment) {
          db.updatePagoPeriodicoStatus(navState.periodicPayment.id, {
            ultimo_pago_fecha: fecha || new Date().toISOString().split('T')[0]
          });
          // Clear navState to prevent re-filling if the page re-renders or we navigate back
          navigate('compras', null);
        }

        // Reset form
        setProveedor('');
        setCuit('');
        setAlias('');
        setDetalle('');
        setMontoNeto('0');
        setIva21('0');
        setMontoNeto105('0');
        setIva105('0');
        setMontoNeto27('0');
        setIva27('0');
        setMontoExento('0');
        setMontoNoGravado('0');
        setPercepIva('0');
        setPercepIibb('0');
        setIibbJurisdiccion('');
        setPercepGanancias('0');
        setImpuestosInternos('0');
        setTasasMunicipales('0');
        setTotal('0');
        setMontoNetoComprobante('');
        setMontoTotalComprobante('');
        setLastUpdatedField('neto');
        setFactura('Sin factura');
        setNroFactura('');
        setNoComputarCompra(false);
        setDesgloseConceptos([]);
        setSelectedConceptToAdd('');

        // Reload data
        await loadDBData();
        await loadPurchasesData();

        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        throw new Error(res.error || 'Error al guardar la compra en la base de datos.');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setSaveError(err.message || 'Error al conectar con la base de datos.');
    }
  };

  // Delete Handler
  const handleDeleteCompra = async (id) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta compra del registro?")) return;

    try {
      const res = await db.deleteCompra(id);
      if (res.success) {
        await loadPurchasesData();
      } else {
        alert(res.error || "No se pudo eliminar la compra.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al intentar eliminar la compra.");
    }
  };

  // Receive Invoice Handler
  const handleMarkAsEntregada = async (id, proveedorNombre) => {
    try {
      // Find provider's default invoice type from providersMap
      const provInfo = proveedoresMap[proveedorNombre];
      const tipoFactura = provInfo && provInfo.factura ? provInfo.factura : 'Factura A'; // Default to A if not found, or use 'Entregada' if preferred
      
      const res = await db.marcarFacturaEntregada(id, tipoFactura);
      if (res.success) {
        alert(`Factura marcada como Recibida (${tipoFactura}).`);
        await loadPurchasesData();
      } else {
        alert(res.error || "Error al actualizar factura.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión.");
    }
  };

  const getPaymentIcon = (method) => {
    const m = (method || '').toLowerCase();
    if (m.includes('efectivo') || m.includes('caja')) return 'bi-cash-coin';
    if (m.includes('banco') || m.includes('transferencia')) return 'bi-bank';
    if (m.includes('tarjeta')) return 'bi-credit-card';
    if (m.includes('rendic')) return 'bi-file-earmark-text';
    return 'bi-wallet2';
  };

  const renderConceptosNeto = (comp) => {
    const desglose = comp.conceptos_desglose || [];
    if (desglose.length === 0) {
      return comp.detalle || '';
    }
    return desglose.map(item => {
      const netVal = parseFloat(item.neto) || 0;
      return `${item.concepto} ($${netVal.toFixed(2)})`;
    }).join(', ');
  };

  const handleHeaderClick = (field) => {
    if (sortByField === field) {
      setSortAscending(!sortAscending);
    } else {
      setSortByField(field);
      setSortAscending(field !== 'fecha' && field !== 'total');
    }
  };

  const getSortedHistorial = () => {
    const list = [...historialList];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortByField === 'fecha') {
        comparison = new Date(a.fecha) - new Date(b.fecha);
      } else if (sortByField === 'proveedor') {
        comparison = String(a.proveedor || '').localeCompare(String(b.proveedor || ''));
      } else if (sortByField === 'tipo') {
        comparison = String(a.tipo || '').localeCompare(String(b.tipo || ''));
      } else if (sortByField === 'total') {
        comparison = (parseFloat(a.total) || 0) - (parseFloat(b.total) || 0);
      } else if (sortByField === 'pago') {
        comparison = String(a.pago || '').localeCompare(String(b.pago || ''));
      } else if (sortByField === 'factura') {
        comparison = String(a.factura || '').localeCompare(String(b.factura || ''));
      }
      return sortAscending ? comparison : -comparison;
    });
    return list;
  };

  const handleTodayHeaderClick = (field) => {
    if (todaySortByField === field) {
      setTodaySortAscending(!todaySortAscending);
    } else {
      setTodaySortByField(field);
      setTodaySortAscending(field !== 'fecha' && field !== 'total');
    }
  };

  const getSortedTodayCompras = () => {
    const list = [...comprasHoy];
    list.sort((a, b) => {
      let comparison = 0;
      if (todaySortByField === 'fecha') {
        comparison = new Date(a.fecha) - new Date(b.fecha);
      } else if (todaySortByField === 'proveedor') {
        comparison = String(a.proveedor || '').localeCompare(String(a.proveedor || ''));
      } else if (todaySortByField === 'tipo') {
        comparison = String(a.tipo || '').localeCompare(String(b.tipo || ''));
      } else if (todaySortByField === 'total') {
        comparison = (parseFloat(a.total) || 0) - (parseFloat(b.total) || 0);
      } else if (todaySortByField === 'pago') {
        comparison = String(a.pago || '').localeCompare(String(b.pago || ''));
      } else if (todaySortByField === 'factura') {
        comparison = String(a.factura || '').localeCompare(String(b.factura || ''));
      }
      return todaySortAscending ? comparison : -comparison;
    });
    return list;
  };

  // Helper formatting currency
  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
  };

  const isOcrApiKeyAvailable = !!localStorage.getItem('gemini_api_key');

  const providerCategorias = useMemo(
    () => getProviderCategories(comprasCategorias),
    [comprasCategorias]
  );

  return (
    <div className="page-card" style={{ borderLeft: '5px solid ' + (accentColor || '#ef4444') }}>
      {/* TABS HEADER: CARGAR COMPRA VS PROVEEDORES */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid var(--border-color)', paddingBottom: '12px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="bi bi-cart-fill" style={{ color: accentColor || '#ef4444' }}></i>
          {viewMode === 'register' ? 'Cargar Compra' : 'Gestión de Proveedores'}
        </h2>
        
        <div className="flex-row-group" style={{ alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn-new-task"
            style={{
              backgroundColor: '#f8fafc',
              color: '#1e40af',
              border: '1px solid #93c5fd',
              padding: '8px 14px',
            }}
            onClick={() => setShowGuiaModal(true)}
          >
            <i className="bi bi-journal-text me-1"></i> Guía
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'register' ? (accentColor || '#ef4444') : 'transparent',
              color: viewMode === 'register' ? '#ffffff' : (accentColor || '#ef4444'),
              border: '1px solid ' + (accentColor || '#ef4444')
            }}
            onClick={() => setViewMode('register')}
          >
            <i className="bi bi-cart-plus me-1"></i> Cargar Compra
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'suppliers' ? (accentColor || '#ef4444') : 'transparent',
              color: viewMode === 'suppliers' ? '#ffffff' : (accentColor || '#ef4444'),
              border: '1px solid ' + (accentColor || '#ef4444')
            }}
            onClick={() => setViewMode('suppliers')}
          >
            <i className="bi bi-people me-1"></i> Proveedores ({proveedoresList.length})
          </button>
        </div>
      </div>

      <ExpenseGuideModal
        open={showGuiaModal}
        onClose={() => setShowGuiaModal(false)}
        accentColor={accentColor || '#ef4444'}
      />

      {viewMode === 'register' && (
        <>
          {/* AI Invoice Scan Box */}
      <div 
        style={{
          border: '2px dashed #f87171',
          backgroundColor: '#fff5f5',
          borderRadius: '12px',
          padding: '20px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '25px',
          transition: 'all 0.2s ease',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)'
        }}
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) await processInvoiceFile(file);
        }}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept="image/*,application/pdf"
          onChange={handleFileChange}
        />
        <i className="bi bi-cloud-arrow-up-fill text-danger" style={{ fontSize: '2.5rem' }}></i>
        <h5 style={{ margin: '8px 0 4px 0', fontWeight: '700', color: '#991b1b' }}>Lectura Inteligente de Factura</h5>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#ef4444' }}>
          Arrastra o selecciona un archivo (Imagen o PDF) para completar los campos con Inteligencia Artificial.
        </p>

        {/* OCR Status Messages */}
        {ocrStatus === 'reading' && (
          <div style={{ marginTop: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <span className="spinner-border spinner-border-sm text-danger" role="status"></span>
            <span className="small text-danger fw-bold">Analizando factura con Gemini AI...</span>
          </div>
        )}

        {ocrStatus === 'success' && (
          <div style={{ marginTop: '15px', color: '#16a34a', fontSize: '0.85rem', fontWeight: 'bold' }}>
            <i className="bi bi-check-circle-fill"></i> ¡Factura decodificada correctamente! Revisa los campos abajo.
            {!isOcrApiKeyAvailable && (
              <div style={{ color: '#d97706', fontSize: '0.75rem', fontWeight: 'normal', marginTop: '4px' }}>
                * Modo Demo: Se utilizaron datos de simulación. Configura tu Gemini API Key para facturas reales.
              </div>
            )}
          </div>
        )}

        {ocrStatus === 'error' && (
          <div style={{ marginTop: '15px', color: '#dc2626', fontSize: '0.85rem', fontWeight: 'bold' }}>
            <i className="bi bi-exclamation-triangle-fill"></i> Error: {ocrError}
          </div>
        )}
      </div>

      {/* Main Registration Form */}
      <form 
        onSubmit={handleSaveCompra} 
        noValidate 
        style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
          }
        }}
      >
        
        <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #cbd5e1', paddingBottom: '6px', color: '#1e293b', fontSize: '0.95rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <i className="bi bi-file-earmark-text-fill text-primary"></i> Datos del Comprobante
        </h4>

        <div style={{ display: 'flex', gap: '25px', flexWrap: 'wrap' }}>
          
          {/* COLUMN LEFT: General Data (Metadata) */}
          <div style={{ flex: '1.2 1 500px', display: 'flex', flexDirection: 'column', gap: '15px' }}>

            {/* Row: Fecha & Alias */}
            <div style={{ display: 'flex', gap: '15px' }}>
              {/* Fecha */}
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold">FECHA</label>
                <input 
                  type="date" 
                  className="form-input fw-bold" 
                  value={fecha}
                  max={getTodayLocalDateString()}
                  onChange={(e) => setFecha(clampDateToToday(e.target.value))}
                  onInput={(e) => setFecha(clampDateToToday(e.target.value))}
                  required
                />
                <small className="text-muted d-block mt-1" style={{ fontSize: '0.7rem' }}>No se permiten fechas futuras</small>
              </div>

              {/* Alias */}
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold">ALIAS PROVEEDOR</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    style={{ width: '100%' }}
                    placeholder="Ej: Rossi Fiambrería, Sol Distribuidora"
                    value={alias}
                    onChange={(e) => {
                      handleAliasChange(e.target.value);
                      setShowAliasSuggestions(true);
                    }}
                    onFocus={() => setShowAliasSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowAliasSuggestions(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        if (aliasMatch) {
                          e.preventDefault();
                          setProveedor(aliasMatch.nombre);
                          setCuit(formatCuit(aliasMatch.cuit || ''));
                          setAlias(aliasMatch.alias || '');
                          if (aliasMatch.tipo) setTipo(aliasMatch.tipo);
                          if (aliasMatch.detalle) {
                            setDetalle(aliasMatch.detalle);
                            initializeDefaultConceptInDesglose(aliasMatch.detalle);
                          }
                          if (aliasMatch.pago) setPago(aliasMatch.pago);
                          if (aliasMatch.factura) setFactura(aliasMatch.factura === 'Entregada' ? 'Factura A' : aliasMatch.factura);
                          setShowAliasSuggestions(false);
                          setTimeout(() => {
                            montoNetoInputRef.current?.focus();
                            montoNetoInputRef.current?.select();
                          }, 50);
                        }
                      }
                    }}
                    autoComplete="off"
                  />
                  {alias.trim() !== '' && aliasAutocompleteSuffix && (
                    <div style={{
                      position: 'absolute',
                      left: '13.5px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                      color: '#a1a1aa',
                      whiteSpace: 'pre',
                      display: 'flex',
                      alignItems: 'center',
                      zIndex: 2
                    }}>
                      <span style={{ color: 'transparent' }}>{alias}</span>
                      <span>{aliasAutocompleteSuffix}</span>
                    </div>
                  )}
                  {showAliasSuggestions && filteredProveedoresByAlias.length > 0 && (
                    <ul className="suggestions-list" style={{ zIndex: 110, position: 'absolute', width: '100%', top: '100%', left: 0, paddingLeft: 0, margin: 0, listStyle: 'none' }}>
                      {filteredProveedoresByAlias.map((p, idx) => (
                        <li 
                          key={p.nombre || idx} 
                          className="suggestion-item text-start"
                          style={{ 
                            padding: '8px 10px', 
                            fontSize: '0.85rem',
                            backgroundColor: idx === 0 ? '#f5f3ff' : 'transparent',
                            borderLeft: idx === 0 ? '3px solid #8b5cf6' : 'none',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            setProveedor(p.nombre);
                            setCuit(formatCuit(p.cuit || ''));
                            setAlias(p.alias || '');
                            if (p.tipo) setTipo(p.tipo);
                            if (p.detalle) {
                                setDetalle(p.detalle);
                                initializeDefaultConceptInDesglose(p.detalle);
                            }
                            if (p.pago) setPago(p.pago);
                            if (p.factura) setFactura(p.factura === 'Entregada' ? 'Factura A' : p.factura);
                            setShowAliasSuggestions(false);
                            setTimeout(() => {
                              montoNetoInputRef.current?.focus();
                              montoNetoInputRef.current?.select();
                            }, 50);
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>{p.nombre}</strong>
                          </div>
                          <span className="suggestion-meta" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '3px' }}>
                            CUIT: {formatCuit(p.cuit) || 'Sin CUIT'} | Alias: {p.alias || 'Sin Alias'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Proveedor */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label fw-bold">PROVEEDOR</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    className="form-input fw-bold" 
                    style={{ width: '100%' }}
                    placeholder="Buscar o escribir nombre..."
                    value={proveedor}
                    onChange={(e) => {
                      handleProveedorChange(e.target.value);
                      setShowProvSuggestions(true);
                    }}
                    onFocus={() => setShowProvSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowProvSuggestions(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        if (provMatch) {
                          e.preventDefault();
                          setProveedor(provMatch.nombre);
                          setCuit(formatCuit(provMatch.cuit || ''));
                          setAlias(provMatch.alias || '');
                          if (provMatch.tipo) setTipo(provMatch.tipo);
                          if (provMatch.detalle) {
                            setDetalle(provMatch.detalle);
                            initializeDefaultConceptInDesglose(provMatch.detalle);
                          }
                          if (provMatch.pago) setPago(provMatch.pago);
                          if (provMatch.factura) setFactura(provMatch.factura === 'Entregada' ? 'Factura A' : provMatch.factura);
                          setShowProvSuggestions(false);
                          setTimeout(() => {
                            montoNetoInputRef.current?.focus();
                            montoNetoInputRef.current?.select();
                          }, 50);
                        }
                      }
                    }}
                    required
                    autoComplete="off"
                  />
                  {proveedor.trim() !== '' && provAutocompleteSuffix && (
                    <div style={{
                      position: 'absolute',
                      left: '13.5px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                      fontWeight: 'bold',
                      color: '#a1a1aa',
                      whiteSpace: 'pre',
                      display: 'flex',
                      alignItems: 'center',
                      zIndex: 2
                    }}>
                      <span style={{ color: 'transparent' }}>{proveedor}</span>
                      <span>{provAutocompleteSuffix}</span>
                    </div>
                  )}
                  {showProvSuggestions && filteredProveedores.length > 0 && (
                    <ul className="suggestions-list" style={{ zIndex: 110, position: 'absolute', width: '100%', top: '100%', left: 0, paddingLeft: 0, margin: 0, listStyle: 'none' }}>
                      {filteredProveedores.map((p, idx) => (
                        <li 
                          key={p.nombre || idx} 
                          className="suggestion-item text-start"
                          style={{ 
                            padding: '8px 10px', 
                            fontSize: '0.85rem',
                            backgroundColor: idx === 0 ? '#f5f3ff' : 'transparent',
                            borderLeft: idx === 0 ? '3px solid #8b5cf6' : 'none',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            setProveedor(p.nombre);
                            setCuit(formatCuit(p.cuit || ''));
                            setAlias(p.alias || '');
                            if (p.tipo) setTipo(p.tipo);
                            if (p.detalle) {
                              setDetalle(p.detalle);
                              initializeDefaultConceptInDesglose(p.detalle);
                            }
                            if (p.pago) setPago(p.pago);
                            if (p.factura) setFactura(p.factura === 'Entregada' ? 'Factura A' : p.factura);
                            
                            // Load existing phones if any
                            // These will be in proveedoresMap[p.nombre]
                            setShowProvSuggestions(false);
                            setTimeout(() => {
                              montoNetoInputRef.current?.focus();
                              montoNetoInputRef.current?.select();
                            }, 50);
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>{p.nombre}</strong>
                          </div>
                          <span className="suggestion-meta" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '3px' }}>
                            CUIT: {formatCuit(p.cuit) || 'Sin CUIT'} | Alias: {p.alias || 'Sin Alias'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-new-task"
                  style={{
                    backgroundColor: '#8b5cf6',
                    padding: '10px 14px',
                    height: '42px',
                    flexShrink: 0,
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onClick={() => setShowNuevoProveedorModal(true)}
                  title="Nuevo proveedor con valores por defecto"
                >
                  <i className="bi bi-person-plus-fill"></i> + Nuevo
                </button>
              </div>
            </div>

            {/* NRO FACTURA & CUIT */}
            <div style={{ display: 'flex', gap: '15px', margin: 0 }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold">NRO FACTURA</label>
                <input 
                  type="text" 
                  className="form-input text-center fw-bold" 
                  style={{ width: '100%', letterSpacing: '1px' }}
                  value={nroFactura}
                  onChange={(e) => {
                    const { p1, p2, original } = formatNroFactura(e.target.value);
                    if (original.includes('-')) {
                      setNroFactura(`${p1}-${p2}`);
                    } else {
                      setNroFactura(p1 + (p2 ? `-${p2}` : ''));
                    }
                  }}
                  onBlur={handleNroFacturaBlur}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold">CUIT PROVEEDOR</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: 30-70891234-5"
                  value={cuit}
                  onChange={(e) => handleCuitChange(e.target.value, setCuit)}
                  maxLength={13}
                />
              </div>
            </div>

            {/* Categoría / Tipo (Hidden in main screen as per user request) */}
            <div className="form-group" style={{ margin: 0, display: 'none' }}>
              <label className="form-label fw-bold" style={{ display: 'flex', alignItems: 'center' }}>
                CATEGORÍA / TIPO
              </label>
              <select 
                className="form-select" 
                style={{ width: '100%' }}
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
              >
                {comprasCategorias.map((cat, idx) => (
                  <option key={idx} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            {/* Calculadora de Desglose de Conceptos */}
            <div className="form-group" style={{ margin: '15px 0' }}>
              <label className="form-label fw-bold" style={{ display: 'flex', alignItems: 'center' }}>
                CONCEPTOS
                <span className="tooltip-container">
                  <i className="bi bi-info-circle help-icon"></i>
                  <span className="tooltip-text">
                    Desglose detallado de los productos o servicios adquiridos. Puedes editar el nombre directamente en la tabla.
                  </span>
                </span>
              </label>
              <div style={{ position: 'relative', border: '1px solid #cbd5e1', padding: '15px', borderRadius: '8px', backgroundColor: '#f8fafc' }}>

              {desgloseConceptos.length > 0 && (
                <div style={{ marginTop: '15px', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                  <table className="table" style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', margin: 0 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left', backgroundColor: '#e2e8f0', color: '#1e293b' }}>
                        <th style={{ padding: '8px' }}>Concepto</th>
                        <th style={{ padding: '8px', textAlign: 'center', width: '80px' }}>IVA %</th>
                        <th style={{ padding: '8px', textAlign: 'right', width: '130px' }}>Neto ($)</th>
                        <th style={{ padding: '8px', textAlign: 'right', width: '90px' }}>IVA ($)</th>
                        <th style={{ padding: '8px', textAlign: 'right', width: '110px' }}>Total ($)</th>
                        <th style={{ padding: '8px', textAlign: 'center', width: '80px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedConceptToAdd('');
                                setTempCategory(tipo);
                                setShowAddConceptModal(true);
                              }}
                              style={{ border: 'none', background: 'none', color: '#1e40af', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="Agregar otro concepto"
                            >
                              <i className="bi bi-plus-circle-fill" style={{ fontSize: '1.4rem' }}></i>
                            </button>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {desgloseConceptos.map((item, index) => {
                        const isSingleConcept = desgloseConceptos.length === 1;
                        const consolidatedNeto = (parseFloat(montoNeto) || 0) + (parseFloat(montoNeto105) || 0) + (parseFloat(montoNeto27) || 0) + (parseFloat(montoExento) || 0);
                        const consolidatedIva = (parseFloat(iva21) || 0) + (parseFloat(iva105) || 0) + (parseFloat(iva27) || 0);
                        const consolidatedSubtotal = consolidatedNeto + consolidatedIva;

                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #cbd5e1', verticalAlign: 'middle', backgroundColor: 'white' }}>
                            <td style={{ padding: '8px' }}>
                              <input 
                                type="text"
                                className="form-input"
                                style={{ height: '28px', padding: '2px 8px', fontSize: '0.8rem', margin: 0, border: '1px solid transparent', backgroundColor: 'transparent', fontWeight: '500' }}
                                value={item.concepto}
                                onChange={(e) => handleDesgloseConceptoChange(item.id, e.target.value)}
                                onFocus={(e) => e.target.style.borderColor = '#cbd5e1'}
                                onBlur={(e) => e.target.style.borderColor = 'transparent'}
                              />
                            </td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f1f5f9', fontWeight: 'bold', fontSize: '0.75rem', color: '#475569' }}>
                                {item.ivaRate}%
                              </span>
                            </td>
                            <td style={{ padding: '4px' }}>
                              {isSingleConcept ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#8b5cf6', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                                    100%
                                  </span>
                                  <span style={{ fontWeight: 'bold', color: '#1e293b' }}>
                                    ${consolidatedNeto.toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn-new-task"
                                    style={{ height: '24px', padding: '0 6px', margin: 0, backgroundColor: '#f5f3ff', color: '#8b5cf6', border: '1px solid #ddd6fe', fontSize: '0.7rem' }}
                                    onClick={() => handleOpenCalculator('main_neto', montoNetoComprobante)}
                                    title="Calculadora para Neto Fijo"
                                  >
                                    <i className="bi bi-plus"></i>
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <input
                                    type="number"
                                    step="1"
                                    className="form-input text-end fw-bold"
                                    style={{ height: '28px', padding: '2px 6px', fontSize: '0.8rem', margin: 0, width: '100%', borderColor: '#cbd5e1' }}
                                    value={item.neto}
                                    onChange={(e) => handleDesgloseNetoChange(item.id, e.target.value)}
                                    onKeyDown={handleNumericKeyDown}
                                    placeholder="0.00"
                                  />
                                  <button
                                    type="button"
                                    className="btn-new-task"
                                    style={{ height: '28px', padding: '0 8px', margin: 0, backgroundColor: '#f5f3ff', color: '#8b5cf6', border: '1px solid #ddd6fe' }}
                                    onClick={() => handleOpenCalculator(item.id, item.neto)}
                                  >
                                    <i className="bi bi-plus"></i>
                                  </button>
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>
                              ${isSingleConcept ? consolidatedIva.toFixed(2) : item.iva.toFixed(2)}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>
                              ${isSingleConcept ? consolidatedSubtotal.toFixed(2) : item.subtotal.toFixed(2)}
                            </td>
                            <td style={{ padding: '4px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveConceptFromDesglose(item.id)}
                                  style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                                  title="Eliminar concepto"
                                >
                                  <i className="bi bi-trash-fill" style={{ fontSize: '0.9rem' }}></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: '#f1f5f9', fontWeight: 'bold', borderTop: '2px solid #cbd5e1', color: '#1e293b' }}>
                        <td style={{ padding: '8px' }}>Total Desglose</td>
                        <td style={{ padding: '8px' }}></td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          ${desgloseConceptos.length === 1 ? (
                            ((parseFloat(montoNeto) || 0) + (parseFloat(montoNeto105) || 0) + (parseFloat(montoNeto27) || 0) + (parseFloat(montoExento) || 0)).toFixed(2)
                          ) : (
                            desgloseConceptos.reduce((sum, item) => sum + (parseFloat(item.neto) || 0), 0).toFixed(2)
                          )}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          ${desgloseConceptos.length === 1 ? (
                            ((parseFloat(iva21) || 0) + (parseFloat(iva105) || 0) + (parseFloat(iva27) || 0)).toFixed(2)
                          ) : (
                            desgloseConceptos.reduce((sum, item) => sum + item.iva, 0).toFixed(2)
                          )}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', color: '#1e293b' }}>
                          ${desgloseConceptos.length === 1 ? (
                            (
                              ((parseFloat(montoNeto) || 0) + (parseFloat(montoNeto105) || 0) + (parseFloat(montoNeto27) || 0) + (parseFloat(montoExento) || 0)) +
                              ((parseFloat(iva21) || 0) + (parseFloat(iva105) || 0) + (parseFloat(iva27) || 0))
                            ).toFixed(2)
                          ) : (
                            desgloseConceptos.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)
                          )}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>

            {/* Row: Medio de Pago & Factura */}
            <div style={{ display: 'flex', gap: '15px' }}>
              {/* Medio de Pago */}
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold">MEDIO DE PAGO</label>
                <select 
                  className="form-select" 
                  value={pago}
                  onChange={(e) => setPago(e.target.value)}
                  required
                >
                  <option value="" disabled>Seleccionar...</option>
                  <option value="Caja">Caja (Efectivo del Turno)</option>
                  <option value="Rendición" disabled={!rendConfig.allow_compras || (modules && !modules.rendiciones)}>
                    {rendConfig.caja_nombre} (Caja Fuerte)
                  </option>
                  {uniquePayments.filter(p => !p.toLowerCase().includes("caja") && !p.toLowerCase().includes("rendic")).map((pName, idx) => (
                    <option key={idx} value={pName}>{pName}</option>
                  ))}
                </select>
              </div>

              {/* Estado Factura */}
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    ESTADO FACTURA
                    <span className="tooltip-container">
                      <i className="bi bi-info-circle help-icon"></i>
                      <span className="tooltip-text">
                        Define si la factura ya fue recibida física/digitalmente o si está pendiente de entrega por el proveedor.
                      </span>
                    </span>
                  </div>
                  {factura === 'Pendiente' && proveedor && (
                    <button
                      type="button"
                      onClick={() => {
                        const provData = proveedoresMap[proveedor];
                        const phone = provData?.celular_administracion;
                        if (!phone) {
                          alert("Este proveedor no tiene celular de administración configurado.");
                          return;
                        }
                        
                        const template = localStorage.getItem('compras_wa_reclaim_template') || 'Hola, te reclamo la factura pendiente del proveedor *{proveedor}* (Factura: {nro_factura}) por la compra de fecha *{fecha}* por un total de *${monto}*. Gracias.';
                        
                        const msg = template
                          .replace(/{proveedor}/g, proveedor)
                          .replace(/{nro_factura}/g, nroFactura || 'S/N')
                          .replace(/{monto}/g, total)
                          .replace(/{fecha}/g, new Date(fecha || Date.now()).toLocaleDateString());

                        window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                      }}
                      style={{ 
                        backgroundColor: '#25D366', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '4px', 
                        padding: '2px 8px', 
                        fontSize: '0.7rem', 
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <i className="bi bi-whatsapp"></i> Reclamar
                    </button>
                  )}
                </label>
                <select 
                  className="form-select" 
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  required
                >
                  <option value="Factura A">Factura A</option>
                  <option value="Factura B">Factura B</option>
                  <option value="Factura C">Factura C</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Sin factura">Sin factura</option>
                </select>
              </div>
            </div>

            {/* Turno Asignado (conditional) */}
            {pago === 'Caja' && (
              <div className="form-group" style={{ margin: 0, border: '1px solid #fca5a5', padding: '10px', borderRadius: '8px', backgroundColor: '#fef2f2' }}>
                <label className="form-label fw-bold text-danger">ASIGNAR A CAJA DE:</label>
                <select 
                  className="form-select fw-bold" 
                  value={turnoAsignado}
                  onChange={(e) => setTurnoAsignado(e.target.value)}
                  required
                >
                  {cierreTurnos.map((tName, idx) => {
                    const isClosed = closedTurnos.includes(tName);
                    return (
                      <option key={idx} value={tName} disabled={isClosed}>
                        {tName} {isClosed ? '(Cerrado)' : ''}
                      </option>
                    );
                  })}
                </select>
                {isCurrentTurnoClosed && (
                  <span style={{ color: '#ef4444', fontWeight: 'bold', display: 'block', marginTop: '6px', fontSize: '0.8rem' }}>
                    ⚠️ Esta caja/turno ya se encuentra cerrada para la fecha seleccionada.
                  </span>
                )}
                <span className="small text-muted" style={{ display: 'block', marginTop: '4px', fontSize: '0.75rem' }}>
                  Este egreso se descontará en la planilla de este turno.
                </span>
              </div>
            )}

            {(parseFloat(percepIibb) || 0) > 0 && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold text-warning">JURISDICCIÓN IIBB (PROVINCIA)</label>
                <select
                  className="form-select fw-bold"
                  value={iibbJurisdiccion}
                  onChange={(e) => setIibbJurisdiccion(e.target.value)}
                  required
                  style={{ borderColor: '#fef08a', backgroundColor: '#fefce8' }}
                >
                  <option value="">Seleccionar Provincia...</option>
                  <option value="Neuquén">Neuquén</option>
                  <option value="Río Negro">Río Negro</option>
                  <option value="CABA">CABA (AGIP)</option>
                  <option value="Buenos Aires">Buenos Aires (ARBA)</option>
                  <option value="Córdoba">Córdoba</option>
                  <option value="Mendoza">Mendoza</option>
                  <option value="Santa Fe">Santa Fe</option>
                  <option value="Chubut">Chubut</option>
                  <option value="La Pampa">La Pampa</option>
                </select>
              </div>
            )}
             {/* Monto Neto y Total Comprobante (Fijo) */}
             <div className="form-group" style={{ margin: '15px 0 0 0', border: '1px solid #cbd5e1', padding: '12px', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
               <div style={{ display: 'flex', gap: '15px' }}>
                 <div style={{ flex: 1 }}>
                   <label className="form-label fw-bold text-dark" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                     <i className="bi bi-lock-fill" style={{ color: '#8b5cf6' }}></i> NETO FIJO ($)
                   </label>
                   <div style={{ display: 'flex', gap: '4px' }}>
                    <input 
                      ref={montoNetoInputRef}
                      type="number" 
                      className="form-input fw-bold text-end" 
                      style={{ fontSize: '1rem', color: '#1e293b', borderColor: '#cbd5e1', flex: 1 }}
                      placeholder="Neto..."
                      value={montoNetoComprobante}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLastUpdatedField('neto');
                        setMontoNetoComprobante(val);
                        if (!val || parseFloat(val) === 0) {
                          setMontoNetoComprobante('');
                          setMontoNeto('');
                          setIva21('');
                          setMontoNeto105('');
                          setIva105('');
                          setMontoNeto27('');
                          setIva27('');
                          setMontoExento('');
                          setTotal('0.00');
                        } else {
                          const net = parseFloat(val) || 0;
                          const rate = getDefaultIvaRate();
                          const calculatedTotal = net * (1 + rate / 100);
                          setMontoTotalComprobante(calculatedTotal.toFixed(2));
                        }
                      }}
                      step="1"
                      onKeyDown={handleNumericKeyDown}
                    />
                    <button
                      type="button"
                      className="btn-new-task"
                      style={{ height: '42px', padding: '0 12px', margin: 0, backgroundColor: '#f5f3ff', color: '#8b5cf6', border: '1px solid #ddd6fe' }}
                      onClick={() => handleOpenCalculator('main_neto', montoNetoComprobante)}
                    >
                      <i className="bi bi-plus-lg"></i>
                    </button>
                   </div>
                 </div>
                 <div style={{ flex: 1 }}>
                   <label className="form-label fw-bold text-dark" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                     <i className="bi bi-lock-fill" style={{ color: '#ef4444' }}></i> TOTAL FIJO ($)
                   </label>
                   <input 
                     type="number" 
                     className="form-input fw-bold text-end" 
                     style={{ fontSize: '1rem', color: '#1e293b', borderColor: '#cbd5e1' }}
                     placeholder="Total..."
                     value={montoTotalComprobante}
                     onChange={(e) => {
                       const val = e.target.value;
                       setLastUpdatedField('total');
                       setMontoTotalComprobante(val);
                       if (!val || parseFloat(val) === 0) {
                         setMontoNetoComprobante('');
                         setMontoNeto('');
                         setIva21('');
                         setMontoNeto105('');
                         setIva105('');
                         setMontoNeto27('');
                         setIva27('');
                         setMontoExento('');
                         setTotal('0.00');
                       } else {
                         const tot = parseFloat(val) || 0;
                         const rate = getDefaultIvaRate();
                         const calculatedNet = tot / (1 + rate / 100);
                         setMontoNetoComprobante(calculatedNet.toFixed(2));
                       }
                     }}
                     step="1"
                     onKeyDown={handleNumericKeyDown}
                   />
                 </div>
               </div>
               <span className="small text-muted" style={{ display: 'block', marginTop: '6px', fontSize: '0.72rem' }}>
                 Ingresa cualquiera de los dos importes fijos y el sistema calculará el recíproco y el desglose de IVA de forma automática.
               </span>
              {(() => {
                const fixedNet = parseFloat(montoNetoComprobante) || 0;
                const calcNet = (parseFloat(montoNeto) || 0) + (parseFloat(montoNeto105) || 0) + (parseFloat(montoNeto27) || 0) + (parseFloat(montoExento) || 0);
                const diffVal = Math.abs(fixedNet - calcNet);
                if (fixedNet > 0 && diffVal > 0.01) {
                  const diffAmount = fixedNet - calcNet;
                  return (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px 12px',
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fef3c7',
                      borderRadius: '6px',
                      color: '#b45309',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <i className="bi bi-exclamation-triangle-fill" style={{ color: '#d97706' }}></i>
                      <span>
                        Diferencia con el neto calculado: <strong>${diffAmount.toFixed(2)}</strong> {diffAmount > 0 ? '(faltan cargar conceptos)' : '(exceso en desglose)'}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          {/* COLUMN RIGHT: Values, Taxes & Total */}
          <div style={{ flex: '1 1 400px', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
            <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #cbd5e1', paddingBottom: '6px', color: '#1e293b', fontSize: '0.95rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <i className="bi bi-calculator-fill text-danger"></i> Desglose de Valores e Impuestos
            </h4>

            {/* IVA 21% */}
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>NETO GRAVADO 21% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={montoNeto}
                  onChange={(e) => handleMontoNetoChange(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>IVA LIQUIDADO 21% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={iva21}
                  onChange={(e) => setIva21(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
            </div>

            {/* IVA 10.5% */}
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>NETO GRAVADO 10.5% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={montoNeto105}
                  onChange={(e) => handleMontoNeto105Change(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>IVA LIQUIDADO 10.5% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={iva105}
                  onChange={(e) => setIva105(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
            </div>

            {/* IVA 27% */}
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>NETO GRAVADO 27% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={montoNeto27}
                  onChange={(e) => handleMontoNeto27Change(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>IVA LIQUIDADO 27% ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={iva27}
                  onChange={(e) => setIva27(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
            </div>

            {/* Exento & No Gravado */}
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>MONTO EXENTO ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={montoExento}
                  onChange={(e) => setMontoExento(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  disabled={desgloseConceptos.length > 1}
                  style={{ backgroundColor: desgloseConceptos.length > 1 ? '#f1f5f9' : 'white' }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>MONTO NO GRAVADO ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={montoNoGravado}
                  onChange={(e) => setMontoNoGravado(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
            </div>

            {/* Percepciones: IVA, IIBB & Ganancias */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.75rem' }}>PERCEP. IVA ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={percepIva}
                  onChange={(e) => setPercepIva(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.75rem' }}>PERCEP. IIBB ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={percepIibb}
                  onChange={(e) => setPercepIibb(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.75rem' }}>PERCEP. GANAN. ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={percepGanancias}
                  onChange={(e) => setPercepGanancias(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
            </div>

            {/* Internos & Tasas */}
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>IMPUESTOS INTERNOS ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={impuestosInternos}
                  onChange={(e) => setImpuestosInternos(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label fw-bold" style={{ fontSize: '0.8rem' }}>TASAS / OTROS TRIB. ($)</label>
                <input 
                  type="number" 
                  className="form-input text-end" 
                  step="1"
                  value={tasasMunicipales}
                  onChange={(e) => setTasasMunicipales(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                />
              </div>
            </div>

            {/* Total Final */}
            <div className="form-group" style={{ margin: '10px 0 0 0', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '8px', border: '1px solid #fca5a5' }}>
              <label className="form-label fw-bold text-danger" style={{ fontSize: '0.9rem', marginBottom: '6px', display: 'block' }}>TOTAL FINAL FACTURA ($)</label>
              <input 
                type="number" 
                className="form-input text-end fw-bold text-danger" 
                style={{ backgroundColor: '#fff', fontSize: '1.25rem', height: '42px' }}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                step="1"
                onKeyDown={handleNumericKeyDown}
                required
              />
            </div>
          </div>
        </div>

        {/* Checkbox: No computar como compra */}
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff7ed', borderRadius: '12px', border: '1px solid #ffedd5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input 
            type="checkbox" 
            id="noComputar"
            style={{ width: '22px', height: '22px', cursor: 'pointer' }}
            checked={noComputarCompra}
            onChange={(e) => setNoComputarCompra(e.target.checked)}
          />
          <label htmlFor="noComputar" style={{ margin: 0, cursor: 'pointer', fontWeight: 'bold', color: '#9a3412', fontSize: '0.95rem', display: 'flex', alignItems: 'center' }}>
            No computar como compra
            <span className="tooltip-container">
              <i className="bi bi-info-circle help-icon" style={{ color: '#c2410c' }}></i>
              <span className="tooltip-text" style={{ backgroundColor: '#9a3412', borderColor: 'rgba(255,255,255,0.2)' }}>
                Esta compra se registrará para IVA, pero no se restará de la utilidad/ganancia del negocio (ej: gastos personales).
              </span>
            </span>
          </label>
        </div>

        {/* Submit Actions */}
        <div style={{ marginTop: '15px' }}>
          {saveStatus === 'success' && (
            <div className="alert-box-success" style={{ marginBottom: '15px' }}>
              <i className="bi bi-check-circle-fill"></i>
              <div>Gasto registrado y guardado con éxito.</div>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="alert-box" style={{ marginBottom: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
              <i className="bi bi-exclamation-circle-fill"></i>
              <div>Error al guardar: {saveError}</div>
            </div>
          )}

          <button 
            type="submit" 
            className="btn-submit" 
            style={{ backgroundColor: '#ef4444', color: 'white', padding: '14px', fontSize: '1.05rem', fontWeight: 'bold' }}
            disabled={saveStatus === 'saving' || (pago === 'Caja' && isCurrentTurnoClosed)}
          >
            {saveStatus === 'saving' ? 'Guardando Gasto...' : 'REGISTRAR GASTO / COMPRA'}
          </button>
        </div>
      </form>

      {/* Query buttons & Today list */}
      <div style={{ marginTop: '40px', paddingTop: '20px', borderTop: '2px solid var(--border-color)' }}>
        
        {/* Modals Action Buttons */}
        <div style={{ display: 'flex', gap: '15px', marginBottom: '25px', flexWrap: 'wrap' }}>
          <button 
            type="button" 
            className="btn-new-task" 
            style={{ backgroundColor: '#475569', color: 'white', flex: '1 1 100%' }}
            onClick={() => setShowHistorialModal(true)}
          >
            <i className="bi bi-clock-history me-2"></i> Historial de Compras
          </button>
        </div>

        {/* Today's Purchases */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, fontWeight: '700' }}>
              Compras del día de hoy
            </h4>
            <span className="badge" style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '0.85rem' }}>
              {comprasHoy.length}
            </span>
          </div>

          <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {comprasHoy.length === 0 ? (
              <div style={{ padding: '25px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No hay compras registradas en el día de hoy.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', minWidth: '700px', fontSize: '0.8rem', borderCollapse: 'collapse', margin: 0 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left', backgroundColor: '#e2e8f0', color: '#1e293b' }}>
                      <th 
                        style={{ padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleTodayHeaderClick('proveedor')}
                      >
                        Proveedor / Alias {todaySortByField === 'proveedor' ? (todaySortAscending ? ' ▴' : ' ▾') : ''}
                      </th>
                      <th 
                        style={{ padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleTodayHeaderClick('tipo')}
                      >
                        Tipo {todaySortByField === 'tipo' ? (todaySortAscending ? ' ▴' : ' ▾') : ''}
                      </th>
                      <th style={{ padding: '10px 12px' }}>Conceptos [Neto]</th>
                      <th 
                        style={{ padding: '10px 12px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleTodayHeaderClick('total')}
                      >
                        Total {todaySortByField === 'total' ? (todaySortAscending ? ' ▴' : ' ▾') : ''}
                      </th>
                      <th 
                        style={{ padding: '10px 12px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleTodayHeaderClick('pago')}
                      >
                        Medio de Pago {todaySortByField === 'pago' ? (todaySortAscending ? ' ▴' : ' ▾') : ''}
                      </th>
                      <th 
                        style={{ padding: '10px 12px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleTodayHeaderClick('factura')}
                      >
                        Factura {todaySortByField === 'factura' ? (todaySortAscending ? ' ▴' : ' ▾') : ''}
                      </th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', width: '50px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedTodayCompras().map((comp) => {
                      let displayPago = comp.pago;
                      if (comp.pago === 'Rendición') {
                        displayPago = rendConfig.caja_nombre;
                      } else if (comp.pago.includes("Caja ")) {
                        const pParts = comp.pago.split(" ");
                        displayPago = `Caja (${pParts[pParts.length - 1]})`;
                      }
                      const payIcon = getPaymentIcon(comp.pago);
                      const isPendiente = comp.factura === 'Pendiente';

                      return (
                        <tr key={comp.id} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: 'white', verticalAlign: 'middle' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="fw-bold text-dark">{comp.proveedor}</span>
                              {(comp.alias || (proveedoresMap && proveedoresMap[comp.proveedor]?.alias)) && (
                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                  ({comp.alias || proveedoresMap[comp.proveedor]?.alias})
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: '500', color: '#475569' }}>
                            {comp.tipo}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            {renderConceptosNeto(comp)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 'bold', color: '#b91c1c' }}>
                            {formatMoney(comp.total)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span 
                              style={{ 
                                fontSize: '0.75rem', 
                                backgroundColor: '#f1f5f9', 
                                color: '#475569', 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px',
                                border: '1px solid #cbd5e1'
                              }}
                              title={comp.pago}
                            >
                              <i className={`bi ${payIcon}`}></i>
                              {displayPago}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            {isPendiente ? (
                              <button
                                type="button"
                                className="btn-new-task"
                                style={{ 
                                  backgroundColor: '#fee2e2', 
                                  color: '#991b1b', 
                                  padding: '3px 8px', 
                                  fontSize: '0.75rem', 
                                  border: '1px solid #fca5a5',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                  borderRadius: '4px',
                                  margin: 0,
                                  lineHeight: '1.2'
                                }}
                                onClick={() => {
                                  if (window.confirm(`¿Deseas marcar la factura de ${comp.proveedor} por ${formatMoney(comp.total)} como RECIBIDA?`)) {
                                    handleMarkAsEntregada(comp.id);
                                  }
                                }}
                              >
                                <i className="bi bi-exclamation-circle-fill me-1"></i> Pendiente
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.75rem', backgroundColor: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '4px', border: '1px solid #bbf7d0', fontWeight: 'bold' }}>
                                {comp.factura || 'Recibida'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <button 
                              className="btn-nav-back" 
                              style={{ padding: '6px 8px', border: 'none', color: '#ef4444' }}
                              onClick={() => handleDeleteCompra(comp.id)}
                              title="Borrar registro"
                            >
                              <i className="bi bi-trash-fill"></i>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
      )}

      {viewMode === 'suppliers' && (
        <div>
          {/* Header & Add Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Buscar por nombre, CUIT, alias..." 
                style={{ maxWidth: '280px', fontSize: '0.9rem', margin: 0 }}
                value={provSearchQuery}
                onChange={(e) => setProvSearchQuery(e.target.value)}
              />
              {provSearchQuery && (
                <button 
                  type="button" 
                  className="btn-nav-back"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setProvSearchQuery('')}
                >
                  Limpiar
                </button>
              )}
            </div>
            <button 
              type="button" 
              className="btn-new-task" 
              style={{ backgroundColor: '#ef4444', color: '#ffffff' }}
              onClick={() => {
                setEditingProveedorOriginalName(null);
                setNewProvNombre('');
                setNewProvAlias('');
                setNewProvCuit('');
                setNewProvTipo('Mercadería');
                setNewProvDetalle('');
                setNewProvPago('Caja');
                setNewProvFactura('Sin factura');
                setNewProvCelRepartidor('');
                setNewProvCelAdmin('');
                setShowNuevoProveedorModal(true);
              }}
            >
              <i className="bi bi-person-plus-fill me-1"></i> Nuevo Proveedor
            </button>
          </div>

          {/* Suppliers List Table */}
          <div className="table-responsive">
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('nombre')}>
                    Proveedor / Razón Social {provSortField === 'nombre' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('alias')}>
                    Alias {provSortField === 'alias' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('cuit')}>
                    CUIT {provSortField === 'cuit' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('tipo')}>
                    Categoría {provSortField === 'tipo' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('detalle')}>
                    Detalle {provSortField === 'detalle' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('pago')}>
                    Medio Pago {provSortField === 'pago' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortProveedores('factura')}>
                    Factura {provSortField === 'factura' && (provSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliersList.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No se encontraron proveedores.
                    </td>
                  </tr>
                ) : (
                  filteredSuppliersList.map((p, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '12px 8px', fontSize: '0.9rem', fontWeight: '600', color: '#1e293b' }}>{p.nombre}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{p.alias || '-'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{formatCuit(p.cuit) || '-'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{p.tipo}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{p.detalle || '-'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{p.pago}</td>
                      <td style={{ padding: '12px 8px', fontSize: '0.85rem', color: '#475569' }}>{p.factura}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="btn-nav-back"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', border: '1px solid #cbd5e1' }}
                            onClick={() => {
                              setEditingProveedorOriginalName(p.nombre);
                              setNewProvNombre(p.nombre);
                              setNewProvAlias(p.alias || '');
                              setNewProvCuit(formatCuit(p.cuit || ''));
                              const normalizedTipo = normalizeCategoryName(p.tipo);
                              setNewProvTipo(
                                providerCategorias.some((c) => c.name === normalizedTipo)
                                  ? normalizedTipo
                                  : 'Mercadería'
                              );
                              setNewProvDetalle(p.detalle || '');
                              setNewProvPago(p.pago || 'Caja');
                              setNewProvFactura(p.factura || 'Sin factura');
                              setNewProvCelRepartidor(p.celular_repartidor || '');
                              setNewProvCelAdmin(p.celular_administracion || '');
                              setShowNuevoProveedorModal(true);
                            }}
                          >
                            <i className="bi bi-pencil-fill"></i> Editar
                          </button>
                          <button
                            type="button"
                            className="btn-nav-back"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', border: '1px solid #fee2e2', color: '#ef4444' }}
                            onClick={() => handleDeleteProveedor(p.nombre)}
                          >
                            <i className="bi bi-trash-fill"></i> Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: HISTORIAL COMPLETO */}
      {showHistorialModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1050
        }}>
          <div className="page-card" style={{
            width: '95%', maxWidth: '850px', maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', padding: '25px', boxShadow: 'var(--shadow-lg)'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '15px', marginBottom: '15px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <i className="bi bi-clock-history text-secondary"></i> Historial de Compras
              </h3>
              <button 
                type="button" 
                className="btn-close" 
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer' }}
                onClick={() => setShowHistorialModal(false)}
              >
                &times;
              </button>
            </div>

            {/* Modal Body / Scrollable Table */}
            <div style={{ flex: 1, overflow: 'auto', paddingRight: '5px' }}>
              {getSortedHistorial().length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>No hay gastos registrados.</div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                  <table className="table" style={{ width: '100%', minWidth: '800px', fontSize: '0.8rem', borderCollapse: 'collapse', margin: 0 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left', backgroundColor: '#e2e8f0', color: '#1e293b' }}>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleHeaderClick('fecha')}>
                          Fecha {sortByField === 'fecha' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleHeaderClick('proveedor')}>
                          Proveedor / Alias {sortByField === 'proveedor' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleHeaderClick('tipo')}>
                          Tipo {sortByField === 'tipo' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px' }}>
                          Conceptos [Neto]
                        </th>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => handleHeaderClick('total')}>
                          Monto Final {sortByField === 'total' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none', textAlign: 'center' }} onClick={() => handleHeaderClick('pago')}>
                          Pagado (Forma) {sortByField === 'pago' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px', cursor: 'pointer', userSelect: 'none', textAlign: 'center' }} onClick={() => handleHeaderClick('factura')}>
                          Factura {sortByField === 'factura' ? (sortAscending ? ' ▴' : ' ▾') : ''}
                        </th>
                        <th style={{ padding: '10px 8px', textAlign: 'center' }}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedHistorial().map((comp) => {
                        const dateStr = new Date(comp.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                        let displayPago = comp.pago;
                        if (comp.pago === 'Rendición') {
                          displayPago = rendConfig.caja_nombre;
                        } else if (comp.pago.includes("Caja ")) {
                          const pParts = comp.pago.split(" ");
                          displayPago = `Caja (${pParts[pParts.length - 1]})`;
                        }
                        const isPendiente = comp.factura === 'Pendiente';
                        const payIcon = getPaymentIcon(comp.pago);

                        return (
                          <tr key={comp.id} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: isPendiente ? '#fff5f5' : 'white', verticalAlign: 'middle' }}>
                            <td style={{ padding: '10px 8px', fontWeight: '500', color: '#475569' }}>{dateStr}</td>
                            <td style={{ padding: '10px 8px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span className="fw-bold text-dark">{comp.proveedor}</span>
                                {(comp.alias || (proveedoresMap && proveedoresMap[comp.proveedor]?.alias)) && (
                                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    ({comp.alias || proveedoresMap[comp.proveedor]?.alias})
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '10px 8px', fontWeight: '500', color: '#475569' }}>
                              {comp.tipo}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#334155' }}>
                              {renderConceptosNeto(comp)}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'bold', color: '#b91c1c' }}>
                              {formatMoney(comp.total)}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                              {(() => {
                                let bgColor = '#f1f5f9';
                                let textColor = '#475569';
                                let borderColor = '#cbd5e1';
                                
                                if (comp.pago === 'Rendición') {
                                  bgColor = '#dcfce7'; textColor = '#166534'; borderColor = '#bbf7d0';
                                } else if (comp.pago.includes("Caja")) {
                                  bgColor = '#dbeafe'; textColor = '#1e40af'; borderColor = '#bfdbfe';
                                } else if (comp.pago.toLowerCase().includes("corriente")) {
                                  bgColor = '#fef3c7'; textColor = '#92400e'; borderColor = '#fde68a';
                                } else if (comp.pago.toLowerCase().includes("tarjeta")) {
                                  bgColor = '#f5f3ff'; textColor = '#5b21b6'; borderColor = '#ddd6fe';
                                }

                                return (
                                  <span style={{ 
                                    fontSize: '0.7rem', 
                                    backgroundColor: bgColor, 
                                    color: textColor, 
                                    padding: '4px 10px', 
                                    borderRadius: '12px', 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '5px',
                                    border: `1px solid ${borderColor}`,
                                    fontWeight: 'bold',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    <i className={`bi ${payIcon}`}></i>
                                    {displayPago}
                                  </span>
                                );
                              })()}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                              <span style={{ 
                                padding: '4px 8px', 
                                borderRadius: '6px', 
                                fontSize: '0.7rem', 
                                fontWeight: 'bold',
                                backgroundColor: isPendiente ? '#fee2e2' : '#e2e8f0',
                                color: isPendiente ? '#ef4444' : '#475569',
                                border: isPendiente ? '1px solid #fecaca' : '1px solid #cbd5e1'
                               }}>
                                {comp.factura || 'Sin factura'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                              {isPendiente && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '90px', margin: '0 auto' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const provData = proveedoresMap[comp.proveedor];
                                      const phone = provData?.celular_administracion || comp.celular_administracion;
                                      if (!phone) {
                                        alert("Este proveedor no tiene celular de administración configurado.");
                                        return;
                                      }
                                      
                                      const template = localStorage.getItem('compras_wa_reclaim_template') || 'Hola, te reclamo la factura pendiente del proveedor *{proveedor}* (Factura: {nro_factura}) por la compra de fecha *{fecha}* por un total de *${monto}*. Gracias.';
                                      
                                      const msg = template
                                        .replace(/{proveedor}/g, comp.proveedor)
                                        .replace(/{nro_factura}/g, comp.nro_factura || 'S/N')
                                        .replace(/{monto}/g, comp.total)
                                        .replace(/{fecha}/g, new Date(comp.fecha).toLocaleDateString());

                                      window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                                    }}
                                    style={{ 
                                      backgroundColor: '#25D366', 
                                      color: 'white', 
                                      border: 'none', 
                                      borderRadius: '4px', 
                                      padding: '3px 6px', 
                                      fontSize: '0.65rem', 
                                      fontWeight: 'bold',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <i className="bi bi-whatsapp"></i> Reclamar
                                  </button>
                                  
                                  <button
                                    type="button"
                                    style={{ 
                                      backgroundColor: '#ef4444', 
                                      color: 'white', 
                                      padding: '3px 6px', 
                                      fontSize: '0.65rem', 
                                      border: 'none',
                                      cursor: 'pointer',
                                      fontWeight: 'bold',
                                      borderRadius: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      justifyContent: 'center'
                                    }}
                                    onClick={() => {
                                      if (window.confirm(`¿Deseas marcar la factura de ${comp.proveedor} como RECIBIDA?`)) {
                                        handleMarkAsEntregada(comp.id, comp.proveedor);
                                      }
                                    }}
                                  >
                                    <i className="bi bi-check-circle"></i> Recibir
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: '15px', marginTop: '15px', textAlign: 'right' }}>
              <button 
                type="button" 
                className="btn-new-task" 
                style={{ backgroundColor: '#475569', color: 'white', padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={() => setShowHistorialModal(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL 3: NUEVO PROVEEDOR CON VALORES POR DEFECTO */}
      {showNuevoProveedorModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1050
        }}>
          <div className="page-card" style={{
            width: '90%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', padding: '25px', boxShadow: 'var(--shadow-lg)'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '15px', marginBottom: '15px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, color: '#8b5cf6' }}>
                <i className={editingProveedorOriginalName ? "bi bi-pencil-square" : "bi bi-person-plus-fill"}></i> {editingProveedorOriginalName ? 'Editar Proveedor' : 'Registrar Proveedor'}
              </h3>
              <button 
                type="button" 
                className="btn-close" 
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer' }}
                onClick={closeProveedorModal}
              >
                &times;
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleCreateProveedor} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">PROVEEDOR / RAZÓN SOCIAL</label>
                <input 
                  type="text" 
                  className="form-input fw-bold" 
                  placeholder="Ej: Distribuidora Sol"
                  value={newProvNombre}
                  onChange={(e) => setNewProvNombre(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">ALIAS</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: Sol Dist"
                  value={newProvAlias}
                  onChange={(e) => setNewProvAlias(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CUIT</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: 20-12345678-9"
                  value={formatCuit(newProvCuit)}
                  onChange={(e) => setNewProvCuit(e.target.value.replace(/\D/g, '').substring(0, 11))}
                  maxLength={13}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CELULAR REPARTIDOR</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: 5493416123456"
                  value={newProvCelRepartidor}
                  onChange={(e) => setNewProvCelRepartidor(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CELULAR ADMINISTRACIÓN</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: 5493416123456"
                  value={newProvCelAdmin}
                  onChange={(e) => setNewProvCelAdmin(e.target.value)}
                />
              </div>

              <div style={{ borderTop: '1px dashed #cbd5e1', margin: '5px 0' }}></div>
              <span className="small text-muted fw-bold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>VALORES POR DEFECTO PARA COMPRAS</span>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CATEGORÍA / TIPO</label>
                <select 
                  className="form-select" 
                  value={newProvTipo}
                  onChange={(e) => setNewProvTipo(e.target.value)}
                  required
                >
                  {providerCategorias.map((cat, idx) => (
                    <option key={idx} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">DETALLE / CONCEPTO</label>
                <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      style={{ width: '100%' }}
                      placeholder="Ej: Insumos varios"
                      value={newProvDetalle}
                      onChange={(e) => {
                        setNewProvDetalle(e.target.value);
                        setShowNewProvDetalleSuggestions(true);
                      }}
                      onFocus={() => setShowNewProvDetalleSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowNewProvDetalleSuggestions(false), 200)}
                      autoComplete="off"
                    />
                    {showNewProvDetalleSuggestions && (
                      (() => {
                        const catConceptos = getConceptosForCategory(newProvTipo);
                        const search = newProvDetalle.toLowerCase();
                        
                        const allSuggested = catConceptos
                          .map((d) => d.label || d)
                          .filter((label) => label.toLowerCase().includes(search))
                          .slice(0, 8);

                        if (allSuggested.length === 0) return null;

                        return (
                          <ul className="suggestions-list" style={{ zIndex: 1100, position: 'absolute', width: '100%', top: '100%', left: 0, paddingLeft: 0, margin: 0, listStyle: 'none' }}>
                            {allSuggested.map((detText, idx) => (
                              <li 
                                key={idx} 
                                className="suggestion-item text-start"
                                style={{ 
                                  padding: '8px 10px', 
                                  fontSize: '0.85rem',
                                  backgroundColor: idx === 0 ? '#f5f3ff' : 'transparent',
                                  borderLeft: idx === 0 ? '3px solid #8b5cf6' : 'none',
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  setNewProvDetalle(detText);
                                  setShowNewProvDetalleSuggestions(false);
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <strong>{detText}</strong>
                                  <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', backgroundColor: '#e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                                    {newProvTipo}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        );
                      })()
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-new-task"
                    style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '0 12px', fontSize: '0.85rem', height: '38px', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => {
                      setNewConceptNombre(newProvDetalle);
                      setNewConceptIva('21');
                      setConceptTargetField('modal');
                      setShowNuevoConceptoModal(true);
                    }}
                    title="Nuevo Concepto"
                  >
                    <i className="bi bi-plus-lg"></i> + Nuevo
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">MEDIO DE PAGO HABITUAL</label>
                <select 
                  className="form-select" 
                  value={newProvPago}
                  onChange={(e) => setNewProvPago(e.target.value)}
                  required
                >
                  <option value="Caja">Caja (Efectivo del Turno)</option>
                  <option value="Rendición" disabled={!rendConfig.allow_compras || (modules && !modules.rendiciones)}>
                    {rendConfig.caja_nombre} (Caja Fuerte)
                  </option>
                  {uniquePayments.filter(p => !p.toLowerCase().includes("caja") && !p.toLowerCase().includes("rendic")).map((pName, idx) => (
                    <option key={idx} value={pName}>{pName}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">FACTURA HABITUAL</label>
                <select 
                  className="form-select" 
                  value={newProvFactura}
                  onChange={(e) => setNewProvFactura(e.target.value)}
                  required
                >
                  <option value="Factura A">Factura A</option>
                  <option value="Factura B">Factura B</option>
                  <option value="Factura C">Factura C</option>
                  <option value="Sin factura">Sin factura</option>
                </select>
              </div>

              {/* Modal Footer / Actions */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #cbd5e1', paddingTop: '15px', marginTop: '10px' }}>
                <button 
                  type="button" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#475569', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                  onClick={closeProveedorModal}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                >
                  {editingProveedorOriginalName ? 'Guardar Cambios' : 'Guardar Proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nuevo Concepto / Detalle */}
      {showNuevoConceptoModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '90%',
            maxWidth: '450px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.15rem', fontWeight: 'bold' }}>
                <i className="bi bi-tag-fill text-primary" style={{ color: '#8b5cf6' }}></i> Nuevo Concepto / Detalle
              </h3>
              <button 
                type="button" 
                className="btn-close" 
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}
                onClick={() => setShowNuevoConceptoModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateConcepto} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CATEGORÍA</label>
                <select 
                  className="form-select" 
                  value={tempCategory}
                  onChange={(e) => setTempCategory(e.target.value)}
                  required
                >
                  {comprasCategorias.map((cat, idx) => (
                    <option key={idx} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">DESCRIPCIÓN / NOMBRE</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: Repuestos de auto, Papelería, etc."
                  value={newConceptNombre}
                  onChange={(e) => setNewConceptNombre(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">IVA PREDETERMINADO</label>
                <select 
                  className="form-select" 
                  value={newConceptIva}
                  onChange={(e) => setNewConceptIva(e.target.value)}
                  required
                >
                  <option value="21">21%</option>
                  <option value="10.5">10.5%</option>
                  <option value="27">27%</option>
                  <option value="0">0% (Exento / No Gravado)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '15px', marginTop: '10px' }}>
                <button 
                  type="button" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#475569', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                  onClick={() => setShowNuevoConceptoModal(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                >
                  Guardar Concepto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Agregar Concepto al Desglose */}
      {showAddConceptModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '90%',
            maxWidth: '450px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.15rem', fontWeight: 'bold' }}>
                <i className="bi bi-plus-circle-fill text-primary" style={{ color: '#8b5cf6' }}></i> Agregar Concepto al Desglose
              </h3>
              <button 
                type="button" 
                className="btn-close" 
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}
                onClick={() => setShowAddConceptModal(false)}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">CATEGORÍA</label>
                <select 
                  className="form-select" 
                  value={tempCategory}
                  onChange={(e) => {
                    setTempCategory(e.target.value);
                    setSelectedConceptToAdd('');
                  }}
                >
                  {comprasCategorias.map((cat, idx) => (
                    <option key={idx} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label fw-bold">SELECCIONAR CONCEPTO</label>
                <select 
                  className="form-select" 
                  value={selectedConceptToAdd}
                  onChange={(e) => {
                    setSelectedConceptToAdd(e.target.value);
                    const q = document.getElementById('quick-no-considerar');
                    if (q) q.checked = false;
                  }}
                >
                  <option value="">-- Seleccionar concepto --</option>
                  {(() => {
                    const listToMap = getConceptosForCategory(tempCategory);
                      
                    return listToMap.map((d, idx) => {
                      const labelText = d.label || d;
                      const ivaVal = d.iva !== undefined ? d.iva : 21;
                      return <option key={d.id || idx} value={labelText}>{labelText} (IVA {ivaVal}%)</option>;
                    });
                  })()}
                </select>
              </div>

              {/* Quick Add: No Considerar */}
              <div style={{ 
                padding: '12px', 
                backgroundColor: '#f8fafc', 
                borderRadius: '10px', 
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  Accesos Rápidos
                  <span className="tooltip-container">
                    <i className="bi bi-info-circle help-icon" style={{ fontSize: '0.8rem' }}></i>
                    <span className="tooltip-text" style={{ width: '220px' }}>
                      Se utiliza cuando una parte de la compra no debe ser tenida en cuenta para la utilidad o ganancia del negocio (ej. gastos personales mezclados).
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="checkbox" 
                      id="quick-no-considerar"
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedConceptToAdd('No considerar');
                        } else {
                          setSelectedConceptToAdd('');
                        }
                      }}
                    />
                    <label htmlFor="quick-no-considerar" style={{ fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>No considerar</label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>IVA:</span>
                    <select 
                      id="quick-iva-select"
                      className="form-select" 
                      style={{ width: '85px', height: '28px', fontSize: '0.75rem', padding: '0 5px' }} 
                      defaultValue="21"
                    >
                      <option value="21">21%</option>
                      <option value="10.5">10.5%</option>
                      <option value="27">27%</option>
                      <option value="0">0%</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '15px', marginTop: '10px' }}>
                <button 
                  type="button" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                  onClick={() => {
                    setNewConceptNombre('');
                    setNewConceptIva('21');
                    setConceptTargetField('desglose');
                    setShowNuevoConceptoModal(true);
                  }}
                >
                  + Crear Nuevo Concepto
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    type="button" 
                    className="btn-new-task" 
                    style={{ backgroundColor: '#475569', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                    onClick={() => setShowAddConceptModal(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    className="btn-new-task" 
                    style={{ backgroundColor: '#10b981', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                    onClick={() => {
                      handleAddConceptToDesglose();
                      setShowAddConceptModal(false);
                    }}
                    disabled={!selectedConceptToAdd}
                  >
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Calculadora de Suma */}
      {showCalculator && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000
        }}>
          <div style={{
            backgroundColor: '#ffffff', borderRadius: '20px', boxShadow: 'var(--shadow-lg)',
            width: '90%', maxWidth: '400px', padding: '24px', position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b' }}>
                <i className="bi bi-calculator-fill text-primary me-2" style={{ color: '#8b5cf6' }}></i>
                Calculadora de Suma
              </h3>
              <button 
                className="btn-close" 
                onClick={() => setShowCalculator(false)}
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', color: '#64748b' }}
              >
                &times;
              </button>
            </div>

            <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', padding: '15px', marginBottom: '20px', minHeight: '100px', maxHeight: '200px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {calcItems.length === 0 ? (
                  <span className="text-muted small italic">Ingrese montos para sumar...</span>
                ) : (
                  calcItems.map((val, i) => (
                    <span key={i} style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 10px', fontSize: '0.9rem', fontWeight: 'bold', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ${val.toFixed(2)}
                      <i className="bi bi-trash text-danger" style={{ cursor: 'pointer', fontSize: '0.8rem' }} onClick={() => setCalcItems(prev => prev.filter((_, idx) => idx !== i))}></i>
                    </span>
                  ))
                )}
              </div>
            </div>

            <form onSubmit={handleAddCalcItem} style={{ marginBottom: '20px' }}>
              <div className="input-group">
                <span className="input-group-text bg-white border-end-0">$</span>
                <input
                  type="number"
                  step="any"
                  className="form-control form-control-lg border-start-0 ps-1 fw-bold"
                  value={calcInput}
                  onChange={(e) => setCalcInput(e.target.value)}
                  placeholder="Monto a sumar..."
                  autoFocus
                />
                <button type="submit" className="btn btn-primary px-4">
                  <i className="bi bi-plus-lg"></i>
                </button>
              </div>
            </form>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
              <div>
                <div className="small text-muted text-uppercase fw-bold">Total a asignar</div>
                <div className="fs-3 fw-bold text-primary">
                  ${calcItems.reduce((a, b) => a + b, 0).toFixed(2)}
                </div>
              </div>
              <button 
                type="button" 
                className="btn btn-success btn-lg px-4" 
                style={{ borderRadius: '12px' }}
                onClick={handleConfirmCalculator}
              >
                Confirmar Suma
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Compras;
