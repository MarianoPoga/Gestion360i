import React, { useState, useEffect, useRef } from 'react'
import ExcelJS from 'exceljs'
import { db, isSupabaseConfigured, supabase, getBusinessId } from '../supabaseClient'
import { readArcaFromCache } from '../arcaConfig'
import { CSV_IMPORT_HELP, IMPORT_FIELDS, analyzeCsvImport, getColumnLabel, normalizeIva } from '../clientesImport'
import { getMedioIcon } from '../cierreMedios'

const cleanAddressText = (str) => {
  if (!str) return '';
  return str.replace(/\(📍\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g, '').trim();
};

const parseCoordinates = (str) => {
  if (!str) return null;
  const match = str.match(/\(📍\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/);
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2])
    };
  }
  return null;
};

const isValidGpsAddress = (str) => {
  if (!str) return false;
  if (parseCoordinates(str)) return true;
  const clean = cleanAddressText(str);
  const hasNumber = /\d+/.test(clean);
  const hasLetters = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]+/.test(clean);
  return clean.length >= 5 && hasNumber && hasLetters;
};

const getGmapsUrl = (str) => {
  if (!str) return '';
  const coords = parseCoordinates(str);
  if (coords) {
    return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
  }
  const clean = cleanAddressText(str);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
};

const DELIVERY_ITEM_ID = '__delivery_item__';
const DEFAULT_DELIVERY_FEE = 1000;

const readDeliveryFee = () => {
  const parsed = parseFloat(localStorage.getItem('delivery_fee'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELIVERY_FEE;
};

const findEnvioProduct = (products) =>
  (products || []).find((p) => {
    const name = String(p.nombre || '').trim().toLowerCase();
    return name === 'envio' || name === 'envío';
  });

const resolveDeliveryFee = (products) => {
  const envioProduct = findEnvioProduct(products);
  if (envioProduct) {
    const price = parseFloat(envioProduct.precio);
    if (Number.isFinite(price) && price >= 0) return price;
  }
  return readDeliveryFee();
};

const isDeliveryItem = (item) =>
  item?.id === DELIVERY_ITEM_ID ||
  item?.isDeliveryFee === true ||
  item?.producto === 'Envio' ||
  item?.producto === 'Envío';

const createDeliveryItem = (fee, envioProduct) => ({
  id: DELIVERY_ITEM_ID,
  producto: envioProduct?.nombre || 'Envio',
  cantidad: 1,
  valor: fee,
  observacion: '',
  iva_alicuota: envioProduct?.iva !== undefined ? parseFloat(envioProduct.iva) : 21.00,
  isDeliveryFee: true,
});

const isOrderCancelled = (order) => {
  const est = (order?.estado || '').toLowerCase().trim();
  return est === 'cancelado' || est === 'cancelada' || est === 'cancelled';
};

const hasPaymentMedio = (medio) => !!medio && String(medio).trim() !== '';

const isMedioCtaCte = (medio) => {
  const normalized = String(medio || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'cta cte'
    || normalized === 'cuenta corriente (deuda)'
    || normalized === 'cuenta corriente';
};

const normalizeOrderEstado = (order) => (order?.estado || '').toLowerCase().trim();

const getOrderShippingEstado = (order) => {
  const est = normalizeOrderEstado(order);
  // Legacy: el cobro se guardó como estado "Pagado"
  if (est === 'pagado') {
    if (!order?.con_envio) return 'Pendiente';
    return order.repartidor ? 'Entregado' : 'Pendiente';
  }
  if (est === 'cobrado') return 'Finalizado';
  return order?.estado || 'Pendiente';
};

const getOrderShippingEstadoLower = (order) => getOrderShippingEstado(order).toLowerCase();

const isOrderCtaCte = (order) => {
  if (!order || isOrderCancelled(order)) return false;
  return isMedioCtaCte(order.medio_pago);
};

const isOrderPagado = (order) => {
  if (!order || isOrderCancelled(order)) return false;
  return hasPaymentMedio(order.medio_pago) && !isMedioCtaCte(order.medio_pago);
};

const isOrderCobroPendiente = (order) => {
  if (!order || isOrderCancelled(order)) return false;
  return !hasPaymentMedio(order.medio_pago);
};

const isOrderFinalizado = (order) => {
  const est = normalizeOrderEstado(order);
  return est === 'finalizado' || est === 'cobrado';
};

const getOrderCobroEstado = (order) => {
  if (!order || isOrderCancelled(order)) return null;
  if (!hasPaymentMedio(order.medio_pago)) return 'PENDIENTE';
  if (isMedioCtaCte(order.medio_pago)) return 'CTA CTE';
  return 'PAGADO';
};

const COBRO_ESTADO_STYLES = {
  PENDIENTE: { backgroundColor: '#fee2e2', color: '#b91c1c' },
  PAGADO: { backgroundColor: '#ccfbf1', color: '#0f766e' },
  'CTA CTE': { backgroundColor: '#fef3c7', color: '#b45309' },
};

const isOrderPaid = (order) => isOrderPagado(order) || isOrderCtaCte(order) || isOrderFinalizado(order);

const canCobrarOrder = (order) => {
  if (!order || isOrderCancelled(order)) return false;
  return !isOrderFinalizado(order);
};

function Clientes({ navigate, profile, accentColor }) {
  // Navigation View Mode: 'register' (Cargar Pedidos) or 'orders' (Ver Pedidos)
  const [viewMode, setViewMode] = useState('register');

  // Database datasets
  const [clientes, setClientes] = useState([]);
  const [products, setProducts] = useState([]);

  // Client Selection states (Register View)
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  const [newClientModal, setNewClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientRazon, setNewClientRazon] = useState('');
  const [newClientCuit, setNewClientCuit] = useState('');
  const [newClientTelefono, setNewClientTelefono] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientCondicionIva, setNewClientCondicionIva] = useState('Consumidor Final');
  const [newClientError, setNewClientError] = useState('');
  const [importClientesModal, setImportClientesModal] = useState(false);
  const [importClientesStatus, setImportClientesStatus] = useState('');
  const [importClientesResult, setImportClientesResult] = useState(null);
  const [importReplaceAll, setImportReplaceAll] = useState(true);
  const [importCsvText, setImportCsvText] = useState('');
  const [importCsvHeaders, setImportCsvHeaders] = useState([]);
  const [importHasHeaderRow, setImportHasHeaderRow] = useState(true);
  const [importColumnMapping, setImportColumnMapping] = useState({});
  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importRowCount, setImportRowCount] = useState(0);
  const [importFileName, setImportFileName] = useState('');
  const csvFileInputRef = useRef(null);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSortField, setClientSortField] = useState('nombre');
  const [clientSortAsc, setClientSortAsc] = useState(true);
  const [productSortField, setProductSortField] = useState('nombre');
  const [productSortAsc, setProductSortAsc] = useState(true);
  const [editClientModal, setEditClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [editClientNombre, setEditClientNombre] = useState('');
  const [editClientRazonSocial, setEditClientRazonSocial] = useState('');
  const [editClientCuit, setEditClientCuit] = useState('');
  const [editClientCondicionIva, setEditClientCondicionIva] = useState('Consumidor Final');
  const [editClientTelefono, setEditClientTelefono] = useState('');
  const [editingClientAddresses, setEditingClientAddresses] = useState([]);
  const [newEditAddressText, setNewEditAddressText] = useState('');
  const [savingClient, setSavingClient] = useState(false);

  // Location GPS & QR States
  const [showLocationQrModal, setShowLocationQrModal] = useState(false);
  const [locationQrData, setLocationQrData] = useState(null); // { address: '', qrUrl: '' }

  // Refund states
  const [refundModal, setRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('Efectivo');
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [dailyRefunds, setDailyRefunds] = useState([]);

  // Product management states
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [newProductModal, setNewProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prodNombre, setProdNombre] = useState('');
  const [prodRubro, setProdRubro] = useState('');
  const [prodPrecio, setProdPrecio] = useState('');
  const [prodStock, setProdStock] = useState('');
  const [prodIva, setProdIva] = useState(21.00);
  const [savingProduct, setSavingProduct] = useState(false);

  const [activePaymentMethods, setActivePaymentMethods] = useState([]);

  // Movements Drawer states
  const [showDrawer, setShowDrawer] = useState(false);
  const [movements, setMovements] = useState([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  // Order creation states
  const [orderItems, setOrderItems] = useState([]);
  
  // Current Item Form
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState(0);
  const [itemObs, setItemObs] = useState('');

  // Delivery states (Register View)
  const [conEnvio, setConEnvio] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(DEFAULT_DELIVERY_FEE);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [newAddressOpen, setNewAddressOpen] = useState(false);
  const [newAddressText, setNewAddressText] = useState('');

  // Orders View states
  const [orders, setOrders] = useState([]);
  const [repartidores, setRepartidores] = useState([]);
  const [newRepartidorInput, setNewRepartidorInput] = useState('');
  const [repartidoresSaving, setRepartidoresSaving] = useState(false);
  const [quickRepartidorInput, setQuickRepartidorInput] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [selectedOrderForInvoice, setSelectedOrderForInvoice] = useState(null);
  const [showInvoiceOptions, setShowInvoiceOptions] = useState(false);

  // ... (existing code)

  const handleInvoiceOptions = (order) => {
    setSelectedOrderForInvoice(order);
    setShowInvoiceOptions(true);
  };

  const generateInvoicePDF = async (order) => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });

    const profile = JSON.parse(localStorage.getItem('gst_profile') || '{}');
    const cuitEmisor = localStorage.getItem('arca_cuit') || '30-12345678-9';
    const razonSocial = localStorage.getItem('arca_razon_social') || 'Mariano Poggi';
    const nombreComercial = localStorage.getItem('arca_nombre_comercial') || profile?.GST_businesses?.name || 'Mi Negocio';
    const direccionEmisor = localStorage.getItem('arca_direccion') || 'Av. Argentina 123, Neuquén';
    const puntoVenta = localStorage.getItem('arca_punto_venta') || '0001';
    
    const tipoFactura = order.factura_tipo || 'Factura B';
    const facturaLetra = tipoFactura.includes('A') ? 'A' : (tipoFactura.includes('C') ? 'C' : 'B');
    const numComp = order.factura_nro || `${puntoVenta}-00000001`;
    
    const rawFechaComp = order.factura_fecha || new Date().toISOString().split('T')[0];
    const fechaComp = formatDateToAr(rawFechaComp);
    
    const cae = order.cae || 'MOCK-CAE-7628123456';
    const rawVencCae = order.cae_vencimiento || new Date().toISOString().split('T')[0];
    const vencCae = formatDateToAr(rawVencCae);

    const client = clientes.find(c => c.id === order.cliente_id) || clientes.find(c => c.nombre === order.cliente_nombre || c.razon_social === order.cliente_nombre);
    const isRI = (client?.condicion_iva === 'Responsable Inscripto');
    const condicionIvaReceptor = client?.condicion_iva || 'Consumidor Final';
    const cuitReceptor = (client?.cuit && client.cuit !== 'N/A') ? client.cuit : '';
    const domicilioReceptor = order.direccion_envio || '(Consumidor Final)';

    // --- Draw Invoice Header Box ---
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(10, 10, 190, 45); // Outer frame for header
    doc.line(105, 10, 105, 55);
    
    // Letter box in the middle
    doc.setFillColor(240, 240, 240);
    doc.rect(100, 10, 10, 12, 'F');
    doc.rect(100, 10, 10, 12, 'D');
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(facturaLetra, 102.5, 19);

    // Left side: Issuer info
    doc.setFontSize(16);
    doc.text(nombreComercial, 15, 22);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Razón Social: ${razonSocial}`, 15, 28);
    doc.text(`Dirección: ${direccionEmisor}`, 15, 33);
    doc.text(`Condición frente al IVA: Responsable Inscripto`, 15, 38);

    // Right side: Invoice details
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(tipoFactura.toUpperCase(), 112, 22);
    doc.setFontSize(10);
    doc.text(`Nro. Comp: ${numComp}`, 112, 28);
    doc.text(`Fecha Emisión: ${fechaComp}`, 112, 33);
    doc.text(`CUIT: ${cuitEmisor}`, 112, 38);
    doc.text(`Punto de Venta: ${puntoVenta}`, 112, 43);

    // --- Customer Box ---
    doc.rect(10, 58, 190, 22);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text('RECEPTOR / CLIENTE', 13, 63);
    doc.setFont("helvetica", "normal");
    doc.text(`Nombre / Razón Social: ${order.cliente_nombre}`, 13, 69);
    doc.text(`CUIT: ${cuitReceptor || 'Sin Identificar'}`, 13, 74);
    doc.text(`Domicilio: ${domicilioReceptor}`, 112, 69);
    doc.text(`Condición IVA: ${condicionIvaReceptor}`, 112, 74);

    // --- Items Table Headers ---
    let currentY = 85;
    doc.setFillColor(220, 220, 220);
    doc.rect(10, currentY, 190, 7, 'F');
    doc.rect(10, currentY, 190, 7, 'D');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text('Detalle de Producto', 13, currentY + 5);
    doc.text('Cant', 120, currentY + 5);
    if (isRI) {
      doc.text('Alíc. IVA', 135, currentY + 5);
      doc.text('P. Unit. Net', 152, currentY + 5);
    } else {
      doc.text('P. Unitario', 150, currentY + 5);
    }
    doc.text('Subtotal', 178, currentY + 5);

    // --- Items Rows ---
    doc.setFont("helvetica", "normal");
    const items = order.items || [];
    let totalNet21 = 0, totalIva21 = 0, totalNet105 = 0, totalIva105 = 0, totalExempt = 0;

    items.forEach((item, index) => {
      currentY += 7;
      if (index % 2 === 1) {
        doc.setFillColor(248, 248, 248);
        doc.rect(10, currentY, 190, 7, 'F');
      }
      doc.rect(10, currentY, 190, 7, 'D');

      const qty = parseFloat(item.cantidad || 0);
      const price = parseFloat(item.valor || 0);
      const rate = parseFloat(item.iva_alicuota !== undefined ? item.iva_alicuota : 21);
      
      let unitPriceToShow = price;
      let subtotalToShow = qty * price;

      if (isRI) {
        if (rate === 0) {
          totalExempt += qty * price;
        } else {
          const divisor = 1 + (rate / 100);
          const netPrice = price / divisor;
          const netSub = (qty * price) / divisor;
          const ivaSub = (qty * price) - netSub;
          unitPriceToShow = netPrice;
          subtotalToShow = netSub;
          if (rate === 21) { totalNet21 += netSub; totalIva21 += ivaSub; }
          else if (rate === 10.5) { totalNet105 += netSub; totalIva105 += ivaSub; }
        }
      }

      doc.text(item.producto, 13, currentY + 5);
      doc.text(String(qty), 122, currentY + 5);
      if (isRI) {
        doc.text(`${rate}%`, 136, currentY + 5);
        doc.text(`$ ${unitPriceToShow.toFixed(2)}`, 152, currentY + 5);
      } else {
        doc.text(`$ ${unitPriceToShow.toFixed(2)}`, 150, currentY + 5);
      }
      doc.text(`$ ${subtotalToShow.toFixed(2)}`, 178, currentY + 5);
      if (currentY > 260) { doc.addPage(); currentY = 20; }
    });

    // --- Totals Block ---
    currentY += 12;
    if (isRI) {
      doc.rect(10, currentY, 190, 32);
      doc.setFontSize(8.5);
      let subY = currentY + 5;
      if (totalNet21 > 0) {
        doc.text(`Neto Gravado 21%: $ ${totalNet21.toFixed(2)}`, 15, subY);
        doc.text(`IVA 21%: $ ${totalIva21.toFixed(2)}`, 95, subY);
        subY += 5;
      }
      if (totalNet105 > 0) {
        doc.text(`Neto Gravado 10.5%: $ ${totalNet105.toFixed(2)}`, 15, subY);
        doc.text(`IVA 10.5%: $ ${totalIva105.toFixed(2)}`, 95, subY);
        subY += 5;
      }
      if (totalExempt > 0) {
        doc.text(`Importe Exento: $ ${totalExempt.toFixed(2)}`, 15, subY);
      }
      doc.text(`Subtotal Neto: $ ${(totalNet21 + totalNet105).toFixed(2)}`, 15, currentY + 27);
      doc.text(`Subtotal IVA: $ ${(totalIva21 + totalIva105).toFixed(2)}`, 75, currentY + 27);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`TOTAL FACTURADO:`, 130, currentY + 27);
      doc.setFontSize(13);
      doc.text(`$ ${parseFloat(order.total || 0).toFixed(2)}`, 172, currentY + 27);
    } else {
      doc.rect(10, currentY, 190, 15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`TOTAL FACTURADO:`, 130, currentY + 9);
      doc.setFontSize(13);
      doc.text(`$ ${parseFloat(order.total || 0).toFixed(2)}`, 172, currentY + 10);
    }

    // --- Footer / CAE / QR ---
    const footerY = 250;
    doc.line(10, footerY, 200, footerY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text('Comprobante Autorizado por ARCA (ex-AFIP)', 15, footerY + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`CAE Nro: ${cae}`, 15, footerY + 13);
    doc.text(`Vencimiento CAE: ${vencCae}`, 15, footerY + 18);

    // QR Logic
    const cleanCae = String(cae || '').replace(/[^0-9]/g, '');
    const cleanCuitEmisor = String(cuitEmisor || '').replace(/[^0-9]/g, '');
    const cleanCuitReceptor = String(cuitReceptor || '').replace(/[^0-9]/g, '');

    const qrData = {
      ver: 1, 
      fecha: rawFechaComp, 
      cuit: parseInt(cleanCuitEmisor) || 0,
      ptoVta: parseInt(puntoVenta) || 1, 
      tipoCmp: facturaLetra === 'A' ? 1 : (facturaLetra === 'C' ? 11 : 6),
      nroCmp: parseInt((numComp.split('-')[1] || numComp).replace(/[^0-9]/g, '')) || 1,
      importe: parseFloat(order.total) || 0, 
      moneda: "PES", 
      ctz: 1,
      tipoDocRec: cleanCuitReceptor.length === 11 ? 80 : (cleanCuitReceptor.length >= 7 ? 96 : 99), 
      nroDocRec: parseInt(cleanCuitReceptor) || 0,
      tipoCodAut: "E", 
      codAut: parseInt(cleanCae) || 0
    };
    
    const afipQrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(qrData))}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(afipQrUrl)}`;

    try {
      const qrImg = new Image(); 
      qrImg.crossOrigin = "anonymous"; 
      qrImg.src = qrImageUrl;
      // Increased timeout to 2500ms to ensure it loads even on slower connections
      // It will resolve instantly if the image loads faster than that.
      await new Promise(r => { 
        qrImg.onload = r; 
        qrImg.onerror = r; 
        setTimeout(r, 2500); 
      });
      if (qrImg.complete && qrImg.naturalWidth > 0) {
        doc.addImage(qrImg, 'PNG', 165, footerY + 3, 22, 22);
      }
    } catch(e) {
      console.warn("QR failed to load for PDF", e);
    }

    return doc;
  };

  const handleDownloadInvoice = async (order) => {
    try {
      setLoadingOrders(true);
      const doc = await generateInvoicePDF(order);
      doc.save(`Factura-${order.factura_nro || order.id}.pdf`);
    } catch (e) {
      console.error("Error downloading PDF:", e);
      alert("Error al generar el PDF");
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleShareInvoiceViaWhatsApp = async (order) => {
    if (!order) return;
    setShowInvoiceOptions(false);
    setLoadingOrders(true);

    try {
      // 1. Generate PDF
      const doc = await generateInvoicePDF(order);
      const pdfBlob = doc.output('blob');
      const fileName = `Factura-${order.factura_nro || 'S-N'}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      // 2. Upload to Supabase Storage to get a LINK
      let publicUrl = null;
      try {
        const uploadResult = await db.uploadInvoice(file, fileName);
        if (uploadResult.publicUrl) {
          publicUrl = uploadResult.publicUrl;
        }
      } catch (uploadErr) {
        console.warn("Upload to storage failed, will use manual attachment fallback:", uploadErr);
      }

      // 3. Prepare message
      const clienteNombre = order.cliente_nombre || 'Cliente';
      const tipo = order.factura_tipo || 'Factura';
      const nro = order.factura_nro || 'S/N';
      const montoTotal = order.total || 0;
      const totalStr = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(montoTotal);
      
      let message = `*Hola ${clienteNombre}!* 👋\n\n`;
      message += `Te envío la *${tipo}* de tu pedido:\n\n`;
      message += `📄 *Número:* ${nro}\n`;
      message += `💰 *Total:* ${totalStr}\n\n`;
      
      if (publicUrl) {
        message += `🔗 *Podés descargar tu factura aquí:* ${publicUrl}\n\n`;
      }
      
      message += `¡Gracias por elegirnos!`;

      // 4. Try Native Share
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: fileName,
            text: message
          });
          setLoadingOrders(false);
          return; 
        } catch (shareErr) {
          console.warn("Native share failed:", shareErr);
        }
      }

      // 5. Fallback: Open WhatsApp Link
      if (!publicUrl) {
        // If no link, we MUST download it so the user can attach it
        doc.save(fileName);
        message += `\n\n(Te acabo de descargar el PDF para que lo adjuntes aquí)`;
      }
      
      let phone = '';
      if (Array.isArray(clientes)) {
        const clienteObj = clientes.find(c => c.id === order.cliente_id);
        if (clienteObj && clienteObj.telefono) phone = clienteObj.telefono;
      }
      if (!phone && order.gst_clientes && order.gst_clientes.telefono) {
        phone = order.gst_clientes.telefono;
      }

      const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '') : '';
      let waLink = '';
      if (cleanPhone) {
        let finalPhone = cleanPhone;
        if (finalPhone.length === 10) finalPhone = '549' + finalPhone;
        else if (finalPhone.length === 11 && finalPhone.startsWith('15')) finalPhone = '549' + finalPhone.substring(2);
        else if (finalPhone.length > 10 && !finalPhone.startsWith('54')) finalPhone = '54' + finalPhone;
        waLink = `https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`;
      } else {
        waLink = `https://wa.me/?text=${encodeURIComponent(message)}`;
      }

      window.open(waLink, 'WhatsAppWindow');
    } catch (err) {
      console.error("Error sharing via WA:", err);
      alert("Error al preparar WhatsApp: " + (err.message || "Verifique los datos del pedido"));
    } finally {
      setLoadingOrders(false);
    }
  };
  const [typeFilter, setTypeFilter] = useState('delivery'); // 'delivery' by default
  const [statusFilter, setStatusFilter] = useState(null); // null, 'pendiente', 'en_reparto', 'entregado', 'finalizado'
  const [dateFilter, setDateFilter] = useState('today'); // 'today', 'all', 'custom'
  const [customDate, setCustomDate] = useState('');
  const dateInputRef = useRef(null);
  const [orderSortField, setOrderSortField] = useState('fecha');
  const [orderSortAsc, setOrderSortAsc] = useState(false);

  const handleSortOrders = (field) => {
    if (orderSortField === field) {
      setOrderSortAsc(!orderSortAsc);
    } else {
      setOrderSortField(field);
      if (field === 'fecha' || field === 'total') {
        setOrderSortAsc(false);
      } else {
        setOrderSortAsc(true);
      }
    }
  };

  const handleSortClients = (field) => {
    if (clientSortField === field) {
      setClientSortAsc(!clientSortAsc);
    } else {
      setClientSortField(field);
      setClientSortAsc(field !== 'saldo');
    }
  };

  const handleSortProducts = (field) => {
    if (productSortField === field) {
      setProductSortAsc(!productSortAsc);
    } else {
      setProductSortField(field);
      setProductSortAsc(field !== 'precio' && field !== 'stock' && field !== 'iva');
    }
  };

  // ARCA Billing states
  const [arcaProgressModal, setArcaProgressModal] = useState(false);
  const [arcaProgressText, setArcaProgressText] = useState('');
  const [arcaResults, setArcaResults] = useState([]);

  const isClientResponsableInscripto = (client) => {
    if (!client) return false;
    if (client.condicion_iva) {
      return client.condicion_iva.toLowerCase() === 'responsable inscripto';
    }
    return false;
  };

  const formatDateToAr = (dateStr) => {
    if (!dateStr) return '';
    if (/^\d{8}$/.test(dateStr)) {
      return `${dateStr.substring(6, 8)}/${dateStr.substring(4, 6)}/${dateStr.substring(0, 4)}`;
    }
    const parts = dateStr.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const handleInvoiceSelectedOrders = async () => {
    const ordersToInvoice = selectedOrderIds
      .map(id => orders.find(o => o.id === id))
      .filter(o => o && !o.cae);

    if (ordersToInvoice.length === 0) {
      alert("No hay pedidos seleccionados pendientes de facturar.");
      return;
    }

    // Check if any client is set to Responsable Inscripto but lacks a CUIT
    const riWithoutCuit = ordersToInvoice.filter(order => {
      const client = clientes.find(c => c.id === order.cliente_id) || clientes.find(c => c.nombre === order.cliente_nombre || c.razon_social === order.cliente_nombre);
      const isRI = isClientResponsableInscripto(client);
      const cuit = client?.cuit;
      return isRI && (!cuit || cuit === 'N/A' || cuit.replace(/[^0-9]/g, '').length !== 11);
    });

    if (riWithoutCuit.length > 0) {
      const names = riWithoutCuit.map(o => o.cliente_nombre).join(', ');
      alert(`Error: Los siguientes clientes están configurados como Responsable Inscripto pero no tienen un CUIT válido de 11 dígitos: ${names}. Por favor, edita sus datos antes de facturar.`);
      return;
    }

    if (!window.confirm(`¿Seguro que deseas facturar ${ordersToInvoice.length} pedido(s) ante ARCA (AFIP)?`)) {
      return;
    }

    setArcaProgressModal(true);
    setArcaProgressText(`Preparando facturación para ${ordersToInvoice.length} pedido(s)...`);
    setArcaResults([]);
    
    try {
      await db.getArcaConfig();
      const arcaConfig = readArcaFromCache(getBusinessId());
      const results = [];
      const cuitEmisor = arcaConfig.cuit || '';
      const puntoVenta = arcaConfig.punto_venta || '0001';
      const isDemo = !isSupabaseConfigured() || !cuitEmisor;

      for (let i = 0; i < ordersToInvoice.length; i++) {
        const order = ordersToInvoice[i];
        setArcaProgressText(`Facturando pedido ${i + 1} de ${ordersToInvoice.length}: ${order.cliente_nombre}...`);

        const client = clientes.find(c => c.id === order.cliente_id) || clientes.find(c => c.nombre === order.cliente_nombre || c.razon_social === order.cliente_nombre);
        const isRI = isClientResponsableInscripto(client);
        const facturaTipo = isRI ? 'Factura A' : 'Factura B';

        try {
          let invoiceData;

          if (isDemo) {
            // Simulate ARCA connection delay (throttling)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Generate mock invoice details
            const nextInvoiceNum = Math.floor(Math.random() * 900000) + 100000;
            const mockCae = "7628" + Math.floor(1000000000 + Math.random() * 9000000000);
            const mockVenc = new Date();
            mockVenc.setDate(mockVenc.getDate() + 10);
            
            invoiceData = {
              cae: mockCae,
              cae_vencimiento: mockVenc.toISOString().split('T')[0],
              factura_nro: `${puntoVenta}-${String(nextInvoiceNum).padStart(8, '0')}`,
              factura_fecha: new Date().toISOString().split('T')[0],
              factura_tipo: facturaTipo,
              factura_error: null
            };
          } else {
            // Real backend integration: call Supabase Edge Function
            // Await delay to respect AFIP rate limit (throttling)
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log(`[Facturación Debug] Iniciando facturación del pedido ID: ${order.id}`);
            const cuitReceptor = client?.cuit ? client.cuit.replace(/[^0-9]/g, '') : '';

            const requestPayload = {
              orderId: order.id,
              cuitEmisor,
              puntoVenta,
              total: order.total,
              items: order.items,
              facturaTipo: isRI ? 'A' : 'B',
              cuitReceptor,
              ambiente: arcaConfig.ambiente || 'homologacion',
              cert: arcaConfig.cert || '',
              key: arcaConfig.private_key || '',
              accessToken: arcaConfig.token || '',
            };
            console.log(`[Facturación Debug] Payload a enviar:`, JSON.stringify({
              ...requestPayload,
              cert: requestPayload.cert ? '[presente]' : '[vacío]',
              key: requestPayload.key ? '[presente]' : '[vacío]',
            }));

            if (!supabase?.functions?.invoke) {
              throw new Error('Supabase no está configurado para invocar la función de facturación.');
            }

            console.log('[Facturación Debug] Invocando Edge Function arca-invoice...');
            const { data, error: fnError } = await supabase.functions.invoke('arca-invoice', {
              body: requestPayload,
            });

            if (fnError) {
              let details = fnError.message || 'Error al invocar la función de facturación.';
              if (fnError.context && typeof fnError.context.json === 'function') {
                try {
                  const errJson = await fnError.context.json();
                  if (errJson?.error) details = errJson.error;
                } catch (_) {}
              }
              if (String(details).includes('404') || String(details).toLowerCase().includes('not found')) {
                details = 'La función arca-invoice no está desplegada en Supabase. Ejecutá: supabase functions deploy arca-invoice';
              }
              console.error('[Facturación Debug] Error de facturación:', details);
              throw new Error(details);
            }

            if (data?.error) {
              throw new Error(data.error);
            }

            console.log('[Facturación Debug] Datos recibidos con éxito:', JSON.stringify(data));

            invoiceData = {
              cae: data.cae,
              cae_vencimiento: data.cae_vencimiento,
              factura_nro: data.factura_nro,
              factura_fecha: data.factura_fecha,
              factura_tipo: data.factura_tipo || facturaTipo,
              factura_error: null
            };
          }

          // Save to database/state
          await db.updatePedidosStatus([order.id], invoiceData);
          results.push({
            orderId: order.id,
            cliente: order.cliente_nombre,
            total: order.total,
            status: 'success',
            details: `Factura autorizada: ${invoiceData.factura_tipo} Nro ${invoiceData.factura_nro}`,
            facturaNro: invoiceData.factura_nro,
            invoiceData: invoiceData // Pass full data for immediate printing
          });

        } catch (err) {
          console.error("Billing error for order", order.id, err);
          const errMsg = err.message || "Error de red o timeout con los servidores de ARCA.";
          try {
            await db.updatePedidosStatus([order.id], { factura_error: errMsg });
          } catch (dbErr) {
            console.error("Failed to write invoice error to DB:", dbErr);
          }
          results.push({
            orderId: order.id,
            cliente: order.cliente_nombre,
            total: order.total,
            status: 'error',
            details: errMsg
          });
        }
      }

      setArcaProgressText("Proceso de facturación finalizado.");
      setArcaResults(results);
      await loadOrders(); // Reload orders to update UI badges and Comanda column
      setSelectedOrderIds([]); // Clear selection
    } catch (globalErr) {
      console.error("Global billing error:", globalErr);
      alert("Error inesperado en el proceso de facturación: " + globalErr.message);
      setArcaProgressModal(false);
    }
  };

  // Bulk Modals
  const [bulkRepartidorModal, setBulkRepartidorModal] = useState(false);
  const [bulkRepartidorName, setBulkRepartidorName] = useState('');
  const [bulkPaymentModal, setBulkPaymentModal] = useState(false);
  const [bulkOrdersPayments, setBulkOrdersPayments] = useState({}); // orderId -> paymentMethod mapping
  const [cancelMotiveModal, setCancelMotiveModal] = useState(false);
  const [cancelMotiveText, setCancelMotiveText] = useState('');

  // Print Observation Modal States
  const [printObsModal, setPrintObsModal] = useState(false);
  const [printObsText, setPrintObsText] = useState('');
  const [printObsPhone, setPrintObsPhone] = useState('');
  const [printObsPendingOrder, setPrintObsPendingOrder] = useState(null);
  const [waCopyFeedback, setWaCopyFeedback] = useState('');

  // Edit pending order
  const [editOrderModal, setEditOrderModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editOrderItems, setEditOrderItems] = useState([]);
  const [editOrderSaving, setEditOrderSaving] = useState(false);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editSelectedProduct, setEditSelectedProduct] = useState(null);
  const [editShowProductSuggestions, setEditShowProductSuggestions] = useState(false);
  const [editItemQty, setEditItemQty] = useState(1);
  const [editItemPrice, setEditItemPrice] = useState(0);
  const [editItemObs, setEditItemObs] = useState('');
  const editProductRef = useRef(null);

  // Submit messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingSubmit, setLoadingSubmit] = useState(false);

  // Refs for clicking outside autocomplete lists
  const clientRef = useRef(null);
  const productRef = useRef(null);

  // Input element refs for keyboard focus navigation
  const clientInputRef = useRef(null);
  const productInputRef = useRef(null);
  const qtyInputRef = useRef(null);

  // Load clients, products on mount
  useEffect(() => {
    loadInitialData();

    // Click outside handler
    const handleClickOutside = (event) => {
      if (clientRef.current && !clientRef.current.contains(event.target)) {
        setShowClientSuggestions(false);
      }
      if (productRef.current && !productRef.current.contains(event.target)) {
        setShowProductSuggestions(false);
      }
      if (editProductRef.current && !editProductRef.current.contains(event.target)) {
        setEditShowProductSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reload addresses when client changes
  useEffect(() => {
    if (selectedClient) {
      loadClientAddresses();
      setOrderItems([]);
      setConEnvio(false);
      setSelectedAddress('');
      setNewAddressOpen(false);
      setNewAddressText('');
    } else {
      setAddresses([]);
    }
  }, [selectedClient]);

  // Load orders list when viewMode changes to 'orders'
  useEffect(() => {
    if (viewMode === 'orders') {
      loadOrders();
      setSelectedOrderIds([]);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === 'repartidores') {
      loadRepartidores();
    }
  }, [viewMode]);

  useEffect(() => {
    const fee = resolveDeliveryFee(products);
    setDeliveryFee(fee);
    setOrderItems((prev) => {
      if (!prev.some(isDeliveryItem)) return prev;
      const envioProduct = findEnvioProduct(products);
      return prev.map((item) =>
        isDeliveryItem(item) ? createDeliveryItem(fee, envioProduct) : item
      );
    });
  }, [products]);

  useEffect(() => {
    if (viewMode === 'register') {
      setDeliveryFee(resolveDeliveryFee(products));
    }
  }, [viewMode, products]);

  // Clear selections when changing active order filters
  useEffect(() => {
    setSelectedOrderIds([]);
  }, [typeFilter, statusFilter]);

  // Sync selectedClient with updated client list to prevent stale balance displays
  useEffect(() => {
    if (selectedClient && clientes.length > 0) {
      const updated = clientes.find(c => c.id === selectedClient.id);
      if (updated && updated.saldo !== selectedClient.saldo) {
        setSelectedClient(updated);
      }
    }
  }, [clientes, selectedClient]);

  // Load daily refunds when date filters change
  useEffect(() => {
    const fetchDailyRefunds = async () => {
      let startStr = '1970-01-01T00:00:00.000Z';
      let endStr = '2999-12-31T23:59:59.999Z';
      
      const now = new Date();
      if (dateFilter === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        startStr = start.toISOString();
        endStr = end.toISOString();
      } else if (dateFilter === 'custom' && customDate) {
        // customDate is in YYYY-MM-DD or similar string, parse it locally
        const parts = customDate.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = parseInt(parts[2], 10);
          const start = new Date(y, m, d, 0, 0, 0);
          const end = new Date(y, m, d, 23, 59, 59, 999);
          startStr = start.toISOString();
          endStr = end.toISOString();
        }
      }
      
      try {
        const refunds = await db.getDailyRefunds(startStr, endStr);
        setDailyRefunds(refunds);
      } catch (err) {
        console.error("Error loading daily refunds:", err);
      }
    };
    
    fetchDailyRefunds();
  }, [dateFilter, customDate, orders]);

  const getPaymentMethodValue = (concept) => {
    const id = concept?.id || '';
    if (id === 'medio_01') return 'Efectivo';
    if (id === 'medio_02' || id === 'transferencia') return 'Transferencia';
    if (id === 'medio_03' || id === 'tarjeta') return 'Tarjeta';
    if (id === 'medio_04' || id === 'qrPago') return 'QR';
    if (id === 'medio_05' || id === 'linkPago') return 'Link de pago';
    if (id === 'medio_06' || id === 'ctaCte') return 'Cta Cte';
    return concept.label?.trim() || id;
  };

  const enabledPaymentMethods = activePaymentMethods.filter((c) => c.enabled && c.label?.trim());

  const resolveMedioPagoKey = (medioPago) => {
    const method = String(medioPago || 'Efectivo').trim();
    if (!method) return 'Efectivo';

    for (const concept of enabledPaymentMethods) {
      const key = getPaymentMethodValue(concept);
      if (method === key || method === concept.label) return key;
    }

    const legacyAliases = {
      'Transferencia Bancaria': 'Transferencia',
      'Tarjeta (Crédito/Débito)': 'Tarjeta',
      'QR / Mercado Pago': 'QR',
      'Link de Pago': 'Link de pago',
      'Cuenta Corriente (Deuda)': 'Cta Cte',
    };
    return legacyAliases[method] || method;
  };

  const getPaymentMethodEmoji = (id) => {
    if (id === 'transferencia') return '📲';
    if (id === 'tarjeta') return '💳';
    if (id === 'qrPago') return '📱';
    if (id === 'linkPago') return '🔗';
    if (id === 'ctaCte') return '📂';
    return '💰';
  };

  const getConceptIcon = (id) => {
    if (id === 'medio_01') return 'bi-cash-coin text-success';
    if (String(id).startsWith('medio_')) {
      const icon = getMedioIcon(id);
      if (id === 'medio_02') return `${icon} text-primary`;
      if (id === 'medio_03') return `${icon} text-info`;
      if (id === 'medio_04') return `${icon} text-warning`;
      if (id === 'medio_05') return `${icon} text-secondary`;
      if (id === 'medio_06') return `${icon} text-danger`;
      return `${icon} text-dark`;
    }
    if (id === 'transferencia') return 'bi-bank text-primary';
    if (id === 'tarjeta') return 'bi-credit-card text-info';
    if (id === 'qrPago') return 'bi-qr-code text-warning';
    if (id === 'linkPago') return 'bi-link-45deg text-secondary';
    if (id === 'ctaCte') return 'bi-person-lines-fill text-danger';
    return 'bi-cash-coin text-dark';
  };

  const loadInitialData = async () => {
    try {
      const cl = await db.getClientes();
      setClientes(cl);
      const pr = await db.getProducts();
      setProducts(pr);
      const reps = await db.getRepartidores();
      setRepartidores(reps || []);
      loadOrders();
      const concepts = await db.getCierreConceptos() || [];
      setActivePaymentMethods(concepts);
    } catch (e) {
      console.error("Error loading initial data:", e);
    }
  };

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      const data = await db.getPedidos();
      setOrders(data);
    } catch (e) {
      console.error("Error loading orders:", e);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadRepartidores = async () => {
    try {
      const reps = await db.getRepartidores();
      setRepartidores(reps || []);
    } catch (e) {
      console.error('Error loading repartidores:', e);
    }
  };

  const persistRepartidores = async (list) => {
    setRepartidoresSaving(true);
    try {
      const res = await db.saveRepartidores(list);
      if (!res.success) {
        alert(res.error || 'No se pudo guardar el listado de repartidores.');
        return false;
      }
      setRepartidores(list);
      return true;
    } catch (err) {
      alert(err.message || 'Error al guardar repartidores.');
      return false;
    } finally {
      setRepartidoresSaving(false);
    }
  };

  const handleAddRepartidor = async (e, nameOverride) => {
    if (e) e.preventDefault();
    const val = (nameOverride ?? newRepartidorInput).trim();
    if (!val || repartidores.includes(val)) return;
    await persistRepartidores([...repartidores, val]);
    setNewRepartidorInput('');
    setQuickRepartidorInput('');
    setBulkRepartidorName(val);
  };

  const handleRemoveRepartidor = async (index) => {
    const next = repartidores.filter((_, i) => i !== index);
    await persistRepartidores(next);
  };

  const handleQuickAddRepartidor = async (e) => {
    await handleAddRepartidor(e, quickRepartidorInput);
  };

  const getOrderClientSaldo = (order) => {
    const client = clientes.find((c) => c.id === order.cliente_id)
      || clientes.find((c) => c.nombre === order.cliente_nombre || c.razon_social === order.cliente_nombre);
    if (!client) return null;
    return parseFloat(client.saldo || 0);
  };

  const loadClientAddresses = async () => {
    if (!selectedClient) return;
    try {
      const data = await db.getDirecciones(selectedClient.id);
      setAddresses(data);
      if (selectedClient.direccion_predeterminada) {
        setSelectedAddress(selectedClient.direccion_predeterminada);
      } else if (data.length > 0) {
        setSelectedAddress(data[0].direccion);
      } else {
        setSelectedAddress('');
      }
    } catch (e) {
      console.error("Error loading client addresses:", e);
    }
  };

  const loadClientMovements = async () => {
    if (!selectedClient) return;
    setLoadingMovements(true);
    try {
      const data = await db.getMovimientos(selectedClient.id);
      setMovements(data);
    } catch (e) {
      console.error("Error loading client movements:", e);
    } finally {
      setLoadingMovements(false);
    }
  };

  const handleOpenDrawer = () => {
    setShowDrawer(true);
    loadClientMovements();
  };

  const handleClearClienteMovimientos = async () => {
    if (!selectedClient) return;
    if (window.confirm(`¿Seguro que deseas eliminar todos los movimientos y restablecer el saldo de ${selectedClient.nombre}? Esta acción no se puede deshacer.`)) {
      setLoadingMovements(true);
      try {
        const res = await db.clearClienteMovimientos(selectedClient.id);
        if (res.success) {
          setMovements([]);
          const cl = await db.getClientes();
          setClientes(cl);
          if (res.data) {
            setSelectedClient(res.data);
          } else {
            const updated = cl.find(c => c.id === selectedClient.id);
            if (updated) setSelectedClient(updated);
          }
        }
      } catch (err) {
        console.error(err);
        alert("Error al intentar eliminar los movimientos del cliente.");
      } finally {
        setLoadingMovements(false);
      }
    }
  };

  const handleExportCSV = async () => {
    if (!selectedClient || movements.length === 0) return;
    
    // Sort chronologically to compute running balance correctly
    const chronoMovs = [...movements].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    
    let runningBalance = 0;
    const computedMovs = chronoMovs.map(m => {
      const debe = parseFloat(m.debe || 0);
      const haber = parseFloat(m.haber || 0);
      runningBalance += debe - haber;
      return {
        ...m,
        debe,
        haber,
        saldo: runningBalance
      };
    });
    
    // Sort back to newest first to match display order
    computedMovs.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    const finalBalance = computedMovs.length > 0 ? computedMovs[0].saldo : 0;
    
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Estado de Cuenta');
      
      // Ensure grid lines are visible
      worksheet.views = [{ showGridLines: true }];
      
      // Define columns widths
      worksheet.columns = [
        { key: 'fecha', width: 22 },
        { key: 'concepto', width: 50 },
        { key: 'debe', width: 16 },
        { key: 'haber', width: 16 },
        { key: 'saldo', width: 16 }
      ];
      
      // Estilos comunes
      const fontRegular = { name: 'Calibri', size: 11 };
      const fontBold = { name: 'Calibri', size: 11, bold: true };
      const fontLargeBold = { name: 'Calibri', size: 13, bold: true };
      
      const borderThin = {
        top: { style: 'thin', color: { argb: 'FFC0C0C0' } },
        left: { style: 'thin', color: { argb: 'FFC0C0C0' } },
        bottom: { style: 'thin', color: { argb: 'FFC0C0C0' } },
        right: { style: 'thin', color: { argb: 'FFC0C0C0' } }
      };
      
      const fillGray = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' }
      };
      
      // Row 1: Business Name in A1
      const bizName = profile?.GST_businesses?.name || 'Mi Negocio';
      const row1 = worksheet.getRow(1);
      row1.getCell(1).value = bizName;
      row1.getCell(1).font = fontLargeBold;
      for (let i = 1; i <= 5; i++) {
        row1.getCell(i).border = borderThin;
      }
      
      // Row 2: Metadata
      const row2 = worksheet.getRow(2);
      
      // A2: "Estado de cuenta" (pintado de gris)
      row2.getCell(1).value = 'Estado de cuenta';
      row2.getCell(1).font = fontBold;
      row2.getCell(1).fill = fillGray;
      row2.getCell(1).border = borderThin;
      
      // B2: Nombre del cliente
      row2.getCell(2).value = selectedClient.nombre;
      row2.getCell(2).font = fontBold;
      row2.getCell(2).border = borderThin;
      
      // C2: "Saldo:" (letra 2 puntos más grande: size 13)
      row2.getCell(3).value = 'Saldo:';
      row2.getCell(3).font = fontLargeBold;
      row2.getCell(3).border = borderThin;
      
      // D2: Saldo value (which will be merged with E2) (letra 2 puntos más grande: size 13)
      row2.getCell(4).value = parseFloat(finalBalance);
      row2.getCell(4).font = fontLargeBold;
      row2.getCell(4).numFormat = '$#,##0.00';
      row2.getCell(4).alignment = { horizontal: 'right' };
      row2.getCell(4).border = borderThin;
      
      // E2: Necesitamos ponerle borde y mergearlo
      row2.getCell(5).border = borderThin;
      
      // Combinar D2 y E2
      worksheet.mergeCells('D2:E2');
      
      // Row 3: Headers
      const row3 = worksheet.getRow(3);
      row3.values = ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo'];
      
      for (let i = 1; i <= 5; i++) {
        const cell = row3.getCell(i);
        cell.font = fontBold;
        cell.fill = fillGray;
        cell.border = borderThin;
        if (i >= 3) {
          cell.alignment = { horizontal: 'right' };
        } else {
          cell.alignment = { horizontal: 'left' };
        }
      }
      
      // Rows 4+: Movimientos
      computedMovs.forEach((m, idx) => {
        const rowNum = 4 + idx;
        const row = worksheet.getRow(rowNum);
        
        const dateStr = new Date(m.fecha).toLocaleString('es-AR');
        
        row.getCell(1).value = dateStr;
        row.getCell(1).font = fontBold;
        row.getCell(1).alignment = { horizontal: 'left' };
        row.getCell(1).border = borderThin;
        
        row.getCell(2).value = m.concepto || '';
        row.getCell(2).font = fontRegular;
        row.getCell(2).alignment = { horizontal: 'left' };
        row.getCell(2).border = borderThin;
        
        row.getCell(3).value = m.debe;
        row.getCell(3).font = fontRegular;
        row.getCell(3).numFormat = '$#,##0.00';
        row.getCell(3).alignment = { horizontal: 'right' };
        row.getCell(3).border = borderThin;
        
        row.getCell(4).value = m.haber;
        row.getCell(4).font = fontRegular;
        row.getCell(4).numFormat = '$#,##0.00';
        row.getCell(4).alignment = { horizontal: 'right' };
        row.getCell(4).border = borderThin;
        
        row.getCell(5).value = m.saldo;
        row.getCell(5).font = fontRegular;
        row.getCell(5).numFormat = '$#,##0.00';
        row.getCell(5).alignment = { horizontal: 'right' };
        row.getCell(5).border = borderThin;
      });
      
      // Trigger download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Cuenta_Corriente_${selectedClient.nombre.replace(/\s+/g, '_')}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Error al intentar exportar la cuenta corriente a Excel.");
    }
  };

  const handleSelectClient = (client) => {
    setSelectedClient(client);
    setClientSearch(client.nombre);
    setShowClientSuggestions(false);
  };

  const handleCuitChange = (e) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length > 11) {
      value = value.substring(0, 11);
    }
    let formatted = '';
    if (value.length > 0) {
      formatted += value.substring(0, 2);
    }
    if (value.length > 2) {
      formatted += '-' + value.substring(2, 10);
    }
    if (value.length > 10) {
      formatted += '-' + value.substring(10, 11);
    }
    setNewClientCuit(formatted);
  };

  const resetImportMapping = () => {
    setImportCsvText('');
    setImportCsvHeaders([]);
    setImportHasHeaderRow(true);
    setImportColumnMapping({});
    setImportPreviewRows([]);
    setImportRowCount(0);
    setImportFileName('');
    setImportClientesResult(null);
    setImportClientesStatus('');
  };

  const refreshImportAnalysis = (csvText, hasHeaderRow) => {
    const analysis = analyzeCsvImport(csvText, { hasHeaderRow });
    if (analysis.error) return analysis;
    setImportCsvHeaders(analysis.rawHeaders);
    setImportColumnMapping(analysis.suggestedMapping);
    setImportPreviewRows(analysis.previewRows);
    setImportRowCount(analysis.rowCount);
    return analysis;
  };

  const handleImportCsvFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportClientesStatus('');
    setImportClientesResult(null);

    try {
      const csvText = await file.text();
      const analysis = analyzeCsvImport(csvText);
      if (analysis.error) {
        setImportClientesStatus('error');
        setImportClientesResult({
          imported: 0,
          skipped: 0,
          skippedEmpty: 0,
          inferredNames: 0,
          failed: 0,
          deleted: 0,
          errors: [analysis.error],
        });
        return;
      }

      setImportCsvText(csvText);
      setImportCsvHeaders(analysis.rawHeaders);
      setImportHasHeaderRow(analysis.hasHeaderRow);
      setImportColumnMapping(analysis.suggestedMapping);
      setImportPreviewRows(analysis.previewRows);
      setImportRowCount(analysis.rowCount);
      setImportFileName(file.name);
      setImportClientesStatus('mapping');
    } catch (err) {
      setImportClientesStatus('error');
      setImportClientesResult({
        imported: 0,
        skipped: 0,
        skippedEmpty: 0,
        failed: 0,
        deleted: 0,
        errors: [err.message || 'No se pudo leer el archivo CSV.'],
      });
    }
  };

  const handleConfirmImportCsv = async () => {
    if (!importCsvText) return;

    if (importReplaceAll) {
      const ok = window.confirm(
        'Se borrarán TODOS los clientes de tu empresa (y sus pedidos/direcciones/movimientos) antes de importar. ¿Continuar?'
      );
      if (!ok) return;
    }

    setImportClientesStatus('importing');
    setImportClientesResult(null);

    try {
      const result = await db.importClientesFromCsv(importCsvText, {
        replaceAll: importReplaceAll,
        columnMapping: importColumnMapping,
        hasHeaderRow: importHasHeaderRow,
      });
      setImportClientesResult(result);
      setImportClientesStatus(result.imported > 0 ? 'success' : 'error');

      if (result.imported > 0 || result.deleted > 0) {
        const cl = await db.getClientes();
        setClientes(cl);
        setSelectedClient(null);
        setClientSearch('');
      }
    } catch (err) {
      setImportClientesStatus('error');
      setImportClientesResult({
        imported: 0,
        skipped: 0,
        skippedEmpty: 0,
        failed: 0,
        deleted: 0,
        errors: [err.message || 'No se pudo importar el archivo CSV.'],
      });
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setNewClientError('');

    if (!newClientName.trim()) {
      setNewClientError('El nombre es obligatorio.');
      return;
    }

    if (!newClientAddress.trim()) {
      setNewClientError('Agregá al menos una dirección de envío.');
      return;
    }

    if (!isValidGpsAddress(newClientAddress)) {
      const proceed = window.confirm(
        'La dirección parece incompleta o no apta para guía por GPS (se recomienda calle, número y localidad). ¿Desea registrarla de todas formas?'
      );
      if (!proceed) return;
    }

    try {
      const addressText = newClientAddress.trim();
      const res = await db.saveCliente({
        nombre: newClientName.trim(),
        razon_social: newClientRazon.trim() || newClientName.trim(),
        cuit: newClientCuit.replace(/[^0-9]/g, '') || 'N/A',
        telefono: newClientTelefono.trim(),
        condicion_iva: newClientCondicionIva
      });

      if (res.success && res.data) {
        const dirRes = await db.saveDireccion(res.data.id, addressText);
        if (!dirRes.success) {
          throw new Error('El cliente se creó pero no se pudo guardar la dirección.');
        }

        await db.updateCliente(res.data.id, {
          direccion_predeterminada: addressText,
        });

        const cl = await db.getClientes();
        setClientes(cl);
        const createdClient = cl.find(c => c.id === res.data.id) || {
          ...res.data,
          direccion_predeterminada: addressText,
        };
        handleSelectClient(createdClient);
        setNewClientName('');
        setNewClientRazon('');
        setNewClientCuit('');
        setNewClientTelefono('');
        setNewClientAddress('');
        setNewClientCondicionIva('Consumidor Final');
        setNewClientModal(false);
      }
    } catch (err) {
      setNewClientError(err.message || 'Error al guardar cliente.');
    }
  };

  const handleOpenClientMovements = (client) => {
    setSelectedClient(client);
    setShowDrawer(true);
    setLoadingMovements(true);
    db.getMovimientos(client.id)
      .then(data => setMovements(data))
      .catch(e => console.error(e))
      .finally(() => setLoadingMovements(false));
  };

  const handleOpenEditClientModal = async (client) => {
    setEditingClient(client);
    setEditClientNombre(client.nombre);
    setEditClientRazonSocial(client.razon_social || '');
    setEditClientCuit(formatCuit(client.cuit) || '');
    setEditClientCondicionIva(client.condicion_iva || 'Consumidor Final');
    setEditClientTelefono(client.telefono || '');
    setNewEditAddressText('');
    setEditClientModal(true);
    
    try {
      const addr = await db.getDirecciones(client.id);
      setEditingClientAddresses(addr);
    } catch (err) {
      console.error("Error fetching addresses:", err);
      setEditingClientAddresses([]);
    }
  };

  const handleSaveEditedClient = async (e) => {
    if (e) e.preventDefault();
    if (!editClientNombre.trim()) {
      alert("El nombre es obligatorio");
      return;
    }
    setSavingClient(true);
    try {
      const res = await db.updateCliente(editingClient.id, {
        nombre: editClientNombre.trim(),
        razon_social: editClientRazonSocial.trim() || editClientNombre.trim(),
        cuit: editClientCuit.replace(/[^0-9]/g, '') || 'N/A',
        condicion_iva: editClientCondicionIva,
        telefono: editClientTelefono.trim()
      });
      if (res.success) {
        const cl = await db.getClientes();
        setClientes(cl);
        setEditClientModal(false);
      }
    } catch (err) {
      alert("Error al actualizar cliente: " + err.message);
    } finally {
      setSavingClient(false);
    }
  };

  const handleAddEditAddress = async (e) => {
    if (e) e.preventDefault();
    if (!newEditAddressText.trim()) return;

    if (!isValidGpsAddress(newEditAddressText)) {
      const proceed = window.confirm("La dirección parece incompleta o no apta para guía por GPS (se recomienda calle, número y localidad). ¿Desea guardarla de todas formas?");
      if (!proceed) return;
    }

    try {
      const res = await db.saveDireccion(editingClient.id, newEditAddressText.trim());
      if (res.success) {
        const addr = await db.getDirecciones(editingClient.id);
        setEditingClientAddresses(addr);
        setNewEditAddressText('');
      }
    } catch (err) {
      alert("Error al guardar dirección: " + err.message);
    }
  };



  const handleSetDefaultAddress = async (addressText) => {
    try {
      const res = await db.updateCliente(editingClient.id, {
        direccion_predeterminada: addressText
      });
      if (res.success) {
        setEditingClient(prev => ({ ...prev, direccion_predeterminada: addressText }));
        const cl = await db.getClientes();
        setClientes(cl);
      }
    } catch (err) {
      alert("Error al establecer dirección predeterminada: " + err.message);
    }
  };

  const handleOpenRefundModal = () => {
    if (!selectedClient) return;
    const defaultAmt = Math.abs(selectedClient.saldo || 0);
    setRefundAmount(defaultAmt);
    setRefundMethod('Efectivo');
    setRefundModal(true);
  };

  const handleSubmitRefund = async (e) => {
    if (e) e.preventDefault();
    const amt = parseFloat(refundAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Ingrese un monto válido mayor a 0");
      return;
    }
    setSubmittingRefund(true);
    try {
      const resMov = await db.saveMovement({
        cliente_id: selectedClient.id,
        concepto: `Devolución de pago (${refundMethod})`,
        debe: amt,
        haber: 0.00
      });
      
      if (resMov.success) {
        const newSaldo = parseFloat(selectedClient.saldo || 0) + amt;
        await db.updateClienteSaldo(selectedClient.id, newSaldo);
        
        const cl = await db.getClientes();
        setClientes(cl);
        
        setLoadingMovements(true);
        const movs = await db.getMovimientos(selectedClient.id);
        setMovements(movs);
        setLoadingMovements(false);
        
        const updatedClient = cl.find(c => c.id === selectedClient.id);
        setSelectedClient(updatedClient);
        
        setRefundModal(false);
      }
    } catch (err) {
      alert("Error al procesar la devolución: " + err.message);
    } finally {
      setSubmittingRefund(false);
    }
  };

  const handleOpenProductModal = (product = null) => {
    setEditingProduct(product);
    if (product) {
      setProdNombre(product.nombre);
      setProdRubro(product.rubro || '');
      setProdPrecio(product.precio);
      setProdStock(product.stock || 0);
      setProdIva(product.iva !== undefined ? product.iva : 21.00);
    } else {
      setProdNombre('');
      setProdRubro('');
      setProdPrecio('');
      setProdStock('0');
      setProdIva(21.00);
    }
    setNewProductModal(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!prodNombre.trim()) {
      alert("El nombre del producto es obligatorio.");
      return;
    }
    if (prodPrecio === '' || parseFloat(prodPrecio) < 0) {
      alert("El precio debe ser un número válido mayor o igual a 0.");
      return;
    }

    setSavingProduct(true);
    try {
      const prodData = {
        nombre: prodNombre.trim(),
        rubro: prodRubro.trim(),
        precio: parseFloat(prodPrecio),
        stock: parseFloat(prodStock || 0),
        iva: parseFloat(prodIva)
      };
      if (editingProduct) {
        prodData.id = editingProduct.id;
      }
      const res = await db.saveProduct(prodData);
      if (res.success) {
        const pr = await db.getProducts();
        setProducts(pr);
        setNewProductModal(false);
      }
    } catch (err) {
      console.error("Error saving product:", err);
      alert("Ocurrió un error al guardar el producto.");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm("¿Estás seguro de que deseas eliminar este producto?")) {
      return;
    }
    try {
      const res = await db.deleteProduct(productId);
      if (res.success) {
        const pr = await db.getProducts();
        setProducts(pr);
      }
    } catch (err) {
      console.error("Error deleting product:", err);
      alert("Ocurrió un error al eliminar el producto.");
    }
  };

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setProductSearch(product.nombre);
    setItemPrice(product.precio);
    setShowProductSuggestions(false);
  };

  const handleAddItem = (e) => {
    e.preventDefault();
    if (!selectedProduct) {
      alert("Por favor selecciona un producto de la lista.");
      return;
    }
    if (itemQty <= 0) {
      alert("La cantidad debe ser mayor a cero.");
      return;
    }

    const newItem = {
      id: Date.now() + Math.random(),
      producto: selectedProduct.nombre,
      cantidad: parseFloat(itemQty),
      valor: parseFloat(itemPrice),
      observacion: itemObs.trim(),
      iva_alicuota: selectedProduct.iva !== undefined ? parseFloat(selectedProduct.iva) : 21.00
    };

    setOrderItems(prev => [...prev, newItem]);
    setProductSearch('');
    setSelectedProduct(null);
    setItemQty(1);
    setItemPrice(0);
    setItemObs('');
    
    // Return focus to the product search input for fast entry
    setTimeout(() => {
      if (productInputRef.current) {
        productInputRef.current.focus();
      }
    }, 50);
  };

  const handleRemoveItem = (itemId) => {
    setOrderItems((prev) => {
      const target = prev.find((item) => item.id === itemId);
      if (target && isDeliveryItem(target)) {
        setConEnvio(false);
      }
      return prev.filter((item) => item.id !== itemId);
    });
  };

  const handleConEnvioChange = (checked) => {
    setConEnvio(checked);
    const envioProduct = findEnvioProduct(products);
    const fee = resolveDeliveryFee(products);
    setDeliveryFee(fee);
    setOrderItems((prev) => {
      const withoutDelivery = prev.filter((item) => !isDeliveryItem(item));
      if (!checked) return withoutDelivery;
      return [...withoutDelivery, createDeliveryItem(fee, envioProduct)];
    });
  };

  const buildWhatsAppOrderMessage = (order) => {
    const totalStr = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(order?.total || 0);
    const confirmLine = order?.con_envio
      ? '✅ Perfecto, se lo llevamos.'
      : '✅ Perfecto, se lo reservamos.';
    return `☀️ Buen día! 👋\n\n${confirmLine}\n\n💰 El total es: ${totalStr}\n\n🙏 Muchas gracias!!`;
  };

  const handleCopyWhatsAppMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setWaCopyFeedback('¡Copiado!');
      setTimeout(() => setWaCopyFeedback(''), 2000);
    } catch {
      setWaCopyFeedback('No se pudo copiar');
      setTimeout(() => setWaCopyFeedback(''), 2000);
    }
  };

  const resetEditOrderForm = () => {
    setEditProductSearch('');
    setEditSelectedProduct(null);
    setEditShowProductSuggestions(false);
    setEditItemQty(1);
    setEditItemPrice(0);
    setEditItemObs('');
  };

  const handleOpenEditOrder = (order) => {
    setEditingOrder(order);
    setEditOrderItems((order.items || []).map((item) => ({
      id: item.id || `tmp_${Date.now()}_${Math.random()}`,
      producto: item.producto,
      cantidad: parseFloat(item.cantidad),
      valor: parseFloat(item.valor),
      observacion: item.observacion || '',
      iva_alicuota: item.iva_alicuota !== undefined ? parseFloat(item.iva_alicuota) : 21.00,
    })));
    resetEditOrderForm();
    setEditOrderModal(true);
  };

  const handleEditOrderItemChange = (itemId, field, value) => {
    setEditOrderItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      if (field === 'cantidad' || field === 'valor') {
        const parsed = parseFloat(value);
        return { ...item, [field]: Number.isFinite(parsed) ? parsed : 0 };
      }
      return { ...item, [field]: value };
    }));
  };

  const handleRemoveEditOrderItem = (itemId) => {
    setEditOrderItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleSelectEditProduct = (product) => {
    setEditSelectedProduct(product);
    setEditProductSearch(product.nombre);
    setEditItemPrice(product.precio);
    setEditShowProductSuggestions(false);
  };

  const handleAddEditOrderItem = (e) => {
    e.preventDefault();
    if (!editSelectedProduct) {
      alert('Por favor selecciona un producto de la lista.');
      return;
    }
    if (editItemQty <= 0) {
      alert('La cantidad debe ser mayor a cero.');
      return;
    }

    setEditOrderItems((prev) => [...prev, {
      id: `tmp_${Date.now()}_${Math.random()}`,
      producto: editSelectedProduct.nombre,
      cantidad: parseFloat(editItemQty),
      valor: parseFloat(editItemPrice),
      observacion: editItemObs.trim(),
      iva_alicuota: editSelectedProduct.iva !== undefined ? parseFloat(editSelectedProduct.iva) : 21.00,
    }]);
    resetEditOrderForm();
  };

  const handleSaveEditOrder = async () => {
    if (!editingOrder || editOrderItems.length === 0) {
      alert('El pedido debe tener al menos un ítem.');
      return;
    }

    const newTotal = editOrderItems.reduce((sum, item) => sum + (item.cantidad * item.valor), 0);
    setEditOrderSaving(true);

    try {
      const res = await db.updatePedido(editingOrder.id, {
        items: editOrderItems,
        total: newTotal,
        cliente_id: editingOrder.cliente_id,
      });

      if (res.success) {
        setEditOrderModal(false);
        setEditingOrder(null);
        setEditOrderItems([]);
        resetEditOrderForm();
        await loadOrders();
        const cl = await db.getClientes();
        setClientes(cl);
      } else {
        alert(res.error || 'No se pudo actualizar el pedido.');
      }
    } catch (err) {
      alert(err.message || 'Error al actualizar el pedido.');
    } finally {
      setEditOrderSaving(false);
    }
  };

  const handleCreateAddress = async (e) => {
    e.preventDefault();
    if (!newAddressText.trim()) return;

    if (!isValidGpsAddress(newAddressText)) {
      const proceed = window.confirm("La dirección parece incompleta o no apta para guía por GPS (se recomienda calle, número y localidad). ¿Desea guardarla de todas formas?");
      if (!proceed) return;
    }

    try {
      const res = await db.saveDireccion(selectedClient.id, newAddressText.trim());
      if (res.success) {
        setNewAddressText('');
        setNewAddressOpen(false);
        const data = await db.getDirecciones(selectedClient.id);
        setAddresses(data);
        setSelectedAddress(res.data.direccion);
      }
    } catch (e) {
      console.error(e);
      alert("Error al agregar dirección");
    }
  };

  const formatCuit = (cuit) => {
    if (!cuit || cuit === 'N/A') return 'N/A';
    const clean = cuit.replace(/[^0-9]/g, '');
    if (clean.length === 11) {
      return `${clean.substring(0, 2)}-${clean.substring(2, 10)}-${clean.substring(10)}`;
    }
    return cuit;
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

  const printThermalTicket = (order, generalObservation = '', phone = '') => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const dateStr = new Date(order.fecha).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const itemsHtml = (order.items || []).map(item => {
      const name = item.producto || 'Producto';
      const qty = item.cantidad || 1;
      const val = item.valor || 0;
      const itemTotal = qty * val;
      const formattedTotal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(itemTotal);
      
      let html = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <div style="flex: 1; padding-right: 5px;">${qty}x ${name}</div>
          <div style="text-align: right; white-space: nowrap;">$ ${formattedTotal}</div>
        </div>
      `;
      if (item.observacion) {
        html += `<div style="font-size: 11px; font-style: italic; margin-left: 15px; margin-bottom: 4px;">* ${item.observacion}</div>`;
      }
      return html;
    }).join('');

    const typeLabel = order.con_envio ? 'DELIVERY' : 'RETIRO EN LOCAL';
    const cleanAddress = cleanAddressText(order.direccion_envio);
    const addressHtml = (order.con_envio && order.direccion_envio)
      ? `<div style="margin-top: 5px;"><strong>Dirección:</strong> ${cleanAddress}</div>`
      : '';

    const formattedTotalSum = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(order.total);

    const observationHtml = generalObservation.trim()
      ? `
        <div class="divider"></div>
        <div style="font-weight: bold; margin-top: 5px;">OBSERVACIONES GENERALES:</div>
        <div style="margin-top: 4px; font-size: 14px; white-space: pre-wrap; font-weight: bold; text-transform: uppercase;">${generalObservation.trim().toUpperCase()}</div>
      `
      : '';

    let waQrUrl = '';
    if (phone.trim()) {
      const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
      if (cleanPhone) {
        const template = localStorage.getItem('whatsapp_template') || "Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!";
        const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(template)}`;
        waQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(waLink)}`;
      }
    }

    let gpsQrUrl = '';
    if (order.con_envio && isValidGpsAddress(order.direccion_envio)) {
      const gmapsUrl = getGmapsUrl(order.direccion_envio);
      gpsQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(gmapsUrl)}`;
    }

    let qrsHtml = '';
    if (waQrUrl && gpsQrUrl) {
      const waQrUrlSmall = waQrUrl.replace('size=120x120', 'size=95x95');
      const gpsQrUrlSmall = gpsQrUrl.replace('size=120x120', 'size=95x95');
      qrsHtml = `
        <div class="divider"></div>
        <div style="display: flex; justify-content: space-around; align-items: flex-start; gap: 5px; margin-top: 10px; margin-bottom: 5px;">
          <div style="text-align: center; flex: 1;">
            <div style="font-weight: bold; font-size: 9px; margin-bottom: 3px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1.1;">ESCANEAR WHATSAPP:</div>
            <img src="${waQrUrlSmall}" width="95" height="95" style="display: block; margin: 0 auto;" />
          </div>
          <div style="text-align: center; flex: 1;">
            <div style="font-weight: bold; font-size: 9px; margin-bottom: 3px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1.1;">ESCANEAR GPS:</div>
            <img src="${gpsQrUrlSmall}" width="95" height="95" style="display: block; margin: 0 auto;" />
          </div>
        </div>
      `;
    } else if (waQrUrl) {
      qrsHtml = `
        <div class="divider"></div>
        <div class="text-center" style="margin-top: 10px; margin-bottom: 5px;">
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 5px;">ESCANEAR PARA ENVIAR WHATSAPP:</div>
          <img src="${waQrUrl}" width="120" height="120" style="display: block; margin: 0 auto;" />
        </div>
      `;
    } else if (gpsQrUrl) {
      qrsHtml = `
        <div class="divider"></div>
        <div class="text-center" style="margin-top: 10px; margin-bottom: 5px;">
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 5px;">ESCANEAR PARA NAVEGAR (GPS):</div>
          <img src="${gpsQrUrl}" width="120" height="120" style="display: block; margin: 0 auto;" />
        </div>
      `;
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <html>
        <head>
          <title>Comanda</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              width: 70mm;
              margin: 0;
              padding: 4mm;
              font-family: 'Courier New', Courier, monospace;
              font-size: 13px;
              line-height: 1.3;
              color: #000;
              background-color: #fff;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .bold { font-weight: bold; }
            .divider { border-top: 1px dashed #000; margin: 8px 0; }
            .header-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
            .total-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-top: 5px; }
          </style>
        </head>
        <body>
          <div class="text-center header-title">COMANDA</div>
          <div class="text-center" style="font-size: 11px; margin-bottom: 5px;">Gestion360i</div>
          <div class="divider"></div>
          <div><strong>Fecha:</strong> ${dateStr}</div>
          <div><strong>Cliente:</strong> ${order.cliente_nombre}</div>
          <div><strong>Tipo:</strong> ${typeLabel}</div>
          ${addressHtml}
          <div class="divider"></div>
          <div style="font-weight: bold; display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>Detalle</span>
            <span>Total</span>
          </div>
          <div class="divider" style="margin-top: 2px;"></div>
          ${itemsHtml}
          <div class="divider"></div>
          <div class="total-row">
            <span>TOTAL:</span>
            <span>$ ${formattedTotalSum}</span>
          </div>
          ${observationHtml}
          ${qrsHtml}
          <div class="divider"></div>
          <div class="text-center" style="margin-top: 15px; font-size: 11px;">
            *** Control de Pedido ***
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Trigger printing once images are loaded or after backup timeout
    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        if (iframe && iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 5000);
    };

    // Backup timeout (2.5 seconds)
    const backupTimeout = setTimeout(triggerPrint, 2500);

    const images = doc.getElementsByTagName('img');
    if (images.length > 0) {
      let loadedCount = 0;
      const onImageLoad = () => {
        loadedCount++;
        if (loadedCount === images.length) {
          clearTimeout(backupTimeout);
          triggerPrint();
        }
      };
      for (let i = 0; i < images.length; i++) {
        if (images[i].complete) {
          onImageLoad();
        } else {
          images[i].onload = onImageLoad;
          images[i].onerror = onImageLoad;
        }
      }
    } else {
      clearTimeout(backupTimeout);
      triggerPrint();
    }
  };

  const handlePrintRequest = (order) => {
    setPrintObsText('');
    setWaCopyFeedback('');
    
    // Attempt to find client's phone number
    let phone = '';
    if (order.cliente_id) {
      const client = clientes.find(c => c.id === order.cliente_id);
      if (client && client.telefono) {
        phone = client.telefono;
      }
    } else if (selectedClient && selectedClient.telefono) {
      phone = selectedClient.telefono;
    }
    
    setPrintObsPhone(phone || '');
    setPrintObsPendingOrder(order);
    setPrintObsModal(true);
  };

  const handlePrintConfirm = (e) => {
    e.preventDefault();
    setPrintObsModal(false);
    if (printObsPendingOrder) {
      try {
        printThermalTicket(printObsPendingOrder, printObsText, printObsPhone);
      } catch (printErr) {
        console.error("Error printing thermal comanda:", printErr);
      }
      setPrintObsPendingOrder(null);
    }
  };

  const handleRegisterOrder = async () => {
    if (orderItems.length === 0) return;
    setLoadingSubmit(true);
    setErrorMsg('');
    setSuccessMsg('');

    const total = orderItems.reduce((sum, item) => sum + (item.cantidad * item.valor), 0);

    const orderData = {
      cliente_id: selectedClient.id,
      total: total,
      con_envio: conEnvio,
      direccion_envio: conEnvio ? selectedAddress : null,
      items: orderItems
    };

    try {
      const res = await db.savePedido(orderData);
      if (res.success) {
        setSuccessMsg('✅ Pedido registrado con éxito.');
        
        // Print comanda ticket immediately
        try {
          handlePrintRequest({
            cliente_nombre: selectedClient.nombre,
            fecha: new Date().toISOString(),
            total: total,
            con_envio: conEnvio,
            direccion_envio: conEnvio ? selectedAddress : null,
            items: [...orderItems]
          });
        } catch (printErr) {
          console.error("Error printing thermal comanda:", printErr);
        }

        setOrderItems([]);
        setConEnvio(false);
        setSelectedAddress('');
        
        const cl = await db.getClientes();
        setClientes(cl);
        setSelectedClient(null);
        setClientSearch('');
        loadOrders();

        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        setErrorMsg('Error al registrar el pedido.');
      }
    } catch (e) {
      setErrorMsg(e.message || 'Error de red al registrar el pedido.');
    } finally {
      setLoadingSubmit(false);
    }
  };

  // --- ORDER LIST SELECTION & BULK ACTIONS ---
  const isToday = (dateStr) => {
    if (!dateStr) return false;
    const orderDate = new Date(dateStr);
    const today = new Date();
    return orderDate.getDate() === today.getDate() &&
           orderDate.getMonth() === today.getMonth() &&
           orderDate.getFullYear() === today.getFullYear();
  };

  const isSameDay = (orderDateStr, targetDateStr) => {
    if (!orderDateStr || !targetDateStr) return false;
    const orderDate = new Date(orderDateStr);
    const [year, month, day] = targetDateStr.split('-').map(Number);
    return orderDate.getDate() === day &&
           orderDate.getMonth() === (month - 1) &&
           orderDate.getFullYear() === year;
  };

  const getHoyButtonLabel = () => {
    const today = new Date();
    const todayDDMM = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    if (dateFilter === 'custom' && customDate) {
      const [y, m, d] = customDate.split('-').map(Number);
      const customDDMM = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
      
      const isCustomToday = d === today.getDate() && (m - 1) === today.getMonth() && y === today.getFullYear();
      if (!isCustomToday) {
        return customDDMM;
      }
    }
    return `Hoy (${todayDDMM})`;
  };

  const getHoyButtonCount = () => {
    if (dateFilter === 'custom' && customDate) {
      return orders.filter(o => isSameDay(o.fecha, customDate)).length;
    }
    return orders.filter(o => isToday(o.fecha)).length;
  };

  const dateFilteredOrders = orders.filter(o => {
    if (dateFilter === 'today') {
      return isToday(o.fecha);
    }
    if (dateFilter === 'custom' && customDate) {
      return isSameDay(o.fecha, customDate);
    }
    return true; // 'all'
  });

  const activeOrdersForType = (delivery) =>
    dateFilteredOrders.filter((o) => o.con_envio === delivery && !isOrderCancelled(o));

  const cancelledOrdersForType = (delivery) =>
    dateFilteredOrders.filter((o) => o.con_envio === delivery && isOrderCancelled(o));

  const filteredOrders = dateFilteredOrders.filter(o => {
    // Apply type filter (delivery / local)
    if (typeFilter === 'delivery' && !o.con_envio) return false;
    if (typeFilter === 'local' && o.con_envio) return false;

    const estLower = getOrderShippingEstadoLower(o);
    const cancelled = isOrderCancelled(o);

    if (statusFilter === 'cancelados') {
      return cancelled;
    }
    if (cancelled) return false;

    // Apply status filter
    if (statusFilter === 'pendiente' && estLower !== 'pendiente') return false;
    if (statusFilter === 'en_reparto' && estLower !== 'en reparto' && estLower !== 'en viaje' && estLower !== 'repartiendo') return false;
    if (statusFilter === 'entregado' && estLower !== 'entregado') return false;
    if (statusFilter === 'finalizado' && !isOrderFinalizado(o)) return false;
    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (orderSortField === 'fecha') {
      comparison = new Date(a.fecha) - new Date(b.fecha);
    } else if (orderSortField === 'cliente') {
      comparison = (a.cliente_nombre || '').localeCompare(b.cliente_nombre || '');
    } else if (orderSortField === 'tipo') {
      const aTipo = a.con_envio ? 'Delivery' : 'Local';
      const bTipo = b.con_envio ? 'Delivery' : 'Local';
      comparison = aTipo.localeCompare(bTipo);
    } else if (orderSortField === 'estado') {
      comparison = getOrderShippingEstadoLower(a).localeCompare(getOrderShippingEstadoLower(b));
    } else if (orderSortField === 'detalles') {
      const aDet = (a.direccion_envio || '') + (a.repartidor || '') + (a.medio_pago || '');
      const bDet = (b.direccion_envio || '') + (b.repartidor || '') + (b.medio_pago || '');
      comparison = aDet.localeCompare(bDet);
    } else if (orderSortField === 'total') {
      comparison = parseFloat(a.total || 0) - parseFloat(b.total || 0);
    }
    return orderSortAsc ? comparison : -comparison;
  });

  const isSelectionEnabled = typeFilter !== null && statusFilter !== null && statusFilter !== 'cancelados';
  const showShippingColumn = statusFilter === null;

  const handleSelectOrder = (id) => {
    if (!isSelectionEnabled) return; // Disable selections unless both filters are selected
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(oid => oid !== id) : [...prev, id]
    );
  };

  const handleSelectAllOrders = () => {
    if (!isSelectionEnabled) return; // Disable selections unless both filters are selected
    const visibleOrderIds = filteredOrders.map(o => o.id);
    if (selectedOrderIds.length === visibleOrderIds.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(visibleOrderIds);
    }
  };

  // Check types of selected orders
  const selectedOrdersData = filteredOrders.filter(o => selectedOrderIds.includes(o.id));
  const hasDeliverySelected = selectedOrdersData.some(o => o.con_envio === true);
  const hasLocalSelected = selectedOrdersData.some(o => o.con_envio === false);

  const applyBulkStatus = async (updates) => {
    setLoadingSubmit(true);
    try {
      const res = await db.updatePedidosStatus(selectedOrderIds, updates);
      if (res.success) {
        setSelectedOrderIds([]);
        loadOrders(); // Reload orders list
        
        // Reload client lists to update balances globally
        const cl = await db.getClientes();
        setClientes(cl);
      }
    } catch (e) {
      console.error(e);
      alert("Error al aplicar cambios masivos");
    } finally {
      setLoadingSubmit(false);
    }
  };

  const openBulkRepartidorModal = () => {
    setBulkRepartidorName(repartidores[0] || '');
    setBulkRepartidorModal(true);
  };

  const handleBulkRepartir = (e) => {
    e.preventDefault();
    if (!bulkRepartidorName.trim()) return;
    
    setBulkRepartidorModal(false);
    applyBulkStatus({
      estado: 'En reparto',
      repartidor: bulkRepartidorName.trim()
    });
    setBulkRepartidorName('');
  };

  const handleBulkPaymentConfirm = async (e) => {
    e.preventDefault();
    setBulkPaymentModal(false);
    setLoadingSubmit(true);
    
    try {
      for (const id of selectedOrderIds) {
        const order = orders.find(o => o.id === id);
        const orderPaymentMethod = bulkOrdersPayments[id] || 'Efectivo';
        const updates = { medio_pago: orderPaymentMethod };
        // Preservar estado de envío; corregir registros legacy con estado "Pagado"
        if (order && normalizeOrderEstado(order) === 'pagado') {
          updates.estado = getOrderShippingEstado(order);
        }
        await db.updatePedidosStatus([id], updates);
      }
      
      setSelectedOrderIds([]);
      await loadOrders();

      const cl = await db.getClientes();
      setClientes(cl);
    } catch (err) {
      console.error(err);
      alert("Error al registrar los cobros individuales.");
    } finally {
      setLoadingSubmit(false);
    }
  };

  const triggerBulkCobrarRendir = () => {
    const initialPayments = {};
    selectedOrderIds.forEach(id => {
      const order = orders.find(o => o.id === id);
      initialPayments[id] = order?.medio_pago || 'Efectivo';
    });
    setBulkOrdersPayments(initialPayments);
    setBulkPaymentModal(true);
  };

  const handleOpenCobrarOrder = (order) => {
    setSelectedOrderIds([order.id]);
    setBulkOrdersPayments({ [order.id]: order.medio_pago || 'Efectivo' });
    setBulkPaymentModal(true);
  };

  const triggerBulkCancel = () => {
    setCancelMotiveText('');
    setCancelMotiveModal(true);
  };

  const handleBulkCancelConfirm = async (e) => {
    e.preventDefault();
    if (!cancelMotiveText.trim()) return;
    setCancelMotiveModal(false);
    
    setLoadingSubmit(true);
    try {
      const res = await db.updatePedidosStatus(selectedOrderIds, {
        estado: 'Cancelado',
        motivo_cancelacion: cancelMotiveText.trim()
      });
      if (res.success) {
        setSelectedOrderIds([]);
        setCancelMotiveText('');
        await loadOrders();
        const cl = await db.getClientes();
        setClientes(cl);
        const pr = await db.getProducts();
        setProducts(pr);
        setStatusFilter('cancelados');
      } else {
        alert(res.error || 'Error al cancelar pedidos.');
      }
    } catch (err) {
      console.error(err);
      alert("Error al cancelar pedidos.");
    } finally {
      setLoadingSubmit(false);
    }
  };

  // --- REPORT CALCULATIONS ---
  const reportOrders = dateFilteredOrders.filter((o) => {
    if (typeFilter === 'delivery' && !o.con_envio) return false;
    if (typeFilter === 'local' && o.con_envio) return false;
    return !isOrderCancelled(o);
  });

  const totalSoldSum = reportOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

  // Sales by payment method (never includes cancelled orders)
  const salesByMethod = { Pendiente: 0 };

  enabledPaymentMethods.forEach((concept) => {
    salesByMethod[getPaymentMethodValue(concept)] = 0;
  });
  if (salesByMethod.Efectivo === undefined) {
    salesByMethod.Efectivo = 0;
  }

  reportOrders.forEach(o => {
    const total = parseFloat(o.total || 0);

    const cobroEstado = getOrderCobroEstado(o);
    if (cobroEstado === 'PENDIENTE') {
      salesByMethod.Pendiente += total;
    } else {
      const method = resolveMedioPagoKey(o.medio_pago);
      if (salesByMethod[method] !== undefined) {
        salesByMethod[method] += total;
      } else {
        salesByMethod.Efectivo += total;
      }
    }
  });

  // Subtract daily refunds from the payment breakdown
  dailyRefunds.forEach(r => {
    let method = 'Efectivo';
    const match = r.concepto.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      method = resolveMedioPagoKey(match[1]);
    }

    const amt = parseFloat(r.debe || 0);
    if (salesByMethod[method] !== undefined) {
      salesByMethod[method] -= amt;
    } else {
      salesByMethod.Efectivo -= amt;
    }
  });

  // Autocomplete filters
  const filteredClientes = clientSearch.trim() === ''
    ? []
    : clientes.filter(c => 
        c.nombre.toLowerCase().includes(clientSearch.toLowerCase()) ||
        (c.cuit && c.cuit.includes(clientSearch))
      );

  const filteredProducts = productSearch.trim() === ''
    ? []
    : products.filter(p => p.nombre.toLowerCase().includes(productSearch.toLowerCase()));

  // Sum total register order
  const orderTotalSum = orderItems.reduce((sum, item) => sum + (item.cantidad * item.valor), 0);

  const hasClientMatch = selectedClient && selectedClient.nombre.toLowerCase().startsWith(clientSearch.toLowerCase());
  const clientAutocompleteSuffix = hasClientMatch 
    ? selectedClient.nombre.substring(clientSearch.length) 
    : '';

  const hasProductMatch = selectedProduct && selectedProduct.nombre.toLowerCase().startsWith(productSearch.toLowerCase());
  const productAutocompleteSuffix = hasProductMatch 
    ? selectedProduct.nombre.substring(productSearch.length) 
    : '';

  return (
    <div className="page-card" style={{ borderLeft: '5px solid ' + (accentColor || '#8b5cf6') }}>
      
      {/* TABS HEADER: REGISTRAR VS VER PEDIDOS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid var(--border-color)', paddingBottom: '12px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="bi bi-journal-text" style={{ color: accentColor || '#8b5cf6' }}></i>
          {viewMode === 'register' ? 'Cargar Pedido' : viewMode === 'orders' ? 'Listado de Pedidos' : viewMode === 'repartidores' ? 'Repartidores' : viewMode === 'products' ? 'Inventario de Productos' : 'Gestión de Clientes'}
        </h2>
        
        <div className="flex-row-group">
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'register' ? (accentColor || '#8b5cf6') : 'transparent',
              color: viewMode === 'register' ? '#ffffff' : (accentColor || '#8b5cf6'),
              border: '1px solid ' + (accentColor || '#8b5cf6')
            }}
            onClick={() => setViewMode('register')}
          >
            <i className="bi bi-journal-plus me-1"></i> Cargar Pedido
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'orders' ? (accentColor || '#8b5cf6') : 'transparent',
              color: viewMode === 'orders' ? '#ffffff' : (accentColor || '#8b5cf6'),
              border: '1px solid ' + (accentColor || '#8b5cf6')
            }}
            onClick={() => setViewMode('orders')}
          >
            <i className="bi bi-journal-text me-1"></i> Ver Pedidos ({orders.filter(o => isToday(o.fecha)).length})
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'products' ? '#10b981' : 'transparent',
              color: viewMode === 'products' ? '#ffffff' : '#10b981',
              border: '1px solid #10b981'
            }}
            onClick={() => setViewMode('products')}
          >
            <i className="bi bi-tags me-1"></i> Productos / Stock
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'clients' ? '#10b981' : 'transparent',
              color: viewMode === 'clients' ? '#ffffff' : '#10b981',
              border: '1px solid #10b981'
            }}
            onClick={() => setViewMode('clients')}
          >
            <i className="bi bi-people me-1"></i> Clientes
          </button>
          <button 
            type="button" 
            className="btn-new-task"
            style={{ 
              backgroundColor: viewMode === 'repartidores' ? '#2563eb' : 'transparent',
              color: viewMode === 'repartidores' ? '#ffffff' : '#2563eb',
              border: '1px solid #2563eb'
            }}
            onClick={() => setViewMode('repartidores')}
          >
            <i className="bi bi-truck me-1"></i> Repartidores ({repartidores.length})
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* VIEW: REGISTER ORDER                                           */}
      {/* ============================================================== */}
      {viewMode === 'register' && (
        <div>
          {/* SEARCH CLIENT & REGISTER CLIENT */}
          <div className="form-group mb-4">
            <label className="form-label">Cliente</label>
            <div className="flex-row-group" ref={clientRef}>
              <div className="autocomplete-container flex-grow-1" style={{ position: 'relative' }}>
                <div className="flex-row-group" style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
                  <input 
                    ref={clientInputRef}
                    type="text" 
                    className="form-input" 
                    placeholder="Buscar por nombre o CUIT..."
                    value={clientSearch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setClientSearch(val);
                      setShowClientSuggestions(true);
                      
                      if (val.trim() === '') {
                        setSelectedClient(null);
                      } else {
                        // Find first match dynamically to select it automatically
                        const matches = clientes.filter(c => 
                          c.nombre.toLowerCase().includes(val.toLowerCase()) ||
                          (c.cuit && c.cuit.includes(val))
                        );
                        if (matches.length > 0) {
                          setSelectedClient(matches[0]);
                        } else {
                          setSelectedClient(null);
                        }
                      }
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (selectedClient) {
                          handleSelectClient(selectedClient);
                          // Shift focus to the product search input
                          setTimeout(() => {
                            if (productInputRef.current) {
                              productInputRef.current.focus();
                            }
                          }, 50);
                        }
                      }
                    }}
                  />
                  {clientSearch.trim() !== '' && clientAutocompleteSuffix && (
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
                      <span style={{ color: 'transparent' }}>{clientSearch}</span>
                      <span>{clientAutocompleteSuffix}</span>
                    </div>
                  )}
                  {selectedClient && (
                    <button 
                      type="button" 
                      className="btn-nav-back"
                      style={{ padding: '8px 10px', color: '#ef4444', border: 'none', zIndex: 3 }}
                      onClick={() => {
                        setSelectedClient(null);
                        setClientSearch('');
                      }}
                    >
                      <i className="bi bi-x-circle-fill"></i>
                    </button>
                  )}
                </div>
 
                {showClientSuggestions && filteredClientes.length > 0 && (
                  <ul className="suggestions-list">
                    {filteredClientes.map((c, idx) => (
                      <li 
                        key={c.id} 
                        className="suggestion-item text-start"
                        style={{ backgroundColor: idx === 0 ? '#f5f3ff' : 'transparent', borderLeft: idx === 0 ? '3px solid #8b5cf6' : 'none' }}
                        onClick={() => handleSelectClient(c)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '1.15rem' }}>{c.nombre}</strong>
                        </div>
                        <span className="suggestion-meta">CUIT: {formatCuit(c.cuit)} | Raz. Social: {c.razon_social}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button 
                type="button" 
                className="btn-new-task" 
                style={{ backgroundColor: '#475569', padding: '10px 14px', height: '42px', flexShrink: 0 }}
                onClick={() => {
                  setImportClientesModal(true);
                  resetImportMapping();
                }}
              >
                <i className="bi bi-file-earmark-spreadsheet me-1"></i> Importar CSV
              </button>

              <button 
                type="button" 
                className="btn-new-task" 
                style={{ backgroundColor: '#8b5cf6', padding: '10px 14px', height: '42px', flexShrink: 0 }}
                onClick={() => setNewClientModal(true)}
              >
                <i className="bi bi-person-plus-fill me-1"></i> + Nuevo
              </button>
            </div>
          </div>

          {/* LEDGER DRAWER & BALANCE */}
          {selectedClient && (
            <div className="info-row">
              <button 
                type="button" 
                className="btn-new-task" 
                style={{ backgroundColor: '#64748b' }}
                onClick={handleOpenDrawer}
              >
                <i className="bi bi-clock-history me-1"></i> Ver Movimientos
              </button>
              
              <div style={{ textAlign: 'right' }}>
                <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.7rem' }}>Saldo deudor:</span>
                <div className={`saldo-display ${selectedClient.saldo > 0 ? 'saldo-deudor' : 'saldo-favor'}`}>
                  $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(selectedClient.saldo)}
                </div>
              </div>
            </div>
          )}

          {/* PEDIDO CARGO DETAILS FORM */}
          {selectedClient ? (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px dashed var(--border-color)' }}>
              <h4 className="text-dark fw-bold mb-3" style={{ fontSize: '1.1rem' }}>Cargar Nuevo Pedido</h4>
              
              {/* Formulario de Carga del Ítem */}
              <form onSubmit={handleAddItem} className="page-card" style={{ padding: '15px', backgroundColor: '#f8fafc', borderStyle: 'solid', borderWidth: '1px', marginBottom: '20px' }}>
                <div className="row mb-3" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px' }}>
                  
                  {/* Product selector autocompletable */}
                  <div className="form-group" ref={productRef} style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Producto</label>
                    <div className="autocomplete-container" style={{ position: 'relative' }}>
                      <input 
                        ref={productInputRef}
                        type="text" 
                        className="form-input" 
                        style={{ fontSize: '0.85rem', padding: '8px' }}
                        placeholder="Buscar producto..."
                        value={productSearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProductSearch(val);
                          setShowProductSuggestions(true);
                          
                          if (val.trim() === '') {
                            setSelectedProduct(null);
                            setItemPrice(0);
                          } else {
                            // Find first match dynamically
                            const matches = products.filter(p => 
                              p.nombre.toLowerCase().includes(val.toLowerCase())
                            );
                            if (matches.length > 0) {
                              setSelectedProduct(matches[0]);
                              setItemPrice(matches[0].precio);
                            } else {
                              setSelectedProduct(null);
                              setItemPrice(0);
                            }
                          }
                        }}
                        onFocus={() => setShowProductSuggestions(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (selectedProduct) {
                              handleSelectProduct(selectedProduct);
                              // Shift focus to the Quantity input
                              setTimeout(() => {
                                if (qtyInputRef.current) {
                                  qtyInputRef.current.focus();
                                }
                              }, 50);
                            }
                          }
                        }}
                        required
                      />
                      {productSearch.trim() !== '' && productAutocompleteSuffix && (
                        <div style={{
                          position: 'absolute',
                          left: '9.5px', // 8px padding + 1.5px border
                          top: '50%',
                          transform: 'translateY(-50%)',
                          pointerEvents: 'none',
                          fontFamily: 'inherit',
                          fontSize: '0.85rem',
                          color: '#a1a1aa',
                          whiteSpace: 'pre',
                          display: 'flex',
                          alignItems: 'center',
                          zIndex: 2
                        }}>
                          <span style={{ color: 'transparent' }}>{productSearch}</span>
                          <span>{productAutocompleteSuffix}</span>
                        </div>
                      )}
                      {showProductSuggestions && filteredProducts.length > 0 && (
                        <ul className="suggestions-list" style={{ zIndex: 110 }}>
                          {filteredProducts.map((p, idx) => (
                            <li 
                              key={p.id} 
                              className="suggestion-item text-start"
                              style={{ 
                                padding: '8px 10px', 
                                fontSize: '0.85rem',
                                backgroundColor: idx === 0 ? '#f5f3ff' : 'transparent',
                                borderLeft: idx === 0 ? '3px solid #8b5cf6' : 'none'
                              }}
                              onClick={() => handleSelectProduct(p)}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong>{p.nombre}</strong>
                                <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', backgroundColor: '#e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                                  {p.rubro || 'General'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: '3px', color: 'var(--text-muted)' }}>
                                <span>Precio: ${p.precio}</span>
                                <span>Stock: {p.stock !== undefined ? p.stock : 'N/A'}</span>
                                <span>IVA: {p.iva !== undefined ? `${p.iva}%` : '21%'}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Cant.</label>
                    <input 
                      ref={qtyInputRef}
                      type="number" 
                      className="form-input text-end input-no-spinner" 
                      style={{ fontSize: '0.85rem', padding: '8px' }}
                      min="0.01" 
                      step="any"
                      value={itemQty}
                      onChange={(e) => setItemQty(e.target.value)}
                      onKeyDown={handleNumericKeyDown}
                      required
                    />
                  </div>

                  {/* Price */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Val. Unit</label>
                    <input 
                      type="number" 
                      className="form-input text-end input-no-spinner" 
                      style={{ fontSize: '0.85rem', padding: '8px' }}
                      min="0" 
                      step="any"
                      value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value)}
                      onKeyDown={handleNumericKeyDown}
                      required
                    />
                  </div>
                </div>

                {/* Obs & Button */}
                <div className="form-group mb-3">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Observación / Detalle</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    style={{ fontSize: '0.85rem', padding: '8px' }}
                    placeholder="Ej: Embalaje especial, Oferta..."
                    value={itemObs}
                    onChange={(e) => setItemObs(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn-submit" style={{ padding: '8px', fontSize: '0.85rem', backgroundColor: '#8b5cf6' }}>
                  <i className="bi bi-plus-lg me-1"></i> Agregar al Pedido
                </button>
              </form>

              {/* List of Added Items */}
              {orderItems.length > 0 ? (
                <div style={{ marginBottom: '25px' }}>
                  <label className="form-label">Ítems cargados en el pedido</label>
                  <div className="order-item-list">
                    {orderItems.map(item => (
                      <div key={item.id} className="order-item-row">
                        <div style={{ textAlign: 'left', flexGrow: 1, paddingRight: '10px' }}>
                          <span className="order-item-desc">
                            {item.cantidad}x {item.producto}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '6px', backgroundColor: '#e2e8f0', padding: '1px 5px', borderRadius: '4px' }}>
                              IVA {item.iva_alicuota !== undefined ? `${item.iva_alicuota}%` : '21%'}
                            </span>
                          </span>
                          {item.observacion && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>({item.observacion})</div>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                          <span className="order-item-price">$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(item.cantidad * item.valor)}</span>
                          <button 
                            type="button" 
                            className="btn-nav-back" 
                            style={{ padding: '4px 8px', color: '#ef4444', border: 'none' }}
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <i className="bi bi-trash-fill"></i>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted p-4 small" style={{ border: '1px dashed var(--border-color)', borderRadius: '8px', backgroundColor: '#f8fafc', marginBottom: '20px' }}>
                  El pedido está vacío. Carga productos arriba para comenzar.
                </div>
              )}

              {/* Total, Shipping and Submit Button (Always at the bottom of the card) */}
              <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', padding: '0 5px' }}>
                  <span className="fw-bold text-dark text-uppercase">TOTAL FINAL:</span>
                  <span className="fs-4 fw-bold" style={{ color: '#1e293b', fontSize: '1.5rem' }}>
                    $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(orderTotalSum)}
                  </span>
                </div>

                {orderItems.length > 0 && (
                  <div className="page-card" style={{ padding: '15px', borderStyle: 'solid', borderWidth: '1px', marginBottom: '20px', backgroundColor: '#faf5ff', borderColor: '#e9d5ff' }}>
                    <div className="form-check form-switch mb-3" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input 
                        type="checkbox" 
                        className="task-checkbox" 
                        style={{ width: '22px', height: '22px', margin: 0 }}
                        id="checkEnvio"
                        checked={conEnvio}
                        onChange={(e) => handleConEnvioChange(e.target.checked)}
                      />
                      <label className="form-check-label fw-bold text-dark" htmlFor="checkEnvio" style={{ cursor: 'pointer' }}>
                        <i className="bi bi-truck me-1 text-primary"></i> Delivery
                        <span style={{ fontWeight: '500', color: 'var(--text-muted)', marginLeft: '6px', fontSize: '0.85rem' }}>
                          (+ $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(deliveryFee)} envío)
                        </span>
                      </label>
                    </div>

                    {conEnvio && (
                      <div>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Dirección de Entrega</label>
                        <div className="flex-row-group mb-2" style={{ flexWrap: 'wrap', gap: '8px' }}>
                          <select 
                            className="form-select"
                            style={{ fontSize: '0.9rem', flex: 1, minWidth: '150px' }}
                            value={selectedAddress}
                            onChange={(e) => setSelectedAddress(e.target.value)}
                            required={conEnvio}
                          >
                            {addresses.length > 0 ? (
                              addresses.map(d => (
                                <option key={d.id} value={d.direccion}>{cleanAddressText(d.direccion)}</option>
                              ))
                            ) : (
                              <option value="" disabled>(Sin direcciones registradas)</option>
                            )}
                          </select>

                          {selectedAddress && isValidGpsAddress(selectedAddress) && (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <a
                                href={getGmapsUrl(selectedAddress)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-nav-back"
                                style={{ padding: '8px 10px', fontSize: '0.9rem', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, textDecoration: 'none', backgroundColor: '#f1f5f9' }}
                                title="Ver en Google Maps"
                              >
                                🗺️
                              </a>
                              <button
                                type="button"
                                className="btn-nav-back"
                                style={{ padding: '8px 10px', fontSize: '0.9rem', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, backgroundColor: '#f1f5f9' }}
                                onClick={() => {
                                  const gmapsUrl = getGmapsUrl(selectedAddress);
                                  setLocationQrData({
                                    address: cleanAddressText(selectedAddress),
                                    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(gmapsUrl)}`
                                  });
                                  setShowLocationQrModal(true);
                                }}
                                title="Mostrar Código QR de Ubicación"
                              >
                                📱
                              </button>
                            </div>
                          )}

                          <button 
                            type="button" 
                            className="btn-new-task"
                            style={{ backgroundColor: '#8b5cf6', flexShrink: 0, margin: 0 }}
                            onClick={() => setNewAddressOpen(!newAddressOpen)}
                          >
                            {newAddressOpen ? 'Cancelar' : '+ Nueva'}
                          </button>
                        </div>

                        {newAddressOpen && (
                          <form onSubmit={handleCreateAddress} className="flex-row-group mt-2">
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{ fontSize: '0.85rem', padding: '8px', flex: 1 }}
                              placeholder="Nueva calle, número, localidad..."
                              value={newAddressText}
                              onChange={(e) => setNewAddressText(e.target.value)}
                              required
                            />
                            <button type="submit" className="btn-new-task" style={{ backgroundColor: '#10b981', margin: 0 }}>
                              Guardar
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Buttons */}
                <div style={{ marginTop: '10px' }}>
                  {successMsg && (
                    <div className="alert-box-success" style={{ marginBottom: '15px' }}>
                      <i className="bi bi-check-circle-fill"></i>
                      <div>{successMsg}</div>
                    </div>
                  )}
                  {errorMsg && (
                    <div className="alert-box" style={{ marginBottom: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                      <i className="bi bi-exclamation-circle-fill"></i>
                      <div>{errorMsg}</div>
                    </div>
                  )}
                  <button 
                    type="button" 
                    className="btn-submit"
                    style={{ 
                      backgroundColor: orderItems.length > 0 ? '#8b5cf6' : '#cbd5e1',
                      color: orderItems.length > 0 ? 'white' : '#64748b',
                      cursor: orderItems.length > 0 ? 'pointer' : 'not-allowed',
                      padding: '14px', 
                      fontSize: '1.05rem' 
                    }}
                    onClick={handleRegisterOrder}
                    disabled={loadingSubmit || orderItems.length === 0}
                  >
                    {loadingSubmit ? (
                      <span><i className="bi bi-hourglass-split me-2"></i>Registrando...</span>
                    ) : (
                      <span><i className="bi bi-journal-plus me-2"></i>CONFIRMAR REGISTRO DE PEDIDO</span>
                    )}
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <div className="text-center text-muted p-5 small" style={{ border: '1.5px dashed var(--border-color)', borderRadius: '12px' }}>
              <i className="bi bi-person-check text-secondary" style={{ fontSize: '2.5rem', opacity: 0.6 }}></i>
              <div style={{ marginTop: '10px' }}>Selecciona un cliente arriba para cargar un pedido o ver su cuenta.</div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW: OPEN ORDERS PANEL (VER PEDIDOS)                          */}
      {/* ============================================================== */}
      {viewMode === 'orders' && (
        <div>
          {/* Order State Filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px', backgroundColor: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            {/* Filter Line 1: Fecha y Tipo */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '30px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              {/* Fecha block */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', marginRight: '10px' }}>Fecha:</span>
                <button 
                  type="button" 
                  className={`btn-new-task ${dateFilter === 'all' ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: dateFilter === 'all' ? '#8b5cf6' : 'white',
                    color: dateFilter === 'all' ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 12px',
                    fontSize: '0.8rem'
                  }}
                  onClick={() => {
                    setDateFilter('all');
                    setSelectedOrderIds([]);
                  }}
                >
                  <i className="bi bi-calendar-range me-1"></i> Todos ({orders.length})
                </button>
                <button 
                  type="button" 
                  className={`btn-new-task ${dateFilter === 'today' || dateFilter === 'custom' ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: (dateFilter === 'today' || dateFilter === 'custom') ? '#8b5cf6' : 'white',
                    color: (dateFilter === 'today' || dateFilter === 'custom') ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 12px',
                    fontSize: '0.8rem'
                  }}
                  onClick={() => {
                    if (dateFilter === 'all') {
                      setDateFilter('today');
                    }
                    setSelectedOrderIds([]);
                    if (dateInputRef.current) {
                      try {
                        dateInputRef.current.showPicker();
                      } catch (e) {
                        dateInputRef.current.click();
                      }
                    }
                  }}
                >
                  <i className="bi bi-calendar-event me-1"></i> {getHoyButtonLabel()} ({getHoyButtonCount()})
                </button>
                <input 
                  type="date"
                  ref={dateInputRef}
                  style={{ 
                    position: 'absolute',
                    opacity: 0,
                    width: 0,
                    height: 0,
                    pointerEvents: 'none'
                  }}
                  value={dateFilter === 'custom' ? customDate : (() => {
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                  })()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      const today = new Date();
                      const year = today.getFullYear();
                      const month = String(today.getMonth() + 1).padStart(2, '0');
                      const day = String(today.getDate()).padStart(2, '0');
                      const todayStr = `${year}-${month}-${day}`;
                      
                      if (val === todayStr) {
                        setDateFilter('today');
                      } else {
                        setDateFilter('custom');
                        setCustomDate(val);
                      }
                      setSelectedOrderIds([]);
                    }
                  }}
                />
              </div>

              {/* Vertical Divider */}
              <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }}></div>

              {/* Tipo block */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', marginRight: '10px' }}>Tipo:</span>
                <button 
                  type="button" 
                  className={`btn-new-task ${typeFilter === null ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: typeFilter === null ? '#64748b' : 'white',
                    color: typeFilter === null ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 12px',
                    fontSize: '0.8rem'
                  }}
                  onClick={() => {
                    setTypeFilter(null);
                    setStatusFilter(null);
                    setSelectedOrderIds([]);
                  }}
                >
                  <i className="bi bi-grid-fill me-1"></i> Todos ({dateFilteredOrders.length})
                </button>
                <button 
                  type="button" 
                  className={`btn-new-task ${typeFilter === 'delivery' ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: typeFilter === 'delivery' ? '#3b82f6' : 'white',
                    color: typeFilter === 'delivery' ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 12px',
                    fontSize: '0.8rem'
                  }}
                  onClick={() => {
                    setTypeFilter(typeFilter === 'delivery' ? null : 'delivery');
                    setStatusFilter(null);
                    setSelectedOrderIds([]);
                  }}
                >
                  <i className="bi bi-truck me-1"></i> Delivery ({activeOrdersForType(true).length})
                </button>
                <button 
                  type="button" 
                  className={`btn-new-task ${typeFilter === 'local' ? 'active' : ''}`}
                  style={{ 
                    backgroundColor: typeFilter === 'local' ? '#14b8a6' : 'white',
                    color: typeFilter === 'local' ? 'white' : 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 12px',
                    fontSize: '0.8rem'
                  }}
                  onClick={() => {
                    setTypeFilter(typeFilter === 'local' ? null : 'local');
                    setStatusFilter(null);
                    setSelectedOrderIds([]);
                  }}
                >
                  <i className="bi bi-shop me-1"></i> Local ({activeOrdersForType(false).length})
                </button>
              </div>
            </div>

            {/* Filter Row 2: Estado */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', marginRight: '10px' }}>Envío:</span>
              {typeFilter === null ? (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Selecciona Delivery o Local para ver filtros de estado y habilitar selección múltiple.
                </span>
              ) : typeFilter === 'delivery' ? (
                <>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === null ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === null ? '#8b5cf6' : 'white',
                      color: statusFilter === null ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(null);
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-grid-fill me-1"></i> Todos ({activeOrdersForType(true).length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'pendiente' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'pendiente' ? '#8b5cf6' : 'white',
                      color: statusFilter === 'pendiente' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'pendiente' ? null : 'pendiente');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-clock me-1"></i> Pendientes ({dateFilteredOrders.filter(o => o.con_envio && !isOrderCancelled(o) && getOrderShippingEstadoLower(o) === 'pendiente').length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'en_reparto' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'en_reparto' ? '#f97316' : 'white',
                      color: statusFilter === 'en_reparto' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'en_reparto' ? null : 'en_reparto');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-compass me-1"></i> En reparto ({dateFilteredOrders.filter(o => o.con_envio && ['en reparto', 'en viaje', 'repartiendo'].includes(getOrderShippingEstadoLower(o))).length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'entregado' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'entregado' ? '#10b981' : 'white',
                      color: statusFilter === 'entregado' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'entregado' ? null : 'entregado');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-check-circle me-1"></i> Entregados ({dateFilteredOrders.filter(o => o.con_envio && getOrderShippingEstadoLower(o) === 'entregado').length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'finalizado' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'finalizado' ? '#059669' : 'white',
                      color: statusFilter === 'finalizado' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'finalizado' ? null : 'finalizado');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-check-circle-fill me-1"></i> Finalizados ({dateFilteredOrders.filter(o => o.con_envio && !isOrderCancelled(o) && isOrderFinalizado(o)).length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'cancelados' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'cancelados' ? '#64748b' : 'white',
                      color: statusFilter === 'cancelados' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'cancelados' ? null : 'cancelados');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-x-circle me-1"></i> Cancelados ({cancelledOrdersForType(true).length})
                  </button>
                </>
              ) : (
                <>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === null ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === null ? '#8b5cf6' : 'white',
                      color: statusFilter === null ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(null);
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-grid-fill me-1"></i> Todos ({activeOrdersForType(false).length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'pendiente' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'pendiente' ? '#8b5cf6' : 'white',
                      color: statusFilter === 'pendiente' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'pendiente' ? null : 'pendiente');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-clock me-1"></i> Pendientes ({dateFilteredOrders.filter(o => !o.con_envio && !isOrderCancelled(o) && getOrderShippingEstadoLower(o) === 'pendiente').length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'finalizado' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'finalizado' ? '#059669' : 'white',
                      color: statusFilter === 'finalizado' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'finalizado' ? null : 'finalizado');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-check-circle-fill me-1"></i> Finalizados ({dateFilteredOrders.filter(o => !o.con_envio && !isOrderCancelled(o) && isOrderFinalizado(o)).length})
                  </button>
                  <button 
                    type="button" 
                    className={`btn-new-task ${statusFilter === 'cancelados' ? 'active' : ''}`}
                    style={{ 
                      backgroundColor: statusFilter === 'cancelados' ? '#64748b' : 'white',
                      color: statusFilter === 'cancelados' ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      padding: '6px 12px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => {
                      setStatusFilter(statusFilter === 'cancelados' ? null : 'cancelados');
                      setSelectedOrderIds([]);
                    }}
                  >
                    <i className="bi bi-x-circle me-1"></i> Cancelados ({cancelledOrdersForType(false).length})
                  </button>
                </>
              )}
            </div>
          </div>

          {/* BULK ACTIONS HEADER PANEL (Only shown if at least one order is selected AND selection is enabled) */}
          {selectedOrderIds.length > 0 && isSelectionEnabled && (
            <div className="page-card" style={{ padding: '15px', backgroundColor: '#f5f3ff', borderColor: '#ddd6fe', borderWidth: '1.5px', marginBottom: '20px', borderStyle: 'solid', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#5b21b6' }}>
                  <i className="bi bi-check2-square me-1"></i> {selectedOrderIds.length} Pedidos Seleccionados
                </span>
                <button 
                  type="button" 
                  className="btn-nav-back" 
                  style={{ padding: '2px 8px', color: '#6b7280', fontSize: '0.8rem', border: 'none' }}
                  onClick={() => setSelectedOrderIds([])}
                >
                  Deseleccionar Todos
                </button>
              </div>
              
              {/* Dynamic bulk action buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '5px', width: '100%' }}>
                
                {/* CASE 1: Delivery - Pendientes */}
                {typeFilter === 'delivery' && statusFilter === 'pendiente' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#2563eb' }}
                      onClick={openBulkRepartidorModal}
                    >
                      <i className="bi bi-truck me-1"></i> Asignar Repartidor
                    </button>
                    
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#14b8a6' }}
                      onClick={() => applyBulkStatus({ con_envio: false, estado: 'Pendiente' })}
                    >
                      <i className="bi bi-shop me-1"></i> Cambiar a Retiro Local
                    </button>
                  </>
                )}

                {/* CASE 2: Delivery - En reparto */}
                {typeFilter === 'delivery' && statusFilter === 'en_reparto' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#10b981' }}
                      onClick={() => applyBulkStatus({ estado: 'Entregado' })}
                    >
                      <i className="bi bi-check-circle me-1"></i> Entregar Pedidos
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#64748b' }}
                      onClick={() => applyBulkStatus({ estado: 'Pendiente', repartidor: null })}
                    >
                      <i className="bi bi-arrow-left-circle me-1"></i> Volver a Pendiente
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#14b8a6' }}
                      onClick={() => applyBulkStatus({ con_envio: false, estado: 'Pendiente', repartidor: null })}
                    >
                      <i className="bi bi-shop me-1"></i> Cambiar a Retiro Local
                    </button>
                  </>
                )}

                {/* CASE 3: Delivery - Entregado */}
                {typeFilter === 'delivery' && statusFilter === 'entregado' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#059669' }}
                      onClick={triggerBulkCobrarRendir}
                    >
                      <i className="bi bi-cash-coin me-1"></i> Rendir Viaje
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#047857' }}
                      onClick={() => applyBulkStatus({ estado: 'Finalizado' })}
                    >
                      <i className="bi bi-check-circle-fill me-1"></i> Finalizar Pedidos
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#64748b' }}
                      onClick={() => applyBulkStatus({ estado: 'Pendiente', repartidor: null, medio_pago: null })}
                    >
                      <i className="bi bi-arrow-left-circle me-1"></i> Volver a Pendiente
                    </button>
                  </>
                )}

                {/* CASE 3.5: Delivery - Finalizado */}
                {typeFilter === 'delivery' && statusFilter === 'finalizado' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#64748b' }}
                      onClick={() => applyBulkStatus({ estado: 'Pendiente', repartidor: null, medio_pago: null })}
                    >
                      <i className="bi bi-arrow-left-circle me-1"></i> Volver a Pendiente
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#10b981' }}
                      onClick={triggerBulkCobrarRendir}
                    >
                      <i className="bi bi-cash-coin me-1"></i> Cambiar Medio de Pago
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#7c3aed' }}
                      onClick={handleInvoiceSelectedOrders}
                    >
                      <i className="bi bi-receipt me-1"></i> Facturar
                    </button>
                  </>
                )}

                {/* CASE 4: Local - Pendiente */}
                {typeFilter === 'local' && statusFilter === 'pendiente' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#10b981' }}
                      onClick={triggerBulkCobrarRendir}
                    >
                      <i className="bi bi-cash-coin me-1"></i> Cobrar Pedidos
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#047857' }}
                      onClick={() => applyBulkStatus({ estado: 'Finalizado' })}
                    >
                      <i className="bi bi-check-circle-fill me-1"></i> Finalizar Pedidos
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#3b82f6' }}
                      onClick={() => applyBulkStatus({ con_envio: true, estado: 'Pendiente' })}
                    >
                      <i className="bi bi-truck me-1"></i> Cambiar a Reparto
                    </button>
                  </>
                )}

                {/* CASE 5: Local - Finalizado */}
                {typeFilter === 'local' && statusFilter === 'finalizado' && (
                  <>
                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#10b981' }}
                      onClick={triggerBulkCobrarRendir}
                    >
                      <i className="bi bi-cash-coin me-1"></i> Cambiar Medio de Pago
                    </button>

                    <button 
                      type="button" 
                      className="btn-new-task" 
                      style={{ backgroundColor: '#7c3aed' }}
                      onClick={handleInvoiceSelectedOrders}
                    >
                      <i className="bi bi-receipt me-1"></i> Facturar
                    </button>
                  </>
                )}

                {/* Common action: Cancelar (requires motive) */}
                <button 
                  type="button" 
                  className="btn-new-task" 
                  style={{ backgroundColor: '#ef4444', marginLeft: 'auto' }}
                  onClick={triggerBulkCancel}
                >
                  <i className="bi bi-x-circle-fill me-1"></i> Cancelar Pedidos
                </button>
              </div>
            </div>
          )}

          {/* ORDERS TABLE LIST */}
          {loadingOrders ? (
            <div className="spinner-container">
              <div className="spinner"></div>
              <span>Cargando listado de pedidos...</span>
            </div>
          ) : filteredOrders.length > 0 ? (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'white' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                    <th style={{ padding: '12px 16px', width: '40px', textAlign: 'center' }}>
                      {isSelectionEnabled ? (
                        <input 
                          type="checkbox" 
                          className="task-checkbox" 
                          style={{ width: '18px', height: '18px', display: 'block', margin: '0 auto', cursor: 'pointer' }}
                          checked={selectedOrderIds.length === filteredOrders.length && filteredOrders.length > 0}
                          onChange={handleSelectAllOrders}
                        />
                      ) : (
                        <input 
                          type="checkbox" 
                          className="task-checkbox" 
                          style={{ width: '18px', height: '18px', display: 'block', margin: '0 auto', opacity: 0.3, cursor: 'not-allowed' }}
                          checked={false}
                          disabled
                          title="Selecciona Tipo (Delivery/Local) y Estado para habilitar selección múltiple"
                        />
                      )}
                    </th>
                    <th 
                      style={{ padding: '12px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortOrders('fecha')}
                    >
                      Fecha {orderSortField === 'fecha' && (orderSortAsc ? '▴' : '▾')}
                    </th>
                    <th 
                      style={{ padding: '12px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortOrders('cliente')}
                    >
                      Cliente {orderSortField === 'cliente' && (orderSortAsc ? '▴' : '▾')}
                    </th>
                    {showShippingColumn && (
                      <th 
                        style={{ padding: '12px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSortOrders('estado')}
                      >
                        Envío {orderSortField === 'estado' && (orderSortAsc ? '▴' : '▾')}
                      </th>
                    )}
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      Cobro
                    </th>
                    <th 
                      style={{ padding: '12px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortOrders('detalles')}
                    >
                      Detalles / Reparto {orderSortField === 'detalles' && (orderSortAsc ? '▴' : '▾')}
                    </th>
                    <th 
                      style={{ padding: '12px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortOrders('total')}
                    >
                      Total {orderSortField === 'total' && (orderSortAsc ? '▴' : '▾')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center', width: '210px' }}>Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => {
                    const isSelected = selectedOrderIds.includes(order.id);
                    const isCancelled = isOrderCancelled(order);
                    const isFinished = isOrderFinalizado(order);
                    const dateFmt = new Date(order.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    const clientSaldo = getOrderClientSaldo(order);
                    const shippingEstado = getOrderShippingEstado(order);
                    const estLower = getOrderShippingEstadoLower(order);
                    let badgeBg = '#cbd5e1'; // grey
                    let badgeText = '#334155';
                    if (estLower === 'pendiente') {
                      badgeBg = '#dbeafe'; badgeText = '#1e40af'; // blue
                    } else if (estLower === 'en reparto' || estLower === 'en viaje' || estLower === 'repartiendo') {
                      badgeBg = '#ffedd5'; badgeText = '#9a3412'; // orange
                    } else if (estLower === 'entregado') {
                      badgeBg = '#d1fae5'; badgeText = '#065f46'; // light green
                    } else if (isFinished) {
                      badgeBg = '#a7f3d0'; badgeText = '#047857'; // dark emerald
                    } else if (isCancelled) {
                      badgeBg = '#fee2e2'; badgeText = '#991b1b'; // red
                    }

                    return (
                      <tr 
                        key={order.id} 
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: isCancelled ? '#f8fafc' : (isSelected ? '#faf5ff' : 'transparent'),
                          opacity: isCancelled ? 0.6 : 1,
                          color: isCancelled ? 'var(--text-muted)' : 'inherit',
                          textDecoration: 'none',
                          transition: 'background-color 0.2s'
                        }}
                      >
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          {isSelectionEnabled && !isCancelled ? (
                            <input 
                              type="checkbox" 
                              className="task-checkbox" 
                              style={{ width: '18px', height: '18px', display: 'block', margin: '0 auto', cursor: 'pointer' }}
                              checked={isSelected}
                              onChange={() => handleSelectOrder(order.id)}
                            />
                          ) : (
                            <input 
                              type="checkbox" 
                              className="task-checkbox" 
                              style={{ width: '18px', height: '18px', display: 'block', margin: '0 auto', opacity: 0.3, cursor: 'not-allowed' }}
                              checked={false}
                              disabled
                              title={isCancelled ? "Los pedidos cancelados no se pueden seleccionar" : "Selecciona Tipo (Delivery/Local) y Estado para habilitar selección múltiple"}
                            />
                          )}
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{dateFmt}</td>
                        <td style={{ padding: '12px', fontWeight: '600', fontSize: '1.05rem' }}>
                          {order.cliente_nombre}
                          {clientSaldo !== null && (
                            <span style={{ fontSize: '0.72rem', fontWeight: '500', color: 'var(--text-muted)', marginLeft: '4px' }}>
                              ($ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(clientSaldo)})
                            </span>
                          )}
                        </td>
                        {showShippingColumn && (
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span 
                              style={{ 
                                display: 'inline-block',
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                fontSize: '0.75rem', 
                                fontWeight: '700', 
                                backgroundColor: badgeBg, 
                                color: badgeText,
                                textTransform: 'uppercase'
                              }}
                            >
                              {shippingEstado}
                            </span>
                          </td>
                        )}
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {(() => {
                            const cobroEstado = getOrderCobroEstado(order);
                            if (!cobroEstado) {
                              return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>;
                            }
                            const cobroStyle = COBRO_ESTADO_STYLES[cobroEstado];
                            return (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  fontSize: '0.75rem',
                                  fontWeight: '700',
                                  backgroundColor: cobroStyle.backgroundColor,
                                  color: cobroStyle.color,
                                  textTransform: 'uppercase',
                                }}
                                title={order.medio_pago || ''}
                              >
                                {cobroEstado}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '12px', fontSize: '0.8rem' }}>
                          {order.con_envio && order.direccion_envio && (
                            <div className="text-truncate" style={{ maxWidth: '140px' }} title={cleanAddressText(order.direccion_envio)}>
                              <strong>Dir:</strong> {cleanAddressText(order.direccion_envio)}
                            </div>
                          )}
                          {order.repartidor && (
                            <div style={{ color: '#9a3412', fontWeight: '500' }}>
                              <strong>Repartidor:</strong> {order.repartidor}
                            </div>
                          )}
                          {hasPaymentMedio(order.medio_pago) && (
                            <div style={{ color: '#065f46', fontWeight: '500' }}>
                              <strong>Pago:</strong> {order.medio_pago}
                            </div>
                          )}
                          {order.cae && (
                            <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.8rem', marginTop: '2px' }}>
                              <i className="bi bi-receipt me-1"></i> {order.factura_tipo || 'Factura'}: {order.factura_nro}
                            </div>
                          )}
                          {isCancelled && order.motivo_cancelacion && (
                            <div style={{ color: '#ef4444', fontWeight: '500' }}>
                              <strong>Motivo:</strong> {order.motivo_cancelacion}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: '700', fontSize: '0.95rem' }}>
                          $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(order.total)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-new-task"
                              style={{
                                padding: '4px 8px',
                                fontSize: '0.75rem',
                                backgroundColor: 'transparent',
                                color: '#8b5cf6',
                                border: '1px solid #8b5cf6',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                margin: 0
                              }}
                              onClick={() => handlePrintRequest(order)}
                              title="Reimprimir comanda"
                            >
                              <i className="bi bi-printer"></i> Comanda
                            </button>

                            {estLower === 'pendiente' && !isCancelled && (
                              <button
                                type="button"
                                className="btn-new-task"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '0.75rem',
                                  backgroundColor: 'transparent',
                                  color: '#f59e0b',
                                  border: '1px solid #f59e0b',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  margin: 0
                                }}
                                onClick={() => handleOpenEditOrder(order)}
                                title="Editar ítems del pedido"
                              >
                                <i className="bi bi-pencil-fill"></i>
                              </button>
                            )}

                            {canCobrarOrder(order) && (
                              <button
                                type="button"
                                className="btn-new-task"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '0.75rem',
                                  backgroundColor: 'transparent',
                                  color: '#10b981',
                                  border: '1px solid #10b981',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  margin: 0
                                }}
                                onClick={() => handleOpenCobrarOrder(order)}
                                title={(isOrderPagado(order) || isOrderCtaCte(order)) ? 'Cambiar medio de pago' : (order.con_envio ? 'Rendir / cobrar pedido' : 'Cobrar pedido')}
                              >
                                <i className="bi bi-cash-coin"></i>
                              </button>
                            )}

                            {(order.cae || order.factura_nro) && (
                              <button
                                type="button"
                                className="btn-new-task"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '0.75rem',
                                  backgroundColor: 'transparent',
                                  color: '#10b981',
                                  border: '1px solid #10b981',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  margin: 0
                                }}
                                onClick={() => handleInvoiceOptions(order)}
                                title="Opciones de Factura"
                              >
                                <i className="bi bi-file-earmark-text"></i> Factura
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted p-5 small" style={{ border: '1.5px dashed var(--border-color)', borderRadius: '12px' }}>
              <i className="bi bi-journal-x text-secondary" style={{ fontSize: '2.5rem', opacity: 0.6 }}></i>
              <div style={{ marginTop: '10px' }}>
                {typeFilter === 'delivery' && !statusFilter && "No hay pedidos con delivery actualmente."}
                {typeFilter === 'local' && !statusFilter && "No hay pedidos de retiro en local actualmente."}
                {typeFilter === 'delivery' && statusFilter === 'pendiente' && "No hay pedidos delivery pendientes actualmente."}
                {typeFilter === 'delivery' && statusFilter === 'en_reparto' && "No hay pedidos delivery en reparto actualmente."}
                {typeFilter === 'delivery' && statusFilter === 'entregado' && "No hay pedidos delivery entregados actualmente."}
                {typeFilter === 'delivery' && statusFilter === 'finalizado' && "No hay pedidos delivery finalizados actualmente."}
                {typeFilter === 'local' && statusFilter === 'pendiente' && "No hay pedidos locales pendientes actualmente."}
                {typeFilter === 'local' && statusFilter === 'finalizado' && "No hay pedidos locales finalizados actualmente."}
                {statusFilter === 'cancelados' && typeFilter === 'delivery' && "No hay pedidos delivery cancelados."}
                {statusFilter === 'cancelados' && typeFilter === 'local' && "No hay pedidos locales cancelados."}
                {typeFilter === null && "No hay pedidos cargados en el sistema actualmente."}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TOTAL SALES BILLING METRICS                                    */}
          {/* ============================================================== */}
          {orders.length > 0 && statusFilter !== 'cancelados' && (
            <div className="page-card" style={{ marginTop: '30px', padding: '20px', backgroundColor: '#f8fafc', borderColor: 'var(--border-color)', borderStyle: 'solid', borderWidth: '1px' }}>
              <h4 className="text-dark fw-bold mb-3" style={{ fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                <i className="bi bi-bar-chart-line-fill me-2"></i>Resumen de Ventas
              </h4>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'start' }}>
                {/* Column 1: Total Facturado */}
                <div style={{ 
                  flex: '1 1 280px', 
                  backgroundColor: 'white', 
                  padding: '20px', 
                  borderRadius: '10px', 
                  border: '1px solid #e2e8f0', 
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  minHeight: '140px'
                }}>
                  <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.02em' }}>
                    Total Facturado (Neto sin Cancelados)
                  </span>
                  <div style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-dark)', marginTop: '8px', lineHeight: '1.1' }}>
                    $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(totalSoldSum)}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                    Según fecha y tipo (Delivery/Local). Excluye pedidos cancelados.
                  </span>
                </div>
                
                {/* Column 2: Payments breakdown */}
                <div style={{ 
                  flex: '1 1 340px', 
                  backgroundColor: 'white', 
                  padding: '20px', 
                  borderRadius: '10px', 
                  border: '1px solid #e2e8f0', 
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)' 
                }}>
                  <span className="small text-muted font-bold block text-uppercase" style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.02em', marginBottom: '12px', display: 'block' }}>
                    Desglose por Medio de Pago:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                    {enabledPaymentMethods.map((concept) => {
                      const valueName = getPaymentMethodValue(concept);
                      const iconClass = getConceptIcon(concept.id);
                      return (
                        <div key={concept.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                          <span style={{ display: 'flex', alignItems: 'center' }}>
                            <i className={`bi ${iconClass} me-2`} style={{ fontSize: '1rem' }}></i> {concept.label}
                          </span>
                          <strong>$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(salesByMethod[valueName] || 0)}</strong>
                        </div>
                      );
                    })}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#2563eb', fontWeight: '600' }}>
                      <span style={{ display: 'flex', alignItems: 'center' }}>
                        <i className="bi bi-hourglass-split me-2" style={{ fontSize: '1rem' }}></i> Pendientes (Sin cobrar)
                      </span>
                      <strong>$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(salesByMethod['Pendiente'])}</strong>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODALS SECTION                                                 */}
      {/* ============================================================== */}

      {/* MODAL: IMPORT CLIENTES CSV */}
      {importClientesModal && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header" style={{ backgroundColor: '#475569' }}>
              <h5 className="modal-title"><i className="bi bi-file-earmark-spreadsheet me-2"></i>Importar clientes desde Google Sheets</h5>
              <button className="modal-close-btn" onClick={() => {
                setImportClientesModal(false);
                resetImportMapping();
              }}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <ol style={{ fontSize: '0.9rem', color: 'var(--text-muted)', paddingLeft: '18px', marginBottom: '16px' }}>
                {CSV_IMPORT_HELP.map((line) => (
                  <li key={line} style={{ marginBottom: '6px' }}>{line}</li>
                ))}
              </ol>

              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', marginBottom: '16px', fontSize: '0.82rem', fontFamily: 'monospace' }}>
                nombre,razon_social,cuit,telefono,direccion,Cond. IVA,saldo<br />
                Dietética Central,Central SRL,30754321012,5492994123456,Av. Argentina 120 Neuquén,CF,0
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={importReplaceAll}
                  onChange={(e) => setImportReplaceAll(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                Borrar todos los clientes actuales antes de importar
              </label>

              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={handleImportCsvFile}
              />

              <button
                type="button"
                className="btn-submit"
                style={{ backgroundColor: '#475569', marginBottom: '12px' }}
                disabled={importClientesStatus === 'importing'}
                onClick={() => csvFileInputRef.current?.click()}
              >
                {importCsvText ? 'CAMBIAR ARCHIVO CSV' : 'ELEGIR ARCHIVO CSV'}
              </button>

              {importFileName && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Archivo: <strong>{importFileName}</strong> · {importRowCount} fila(s) detectada(s)
                </div>
              )}

              {importClientesStatus === 'mapping' && importCsvHeaders.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h6 style={{ fontWeight: '700', marginBottom: '10px' }}>Asignación de columnas</h6>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={importHasHeaderRow}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setImportHasHeaderRow(checked);
                        if (importCsvText) refreshImportAnalysis(importCsvText, checked);
                      }}
                      style={{ width: '16px', height: '16px' }}
                    />
                    La primera fila del archivo es encabezado
                  </label>

                  <div style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
                    {IMPORT_FIELDS.map((field) => (
                      <div key={field.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>{field.label}</label>
                        <select
                          className="form-input"
                          style={{ margin: 0, fontSize: '0.85rem' }}
                          value={importColumnMapping[field.key] ?? -1}
                          onChange={(e) => {
                            const value = parseInt(e.target.value, 10);
                            setImportColumnMapping((prev) => ({
                              ...prev,
                              [field.key]: Number.isNaN(value) ? -1 : value,
                            }));
                          }}
                        >
                          <option value={-1}>(No importar)</option>
                          {importCsvHeaders.map((header, index) => (
                            <option key={`${field.key}-${index}`} value={index}>
                              {getColumnLabel(index, importCsvHeaders)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {importPreviewRows.length > 0 && (
                    <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>Vista previa (3 filas)</div>
                      <table className="table table-sm" style={{ fontSize: '0.75rem', margin: 0 }}>
                        <thead>
                          <tr>
                            {IMPORT_FIELDS.filter((f) => (importColumnMapping[f.key] ?? -1) >= 0).map((field) => (
                              <th key={field.key}>{field.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importPreviewRows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {IMPORT_FIELDS.filter((f) => (importColumnMapping[f.key] ?? -1) >= 0).map((field) => {
                                const idx = importColumnMapping[field.key];
                                const cell = String(row[idx] ?? '').trim();
                                const display = field.key === 'condicion_iva' && cell
                                  ? `${cell} → ${normalizeIva(cell)}`
                                  : cell || '—';
                                return <td key={field.key}>{display}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-submit"
                    style={{ backgroundColor: '#8b5cf6' }}
                    disabled={importClientesStatus === 'importing'}
                    onClick={handleConfirmImportCsv}
                  >
                    {importClientesStatus === 'importing' ? 'IMPORTANDO...' : `IMPORTAR ${importRowCount} CLIENTES`}
                  </button>
                </div>
              )}

              {importClientesResult && (
                <div style={{ fontSize: '0.9rem' }}>
                  <div className="alert-box-success" style={{ marginBottom: '10px' }}>
                    <i className="bi bi-check-circle-fill"></i>
                    <div>
                      {importClientesResult.deleted > 0 && (
                        <>Eliminados: <strong>{importClientesResult.deleted}</strong>{' · '}</>
                      )}
                      Importados: <strong>{importClientesResult.imported}</strong>
                      {' · '}Omitidos (duplicados): <strong>{importClientesResult.skipped}</strong>
                      {importClientesResult.skippedEmpty > 0 && (
                        <>{' · '}Vacías: <strong>{importClientesResult.skippedEmpty}</strong></>
                      )}
                      {importClientesResult.inferredNames > 0 && (
                        <>{' · '}Nombre inferido: <strong>{importClientesResult.inferredNames}</strong></>
                      )}
                      {' · '}Fallidos: <strong>{importClientesResult.failed}</strong>
                    </div>
                  </div>
                  {importClientesResult.errors?.length > 0 && (
                    <div style={{ maxHeight: '160px', overflowY: 'auto', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px', fontSize: '0.8rem' }}>
                      {importClientesResult.errors.slice(0, 20).map((msg) => (
                        <div key={msg} style={{ marginBottom: '4px' }}>{msg}</div>
                      ))}
                      {importClientesResult.errors.length > 20 && (
                        <div>... y {importClientesResult.errors.length - 20} avisos más.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NEW CLIENT */}
      {newClientModal && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header" style={{ backgroundColor: '#8b5cf6' }}>
              <h5 className="modal-title"><i className="bi bi-person-plus-fill me-2"></i>Nuevo Cliente</h5>
              <button className="modal-close-btn" onClick={() => {
                setNewClientModal(false);
                setNewClientError('');
                setNewClientAddress('');
              }}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateClient}>
                {newClientError && (
                  <div className="alert-box" style={{ marginBottom: '15px', backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b', padding: '8px 12px', fontSize: '0.8rem' }}>
                    <i className="bi bi-exclamation-circle-fill"></i>
                    <div>{newClientError}</div>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Nombre Comercial / Nombre</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    required 
                    placeholder="Ej: Dietética La Palmera o Juan Pérez"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Razón Social</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: La Palmera S.R.L. (Opcional)"
                    value={newClientRazon}
                    onChange={(e) => setNewClientRazon(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">CUIT</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: 30-7543210-9 (Opcional)"
                    value={newClientCuit}
                    onChange={handleCuitChange}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Condición frente al IVA</label>
                  <select 
                    className="form-input"
                    value={newClientCondicionIva}
                    onChange={(e) => setNewClientCondicionIva(e.target.value)}
                  >
                    <option value="Consumidor Final">Consumidor Final</option>
                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                    <option value="Monotributista">Monotributista</option>
                    <option value="Exento">Exento</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono (WhatsApp)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: 5491123456789 (Opcional)"
                    value={newClientTelefono}
                    onChange={(e) => setNewClientTelefono(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Dirección de envío</label>
                  <div className="flex-row-group mb-2" style={{ flexWrap: 'wrap', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      required
                      placeholder="Ej: Av. Argentina 120, Neuquén"
                      value={newClientAddress}
                      onChange={(e) => setNewClientAddress(e.target.value)}
                      style={{ margin: 0, flex: 1, minWidth: '150px' }}
                    />
                    {newClientAddress.trim() && isValidGpsAddress(newClientAddress) && (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <a
                          href={getGmapsUrl(newClientAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-nav-back"
                          style={{ padding: '8px 10px', fontSize: '0.9rem', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, textDecoration: 'none', backgroundColor: '#f1f5f9' }}
                          title="Ver en Google Maps"
                        >
                          🗺️
                        </a>
                        <button
                          type="button"
                          className="btn-nav-back"
                          style={{ padding: '8px 10px', fontSize: '0.9rem', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, backgroundColor: '#f1f5f9' }}
                          onClick={() => {
                            const gmapsUrl = getGmapsUrl(newClientAddress);
                            setLocationQrData({
                              address: cleanAddressText(newClientAddress),
                              qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(gmapsUrl)}`
                            });
                            setShowLocationQrModal(true);
                          }}
                          title="Mostrar Código QR de Ubicación"
                        >
                          📱
                        </button>
                      </div>
                    )}
                  </div>
                  <small className="text-muted" style={{ display: 'block', marginTop: '6px' }}>
                    Obligatoria. Incluí calle, número y ciudad.
                  </small>
                </div>
                <button type="submit" className="btn-submit" style={{ backgroundColor: '#8b5cf6', marginTop: '10px' }}>
                  REGISTRAR CLIENTE
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ASSIGN REPARTIDOR */}
      {bulkRepartidorModal && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header" style={{ backgroundColor: '#2563eb' }}>
              <h5 className="modal-title"><i className="bi bi-truck me-2"></i>Asignar Repartidor</h5>
              <button className="modal-close-btn" onClick={() => setBulkRepartidorModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleBulkRepartir}>
                <div className="form-group">
                  <label className="form-label">Repartidor</label>
                  {repartidores.length > 0 ? (
                    <>
                      <select
                        className="form-select"
                        required
                        value={bulkRepartidorName}
                        onChange={(e) => setBulkRepartidorName(e.target.value)}
                        autoFocus
                      >
                        <option value="">Seleccionar repartidor...</option>
                        {repartidores.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <input
                          type="text"
                          className="form-input"
                          style={{ margin: 0, fontSize: '0.85rem' }}
                          placeholder="Agregar repartidor nuevo..."
                          value={quickRepartidorInput}
                          onChange={(e) => setQuickRepartidorInput(e.target.value)}
                          disabled={repartidoresSaving}
                        />
                        <button
                          type="button"
                          className="btn-new-task"
                          style={{ backgroundColor: '#2563eb', color: '#fff', margin: 0, whiteSpace: 'nowrap' }}
                          onClick={handleQuickAddRepartidor}
                          disabled={repartidoresSaving || !quickRepartidorInput.trim()}
                        >
                          <i className="bi bi-plus-lg"></i>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="alert-box" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e', fontSize: '0.82rem', marginBottom: '10px' }}>
                        <i className="bi bi-info-circle-fill"></i>
                        <div>
                          No hay repartidores cargados. Agregá uno acá abajo o en la pestaña <strong>Repartidores</strong>.
                        </div>
                      </div>
                      <input 
                        type="text" 
                        className="form-input" 
                        required 
                        placeholder="Ej: Juan Gómez, Moto Express..."
                        value={bulkRepartidorName}
                        onChange={(e) => setBulkRepartidorName(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn-new-task"
                        style={{ backgroundColor: '#2563eb', color: '#fff', marginTop: '10px', width: '100%' }}
                        onClick={(e) => handleAddRepartidor(e, bulkRepartidorName)}
                        disabled={repartidoresSaving || !bulkRepartidorName.trim()}
                      >
                        {repartidoresSaving ? 'Guardando...' : 'Guardar y usar repartidor'}
                      </button>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  <button 
                    type="button" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#6b7280', margin: 0 }}
                    onClick={() => setBulkRepartidorModal(false)}
                  >
                    CANCELAR
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#2563eb', margin: 0, flex: 1 }}
                  >
                    CONFIRMAR REPARTO (ENVIAR)
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INDIVIDUAL PAYMENTS SELECTOR */}
      {bulkPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '600px' }}>
            <div className="modal-header" style={{ backgroundColor: '#10b981' }}>
              <h5 className="modal-title">
                <i className="bi bi-cash-coin me-2"></i> Registrar Pago / Cobro
              </h5>
              <button className="modal-close-btn" onClick={() => setBulkPaymentModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleBulkPaymentConfirm}>
                <div className="alert-box" style={{ backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46', fontSize: '0.82rem', marginBottom: '15px' }}>
                  <i className="bi bi-info-circle-fill"></i>
                  <div>
                    Asigna el medio de pago correspondiente para cada uno de los pedidos seleccionados.
                  </div>
                </div>
                
                <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '15px', paddingRight: '5px' }}>
                  {selectedOrderIds.map(id => {
                    const order = orders.find(o => o.id === id);
                    if (!order) return null;
                    return (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ flex: '1', minWidth: '0', paddingRight: '10px' }}>
                          <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-dark)' }} className="text-truncate">
                            {order.cliente_nombre}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Total: <strong>$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(order.total)}</strong>
                          </div>
                        </div>
                        <div style={{ width: '220px' }}>
                          <select 
                            className="form-select"
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            value={bulkOrdersPayments[id] || 'Efectivo'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBulkOrdersPayments(prev => ({ ...prev, [id]: val }));
                            }}
                          >
                            <option value="Efectivo">Efectivo 💵</option>
                            {enabledPaymentMethods
                              .filter((concept) => getPaymentMethodValue(concept) !== 'Efectivo')
                              .map(concept => {
                              const valueName = getPaymentMethodValue(concept);
                              const emoji = getPaymentMethodEmoji(concept.id);
                              return (
                                <option key={concept.id} value={valueName}>
                                  {concept.label} {emoji}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  <button 
                    type="button" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#6b7280', margin: 0 }}
                    onClick={() => setBulkPaymentModal(false)}
                  >
                    CANCELAR
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#10b981', margin: 0, flex: 1 }}
                  >
                    CONFIRMAR PAGOS Y FINALIZAR
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CANCELLATION MOTIVE */}
      {cancelMotiveModal && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header" style={{ backgroundColor: '#ef4444' }}>
              <h5 className="modal-title"><i className="bi bi-x-circle me-2"></i>Motivo de Cancelación</h5>
              <button className="modal-close-btn" onClick={() => setCancelMotiveModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleBulkCancelConfirm}>
                <div className="form-group">
                  <label className="form-label">Por favor, indica el motivo de la cancelación:</label>
                  <textarea 
                    className="form-input" 
                    style={{ minHeight: '80px', resize: 'vertical' }}
                    required 
                    placeholder="Ej: Cliente canceló por demora, error en el pedido, etc..."
                    value={cancelMotiveText}
                    onChange={(e) => setCancelMotiveText(e.target.value)}
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  <button 
                    type="button" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#6b7280', margin: 0 }}
                    onClick={() => setCancelMotiveModal(false)}
                  >
                    CANCELAR
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#ef4444', margin: 0, flex: 1 }}
                  >
                    CANCELAR PEDIDOS
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OBSERVACION GENERAL DE TICKET */}
      {printObsModal && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="modal-header" style={{ backgroundColor: '#8b5cf6' }}>
              <h5 className="modal-title" style={{ color: 'white' }}><i className="bi bi-printer me-2"></i>Observación del Ticket</h5>
              <button className="modal-close-btn" onClick={() => setPrintObsModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handlePrintConfirm}>
                <div className="form-group">
                  <label className="form-label text-dark">Teléfono del Cliente (para WhatsApp en QR):</label>
                  <input 
                    type="tel" 
                    className="form-input" 
                    placeholder="Ej: 5491123456789 (número sin espacios, sin +)"
                    value={printObsPhone}
                    onChange={(e) => setPrintObsPhone(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label text-dark">Observación General (opcional):</label>
                  <textarea 
                    className="form-input" 
                    style={{ minHeight: '80px', resize: 'vertical' }}
                    placeholder="Escribe alguna aclaración general para imprimir abajo del ticket en mayúsculas..."
                    value={printObsText}
                    onChange={(e) => setPrintObsText(e.target.value)}
                    autoFocus
                  />
                </div>

                {printObsPendingOrder && (
                  <div style={{
                    backgroundColor: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: '10px',
                    padding: '12px',
                    marginBottom: '16px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
                      <label className="form-label text-dark" style={{ margin: 0, fontSize: '0.85rem' }}>
                        <i className="bi bi-whatsapp me-1" style={{ color: '#25d366' }}></i>
                        Mensaje para WhatsApp
                      </label>
                      <button
                        type="button"
                        className="btn-new-task"
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          backgroundColor: '#25d366',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          margin: 0,
                        }}
                        onClick={() => handleCopyWhatsAppMessage(buildWhatsAppOrderMessage(printObsPendingOrder))}
                      >
                        <i className="bi bi-clipboard me-1"></i>
                        {waCopyFeedback || 'Copiar'}
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        color: '#065f46',
                        userSelect: 'text',
                        cursor: 'text',
                      }}
                    >
                      {buildWhatsAppOrderMessage(printObsPendingOrder)}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  <button 
                    type="button" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#6b7280', margin: 0 }}
                    onClick={() => setPrintObsModal(false)}
                  >
                    CANCELAR
                  </button>
                  <button 
                    type="submit" 
                    className="btn-submit" 
                    style={{ backgroundColor: '#8b5cf6', margin: 0, flex: 1 }}
                  >
                    IMPRIMIR COMANDA
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR PEDIDO PENDIENTE */}
      {editOrderModal && editingOrder && (
        <div className="modal-overlay">
          <div className="modal-content-card modal-content-card--scrollable" style={{ maxWidth: '640px' }}>
            <div className="modal-header" style={{ backgroundColor: '#f59e0b' }}>
              <h5 className="modal-title" style={{ color: 'white' }}>
                <i className="bi bi-pencil-fill me-2"></i>
                Editar Pedido — {editingOrder.cliente_nombre}
              </h5>
              <button
                className="modal-close-btn"
                onClick={() => {
                  setEditOrderModal(false);
                  setEditingOrder(null);
                  setEditOrderItems([]);
                  resetEditOrderForm();
                }}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body-scroll">
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '700' }}>Ítems del pedido</label>
                {editOrderItems.length > 0 ? (
                  <div className="modal-items-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editOrderItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '8px',
                          backgroundColor: '#f8fafc',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 70px 90px 36px',
                            gap: '8px',
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ fontSize: '0.85rem', fontWeight: '600' }}>{item.producto}</div>
                          <input
                            type="number"
                            className="form-input input-no-spinner text-end"
                            style={{ margin: 0, padding: '6px', fontSize: '0.8rem' }}
                            min="0.01"
                            step="any"
                            value={item.cantidad}
                            onChange={(e) => handleEditOrderItemChange(item.id, 'cantidad', e.target.value)}
                            onKeyDown={handleNumericKeyDown}
                            title="Cantidad"
                          />
                          <input
                            type="number"
                            className="form-input input-no-spinner text-end"
                            style={{ margin: 0, padding: '6px', fontSize: '0.8rem' }}
                            min="0"
                            step="any"
                            value={item.valor}
                            onChange={(e) => handleEditOrderItemChange(item.id, 'valor', e.target.value)}
                            onKeyDown={handleNumericKeyDown}
                            title="Precio unitario"
                          />
                          <button
                            type="button"
                            className="btn-nav-back"
                            style={{ padding: '4px', color: '#ef4444', border: 'none', margin: 0 }}
                            onClick={() => handleRemoveEditOrderItem(item.id)}
                            title="Quitar ítem"
                          >
                            <i className="bi bi-trash-fill"></i>
                          </button>
                        </div>
                        <input
                          type="text"
                          className="form-input"
                          style={{ marginTop: '6px', padding: '6px 8px', fontSize: '0.78rem', width: '100%' }}
                          placeholder="Observación / detalle"
                          value={item.observacion || ''}
                          onChange={(e) => handleEditOrderItemChange(item.id, 'observacion', e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted p-3 small" style={{ border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    No hay ítems. Agregá al menos uno para guardar.
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', padding: '0 4px' }}>
                  <span className="fw-bold text-dark text-uppercase" style={{ fontSize: '0.85rem' }}>Total:</span>
                  <span className="fw-bold" style={{ fontSize: '1.1rem', color: '#1e293b' }}>
                    $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(
                      editOrderItems.reduce((sum, item) => sum + (item.cantidad * item.valor), 0)
                    )}
                  </span>
                </div>
              </div>

              <form onSubmit={handleAddEditOrderItem} style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '700' }}>Agregar ítem</label>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
                  <div className="form-group" ref={editProductRef} style={{ marginBottom: 0, position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ fontSize: '0.85rem', padding: '8px' }}
                      placeholder="Buscar producto..."
                      value={editProductSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditProductSearch(val);
                        setEditShowProductSuggestions(true);
                        if (val.trim() === '') {
                          setEditSelectedProduct(null);
                          setEditItemPrice(0);
                        } else {
                          const matches = products.filter((p) =>
                            p.nombre.toLowerCase().includes(val.toLowerCase())
                          );
                          if (matches.length > 0) {
                            setEditSelectedProduct(matches[0]);
                            setEditItemPrice(matches[0].precio);
                          } else {
                            setEditSelectedProduct(null);
                            setEditItemPrice(0);
                          }
                        }
                      }}
                      onFocus={() => setEditShowProductSuggestions(true)}
                    />
                    {editShowProductSuggestions && editProductSearch.trim() !== '' && (
                      <ul className="suggestions-list" style={{ position: 'absolute', zIndex: 10, width: '100%', maxHeight: '160px', overflowY: 'auto' }}>
                        {products
                          .filter((p) => p.nombre.toLowerCase().includes(editProductSearch.toLowerCase()))
                          .slice(0, 8)
                          .map((p) => (
                            <li
                              key={p.id}
                              className="suggestion-item text-start"
                              style={{ padding: '8px 10px', fontSize: '0.85rem' }}
                              onClick={() => handleSelectEditProduct(p)}
                            >
                              <strong>{p.nombre}</strong>
                              <span style={{ float: 'right', color: 'var(--text-muted)' }}>${p.precio}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                  <input
                    type="number"
                    className="form-input input-no-spinner text-end"
                    style={{ fontSize: '0.85rem', padding: '8px', margin: 0 }}
                    min="0.01"
                    step="any"
                    value={editItemQty}
                    onChange={(e) => setEditItemQty(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    title="Cantidad"
                  />
                  <input
                    type="number"
                    className="form-input input-no-spinner text-end"
                    style={{ fontSize: '0.85rem', padding: '8px', margin: 0 }}
                    min="0"
                    step="any"
                    value={editItemPrice}
                    onChange={(e) => setEditItemPrice(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    title="Precio"
                  />
                  <button
                    type="submit"
                    className="btn-submit"
                    style={{ backgroundColor: '#8b5cf6', width: 'auto', padding: '8px 12px', margin: 0, fontSize: '0.8rem' }}
                  >
                    <i className="bi bi-plus-lg"></i>
                  </button>
                </div>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '0.85rem', padding: '8px', marginTop: '8px', width: '100%' }}
                  placeholder="Observación / detalle (opcional)"
                  value={editItemObs}
                  onChange={(e) => setEditItemObs(e.target.value)}
                />
              </form>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-submit"
                style={{ backgroundColor: '#6b7280', margin: 0 }}
                onClick={() => {
                  setEditOrderModal(false);
                  setEditingOrder(null);
                  setEditOrderItems([]);
                  resetEditOrderForm();
                }}
                disabled={editOrderSaving}
              >
                CANCELAR
              </button>
              <button
                type="button"
                className="btn-submit"
                style={{ backgroundColor: '#f59e0b', margin: 0, flex: 1 }}
                onClick={handleSaveEditOrder}
                disabled={editOrderSaving || editOrderItems.length === 0}
              >
                {editOrderSaving ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ARCA BILLING PROGRESS & RESULTS */}
      {arcaProgressModal && (
        <div className="modal-overlay">
          <div className="modal-content-card" style={{ maxWidth: '550px' }}>
            <div className="modal-header" style={{ backgroundColor: '#7c3aed' }}>
              <h5 className="modal-title" style={{ color: 'white' }}>
                <i className="bi bi-receipt me-2"></i>Facturación Electrónica ARCA
              </h5>
              {arcaResults.length > 0 && (
                <button className="modal-close-btn" onClick={() => setArcaProgressModal(false)}>
                  <i className="bi bi-x-lg"></i>
                </button>
              )}
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              {arcaResults.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div className="spinner" style={{ margin: '0 auto 20px auto', borderColor: '#7c3aed', borderTopColor: 'transparent' }}></div>
                  <div style={{ fontWeight: '600', color: 'var(--text-dark)' }}>{arcaProgressText}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Por favor, no cierres esta ventana ni recargues la página.
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: '700', marginBottom: '15px', color: 'var(--text-dark)' }}>
                    Resultado del Proceso de Facturación:
                  </div>
                  
                  <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    {arcaResults.map((res, idx) => (
                      <div 
                        key={idx} 
                        style={{ 
                          padding: '12px', 
                          borderRadius: '8px', 
                          border: `1px solid ${res.status === 'success' ? '#a7f3d0' : '#fecaca'}`,
                          backgroundColor: res.status === 'success' ? '#f0fdf4' : '#fef2f2',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                            {res.cliente}
                          </span>
                          <span style={{ fontWeight: '800', fontSize: '0.9rem', color: res.status === 'success' ? '#10b981' : '#ef4444' }}>
                            $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(res.total)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: '0.8rem', color: res.status === 'success' ? '#065f46' : '#991b1b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <i className={`bi ${res.status === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`}></i>
                            <span>{res.details}</span>
                          </div>
                          {res.status === 'success' && (
                            <button
                              type="button"
                              className="btn-new-task"
                              style={{
                                padding: '4px 10px',
                                fontSize: '0.75rem',
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                margin: 0,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                              }}
                              onClick={() => {
                                const baseOrder = orders.find(o => o.id === res.orderId);
                                if (baseOrder) {
                                  // Merge with fresh invoice data to ensure CAE is present
                                  const orderWithInvoice = { ...baseOrder, ...res.invoiceData };
                                  handleDownloadInvoice(orderWithInvoice);
                                }
                              }}
                            >
                              <i className="bi bi-printer-fill"></i> Factura
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px' }}>
                    <button 
                      type="button" 
                      className="btn-submit" 
                      style={{ backgroundColor: '#7c3aed', margin: 0 }}
                      onClick={() => setArcaProgressModal(false)}
                    >
                      ENTENDIDO
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CLIENT MOVEMENTS DRAWER */}
      {showDrawer && selectedClient && (
        <div className="drawer-overlay" onClick={() => setShowDrawer(false)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header" style={{ backgroundColor: '#8b5cf6' }}>
              <h5 className="modal-title" style={{ fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                <i className="bi bi-clock-history me-2"></i> {selectedClient.nombre}
              </h5>
              <button className="modal-close-btn" onClick={() => setShowDrawer(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="drawer-body">
              <div className="page-card" style={{ padding: '12px', marginBottom: '20px', fontSize: '0.85rem', backgroundColor: '#f8fafc' }}>
                <div><strong>Razón Social:</strong> {selectedClient.razon_social || 'N/A'}</div>
                <div style={{ marginTop: '4px' }}><strong>CUIT:</strong> {formatCuit(selectedClient.cuit)}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                  <strong>{selectedClient.saldo < 0 ? 'Saldo a Favor:' : 'Saldo Deudor:'}</strong>
                  <span className={`fw-bold ${selectedClient.saldo > 0 ? 'text-danger' : 'text-success'}`} style={{ fontSize: '1rem' }}>
                    $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(Math.abs(selectedClient.saldo))}
                  </span>
                </div>
                {selectedClient.saldo < 0 && (
                  <button
                    type="button"
                    className="btn-submit"
                    style={{ 
                      backgroundColor: '#10b981', 
                      margin: '10px 0 0 0', 
                      width: '100%', 
                      fontSize: '0.8rem', 
                      padding: '8px 12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '6px' 
                    }}
                    onClick={handleOpenRefundModal}
                  >
                    <i className="bi bi-cash-coin"></i> Devolver Saldo a Favor
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button
                  type="button"
                  className="btn-new-task"
                  style={{ 
                    flex: 1,
                    backgroundColor: '#10b981', 
                    color: '#ffffff', 
                    border: 'none', 
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    height: '38px',
                    margin: 0
                  }}
                  onClick={handleExportCSV}
                  disabled={movements.length === 0}
                >
                  <i className="bi bi-file-earmark-spreadsheet-fill"></i>
                  Exportar Cuenta Corriente (Excel)
                </button>
                
                <button
                  type="button"
                  className="btn-nav-back"
                  style={{ 
                    padding: '0 12px', 
                    backgroundColor: '#fee2e2', 
                    color: '#ef4444', 
                    border: '1px solid #fca5a5', 
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '38px',
                    margin: 0
                  }}
                  onClick={handleClearClienteMovimientos}
                  disabled={loadingMovements}
                  title="Eliminar Historial de Cuenta Corriente"
                >
                  <i className="bi bi-trash-fill"></i>
                </button>
              </div>

              <label className="form-label" style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '10px' }}>
                Historial de Movimientos
              </label>

              {loadingMovements ? (
                <div className="spinner-container">
                  <div className="spinner"></div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cargando movimientos...</span>
                </div>
              ) : movements.length > 0 ? (
                <div>
                  {(() => {
                    const cleanConceptForDisplay = (concepto) => {
                      let text = concepto;
                      text = text.replace(/Pedido #/g, 'Compra #');
                      text = text.replace(/Pedido /g, 'Compra ');
                      text = text.replace(/Cobro Pedido #/g, 'Cobro Compra #');
                      text = text.replace(/Cancelación Pedido #/g, 'Cancelación Compra #');
                      text = text.replace(/Reversión Cobro Pedido #/g, 'Reversión Cobro Compra #');
                      text = text.replace(/Anticipo Pedido #/g, 'Anticipo Compra #');
                      text = text.replace(/Aplicación anticipo Pedido #/g, 'Aplicación anticipo Compra #');
                      text = text.replace(/Reversión anticipo Pedido #/g, 'Reversión anticipo Compra #');
                      
                      // Strip product details (everything after the first ' - ')
                      if (text.includes(' - ')) {
                        text = text.split(' - ')[0];
                      }
                      return text;
                    };

                    const groups = {};
                    const standalone = [];

                    movements.forEach(m => {
                      const match = m.concepto.match(/#([A-Za-z0-9_]+)/);
                      if (match) {
                        const orderId = match[1];
                        if (!groups[orderId]) {
                          groups[orderId] = [];
                        }
                        groups[orderId].push(m);
                      } else {
                        standalone.push(m);
                      }
                    });

                    const sortedGroups = Object.keys(groups).map(orderId => {
                      const groupMovs = groups[orderId];
                      // Sort movements ascending chronologically (earliest first: debit, then credit)
                      groupMovs.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
                      const groupDate = new Date(groupMovs[0].fecha).getTime();

                      const totalDebe = groupMovs.reduce((sum, m) => sum + parseFloat(m.debe || 0), 0);
                      const totalHaber = groupMovs.reduce((sum, m) => sum + parseFloat(m.haber || 0), 0);
                      const isCancelled = groupMovs.some(m => m.concepto.toLowerCase().includes('cancelación') || m.concepto.toLowerCase().includes('cancelacion'));

                      let paymentStatus = 'pending';
                      if (isCancelled) {
                        paymentStatus = 'cancelled';
                      } else if (totalHaber >= totalDebe) {
                        paymentStatus = 'paid';
                      }

                      return {
                        type: 'order_group',
                        orderId,
                        date: groupDate,
                        movements: groupMovs,
                        paymentStatus
                      };
                    });

                    standalone.forEach(m => {
                      sortedGroups.push({
                        type: 'standalone',
                        date: new Date(m.fecha).getTime(),
                        movements: [m],
                        paymentStatus: 'none'
                      });
                    });

                    // Sort groups by date descending (newest first)
                    sortedGroups.sort((a, b) => b.date - a.date);

                    return sortedGroups.map((group, idx) => {
                      if (group.type === 'order_group') {
                        let statusBadge = null;
                        let mainBgColor = '#f8fafc';
                        if (group.paymentStatus === 'pending') {
                          statusBadge = <span className="badge-tag" style={{ backgroundColor: '#fee2e2', color: '#ef4444', borderColor: '#fecaca', fontSize: '0.65rem', padding: '2px 6px', fontWeight: '800', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>Pendiente</span>;
                          mainBgColor = '#fff5f5';
                        } else if (group.paymentStatus === 'paid') {
                          statusBadge = <span className="badge-tag" style={{ backgroundColor: '#ecfdf5', color: '#10b981', borderColor: '#a7f3d0', fontSize: '0.65rem', padding: '2px 6px', fontWeight: '800', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>Pagado</span>;
                          mainBgColor = '#f0fdf4';
                        } else if (group.paymentStatus === 'cancelled') {
                          statusBadge = <span className="badge-tag" style={{ backgroundColor: '#f1f5f9', color: '#64748b', borderColor: '#cbd5e1', fontSize: '0.65rem', padding: '2px 6px', fontWeight: '800', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>Cancelado</span>;
                          mainBgColor = '#f8fafc';
                        }

                        const mainMov = group.movements[0];

                        return (
                          <div key={`g_${group.orderId}_${idx}`} style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            backgroundColor: '#ffffff',
                            marginBottom: '14px',
                            boxShadow: 'var(--shadow-sm)',
                            overflow: 'hidden'
                          }}>
                            {/* Main Order Row */}
                            <div style={{
                              padding: '12px 14px',
                              borderBottom: group.movements.length > 1 ? '1px dashed var(--border-color)' : 'none',
                              backgroundColor: mainBgColor,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, marginRight: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span className="movement-concept text-dark" style={{ fontWeight: '700' }}>{cleanConceptForDisplay(mainMov.concepto)}</span>
                                  {statusBadge}
                                </div>
                                <span className="movement-date">
                                  {new Date(mainMov.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div>
                                <span className="movement-value-debe">+ $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(mainMov.debe)}</span>
                              </div>
                            </div>

                            {/* Sub payments/reversions */}
                            {group.movements.slice(1).map((subMov, sIdx) => {
                              const isSubCharge = subMov.debe > 0;
                              return (
                                <div key={subMov.id || `sub_${sIdx}`} style={{
                                  padding: '10px 14px 10px 32px',
                                  borderBottom: sIdx < group.movements.length - 2 ? '1px solid #f1f5f9' : 'none',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  backgroundColor: '#ffffff'
                                }}>
                                  <div className="movement-info" style={{ position: 'relative', flex: 1, marginRight: '8px' }}>
                                    <span style={{
                                      position: 'absolute',
                                      left: '-16px',
                                      top: '2px',
                                      width: '10px',
                                      height: '12px',
                                      borderLeft: '2px solid #cbd5e1',
                                      borderBottom: '2px solid #cbd5e1',
                                      borderBottomLeftRadius: '3px'
                                    }}></span>
                                    <span className="movement-concept text-dark" style={{ fontSize: '0.85rem', color: '#475569', fontWeight: '500' }}>{cleanConceptForDisplay(subMov.concepto)}</span>
                                    <span className="movement-date" style={{ fontSize: '0.7rem' }}>
                                      {new Date(subMov.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <div>
                                    {isSubCharge ? (
                                      <span className="movement-value-debe" style={{ fontSize: '0.85rem' }}>+ $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(subMov.debe)}</span>
                                    ) : (
                                      <span className="movement-value-haber" style={{ fontSize: '0.85rem' }}>- $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(subMov.haber)}</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      } else {
                        // Standalone movement
                        const standMov = group.movements[0];
                        const isStandCharge = standMov.debe > 0;
                        return (
                          <div key={`s_${standMov.id}_${idx}`} style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            backgroundColor: '#ffffff',
                            marginBottom: '14px',
                            boxShadow: 'var(--shadow-sm)',
                            padding: '12px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div className="movement-info" style={{ flex: 1, marginRight: '8px' }}>
                              <span className="movement-concept text-dark" style={{ fontWeight: '600' }}>{cleanConceptForDisplay(standMov.concepto)}</span>
                              <span className="movement-date">
                                {new Date(standMov.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div>
                              {isStandCharge ? (
                                <span className="movement-value-debe">+ $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(standMov.debe)}</span>
                              ) : (
                                <span className="movement-value-haber">- $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(standMov.haber)}</span>
                              )}
                            </div>
                          </div>
                        );
                      }
                    });
                  })()}
                </div>
              ) : (
                <div className="empty-message text-center py-5">Sin movimientos registrados.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW: CLIENTS MANAGEMENT (CLIENTES)                            */}
      {/* ============================================================== */}
      {viewMode === 'clients' && (
        <div>
          {/* Header & Add Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Buscar por nombre, CUIT, Razón Social..." 
                style={{ maxWidth: '280px', fontSize: '0.9rem' }}
                value={clientSearchQuery}
                onChange={(e) => setClientSearchQuery(e.target.value)}
              />
              {clientSearchQuery && (
                <button 
                  type="button" 
                  className="btn-nav-back"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setClientSearchQuery('')}
                >
                  Limpiar
                </button>
              )}
            </div>
            <button 
              type="button" 
              className="btn-new-task" 
              style={{ backgroundColor: '#10b981', color: '#ffffff' }}
              onClick={() => {
                setNewClientName('');
                setNewClientRazon('');
                setNewClientCuit('');
                setNewClientTelefono('');
                setNewClientCondicionIva('Consumidor Final');
                setNewClientError('');
                setNewClientModal(true);
              }}
            >
              <i className="bi bi-person-plus me-1"></i> Nuevo Cliente
            </button>
          </div>

          {/* Clients List Table */}
          <div className="table-responsive">
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', backgroundColor: '#f8fafc' }}>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('nombre')}
                  >
                    Nombre / Fantasía {clientSortField === 'nombre' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('razon_social')}
                  >
                    Razón Social {clientSortField === 'razon_social' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('cuit')}
                  >
                    CUIT {clientSortField === 'cuit' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('condicion_iva')}
                  >
                    Condición IVA {clientSortField === 'condicion_iva' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('telefono')}
                  >
                    Teléfono {clientSortField === 'telefono' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortClients('saldo')}
                  >
                    Saldo {clientSortField === 'saldo' && (clientSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientes
                  .filter(c => {
                    const query = clientSearchQuery.toLowerCase().trim();
                    if (!query) return true;
                    return (
                      c.nombre.toLowerCase().includes(query) || 
                      (c.razon_social && c.razon_social.toLowerCase().includes(query)) ||
                      (c.cuit && c.cuit.includes(query))
                    );
                  })
                  .sort((a, b) => {
                    let comparison = 0;
                    if (clientSortField === 'nombre') {
                      comparison = (a.nombre || '').localeCompare(b.nombre || '');
                    } else if (clientSortField === 'razon_social') {
                      comparison = (a.razon_social || '').localeCompare(b.razon_social || '');
                    } else if (clientSortField === 'cuit') {
                      comparison = (a.cuit || '').localeCompare(b.cuit || '');
                    } else if (clientSortField === 'condicion_iva') {
                      comparison = (a.condicion_iva || '').localeCompare(b.condicion_iva || '');
                    } else if (clientSortField === 'telefono') {
                      comparison = (a.telefono || '').localeCompare(b.telefono || '');
                    } else if (clientSortField === 'saldo') {
                      comparison = (parseFloat(a.saldo) || 0) - (parseFloat(b.saldo) || 0);
                    }
                    return clientSortAsc ? comparison : -comparison;
                  })
                  .map(c => {
                    const isDeudor = c.saldo > 0;
                    const isFavor = c.saldo < 0;
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 8px', fontWeight: '600' }}>{c.nombre}</td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{c.razon_social || '-'}</td>
                        <td style={{ padding: '12px 8px' }}>{c.cuit && c.cuit !== 'N/A' ? formatCuit(c.cuit) : '-'}</td>
                        <td style={{ padding: '12px 8px' }}>{c.condicion_iva}</td>
                        <td style={{ padding: '12px 8px' }}>{c.telefono || '-'}</td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'right', 
                          fontWeight: '700',
                          color: isDeudor ? '#ef4444' : isFavor ? '#10b981' : 'var(--text-dark)'
                        }}>
                          {isFavor ? (
                            <span>A favor: $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(Math.abs(c.saldo))}</span>
                          ) : (
                            <span>$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(c.saldo)}</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                            <button 
                              type="button" 
                              className="btn-nav-back" 
                              style={{ padding: '4px 8px', minWidth: 'auto', border: '1px solid var(--border-color)', color: '#8b5cf6' }}
                              onClick={() => handleOpenClientMovements(c)}
                              title="Ver Cuenta Corriente (Movimientos)"
                            >
                              <i className="bi bi-clock-history"></i>
                            </button>
                            <button 
                              type="button" 
                              className="btn-nav-back" 
                              style={{ padding: '4px 8px', minWidth: 'auto', border: '1px solid var(--border-color)', color: '#10b981' }}
                              onClick={() => handleOpenEditClientModal(c)}
                              title="Editar Datos"
                            >
                              <i className="bi bi-pencil-fill"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                {clientes.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      No hay clientes registrados en el sistema.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW: REPARTIDORES                                             */}
      {/* ============================================================== */}
      {viewMode === 'repartidores' && (
        <div>
          <div style={{ marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Cargá acá los repartidores para asignarlos rápido al enviar pedidos a reparto.
          </div>

          <form onSubmit={handleAddRepartidor} style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Nombre del repartidor..."
              value={newRepartidorInput}
              onChange={(e) => setNewRepartidorInput(e.target.value)}
              style={{ flex: '1 1 240px', margin: 0 }}
              disabled={repartidoresSaving}
            />
            <button
              type="submit"
              className="btn-new-task"
              style={{ backgroundColor: '#2563eb', color: '#fff' }}
              disabled={repartidoresSaving || !newRepartidorInput.trim()}
            >
              <i className="bi bi-plus-lg me-1"></i>
              {repartidoresSaving ? 'Guardando...' : 'Agregar'}
            </button>
          </form>

          {repartidores.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {repartidores.map((name, index) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <span style={{ fontWeight: '600' }}>
                    <i className="bi bi-person-badge me-2" style={{ color: '#2563eb' }}></i>
                    {name}
                  </span>
                  <button
                    type="button"
                    className="btn-nav-back"
                    style={{ padding: '4px 10px', color: '#ef4444', border: '1px solid #fecaca' }}
                    onClick={() => handleRemoveRepartidor(index)}
                    disabled={repartidoresSaving}
                    title="Quitar repartidor"
                  >
                    <i className="bi bi-trash-fill"></i>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted p-4 small" style={{ border: '1px dashed var(--border-color)', borderRadius: '10px', backgroundColor: '#f8fafc' }}>
              Todavía no hay repartidores cargados.
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: EDITAR CLIENTE                                          */}
      {/* ============================================================== */}
      {editClientModal && editingClient && (
        <div className="modal-backdrop" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}>
          <div className="page-card" style={{ width: '95%', maxWidth: '600px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.3s ease-out', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', margin: 0, color: '#10b981' }}>
                <i className="bi bi-pencil-square me-2"></i>Editar Cliente: {editingClient.nombre}
              </h3>
              <button 
                type="button" 
                className="btn-nav-back" 
                style={{ padding: '4px 8px', border: 'none' }}
                onClick={() => setEditClientModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <form onSubmit={handleSaveEditedClient}>
              <div className="form-group mb-3">
                <label className="form-label text-dark">Nombre / Fantasía</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editClientNombre}
                  onChange={(e) => setEditClientNombre(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }} className="mb-3">
                <div className="form-group mb-0">
                  <label className="form-label text-dark">Razón Social</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={editClientRazonSocial}
                    onChange={(e) => setEditClientRazonSocial(e.target.value)}
                  />
                </div>
                
                <div className="form-group mb-0">
                  <label className="form-label text-dark">CUIT</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: 20-12345678-9"
                    value={editClientCuit}
                    onChange={(e) => {
                      // Format CUIT
                      let val = e.target.value.replace(/[^0-9]/g, '');
                      if (val.length > 11) val = val.substring(0, 11);
                      let formatted = '';
                      if (val.length > 0) formatted += val.substring(0, 2);
                      if (val.length > 2) formatted += '-' + val.substring(2, 10);
                      if (val.length > 10) formatted += '-' + val.substring(10, 11);
                      setEditClientCuit(formatted);
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }} className="mb-3">
                <div className="form-group mb-0">
                  <label className="form-label text-dark">Condición IVA</label>
                  <select 
                    className="form-select"
                    value={editClientCondicionIva}
                    onChange={(e) => setEditClientCondicionIva(e.target.value)}
                    required
                  >
                    <option value="Consumidor Final">Consumidor Final</option>
                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                    <option value="Monotributista">Monotributista</option>
                    <option value="Exento">Exento</option>
                  </select>
                </div>
                
                <div className="form-group mb-0">
                  <label className="form-label text-dark">Teléfono</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: 5492994123456"
                    value={editClientTelefono}
                    onChange={(e) => setEditClientTelefono(e.target.value)}
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="btn-submit"
                style={{ backgroundColor: '#10b981', width: '100%', padding: '10px 20px', marginBottom: '25px' }}
                disabled={savingClient}
              >
                {savingClient ? 'Guardando...' : 'Guardar Datos Básicos'}
              </button>
            </form>

            {/* Address Management Subsection */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
              <h4 style={{ fontSize: '1rem', color: 'var(--text-dark)', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="bi bi-geo-alt-fill text-danger"></i> Direcciones de Envío
              </h4>

              {/* Add address input */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Nueva dirección (Ej: Av. Argentina 120, Neuquén)..."
                  value={newEditAddressText}
                  onChange={(e) => setNewEditAddressText(e.target.value)}
                  style={{ margin: 0, flex: 1, fontSize: '0.9rem' }}
                />
                <button 
                  type="button" 
                  className="btn-new-task"
                  style={{ backgroundColor: '#475569', color: '#ffffff', margin: 0, padding: '0 15px' }}
                  onClick={handleAddEditAddress}
                >
                  Agregar
                </button>
              </div>

              {/* Addresses List */}
              <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {editingClientAddresses.length > 0 ? (
                  editingClientAddresses.map((addr) => {
                    const isDefault = editingClient.direccion_predeterminada === addr.direccion;
                    return (
                      <div 
                        key={addr.id} 
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '8px 12px', 
                          backgroundColor: isDefault ? '#ecfdf5' : '#f8fafc', 
                          border: isDefault ? '1px solid #10b981' : '1px solid #e2e8f0',
                          borderRadius: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.9rem', color: '#334155', fontWeight: isDefault ? '600' : 'normal' }}>
                            {cleanAddressText(addr.direccion)}
                          </span>
                          {isValidGpsAddress(addr.direccion) && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                              <a 
                                href={getGmapsUrl(addr.direccion)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: '0.75rem', textDecoration: 'none', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '2px' }}
                              >
                                🗺️ Ver Mapa
                              </a>
                              <button 
                                type="button"
                                style={{ background: 'none', border: 'none', padding: 0, color: '#8b5cf6', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px' }}
                                onClick={() => {
                                  const gmapsUrl = getGmapsUrl(addr.direccion);
                                  setLocationQrData({
                                    address: cleanAddressText(addr.direccion),
                                    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(gmapsUrl)}`
                                  });
                                  setShowLocationQrModal(true);
                                }}
                              >
                                📱 Código QR
                              </button>
                            </div>
                          )}
                        </div>
                        
                        <div>
                          {isDefault ? (
                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#10b981', padding: '2px 8px', backgroundColor: '#d1fae5', borderRadius: '12px' }}>
                              Predeterminada
                            </span>
                          ) : (
                            <button 
                              type="button" 
                              className="btn-nav-back"
                              style={{ padding: '3px 8px', fontSize: '0.75rem', border: '1px solid #cbd5e1' }}
                              onClick={() => handleSetDefaultAddress(addr.direccion)}
                            >
                              Marcar Predeterminada
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px' }}>
                    Sin direcciones registradas. Agrega una arriba.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: DEVOLVER SALDO A FAVOR                                  */}
      {/* ============================================================== */}
      {refundModal && selectedClient && (
        <div className="modal-backdrop" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100 }}>
          <div className="page-card" style={{ width: '90%', maxWidth: '400px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.3s ease-out', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', margin: 0, color: '#10b981' }}>
                <i className="bi bi-cash-coin me-2"></i>Devolver Saldo
              </h3>
              <button 
                type="button" 
                className="btn-nav-back" 
                style={{ padding: '4px 8px', border: 'none' }}
                onClick={() => setRefundModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <form onSubmit={handleSubmitRefund}>
              <div className="alert-box" style={{ backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46', marginBottom: '15px', fontSize: '0.85rem' }}>
                <i className="bi bi-info-circle-fill"></i>
                <div>
                  Saldo a favor disponible: <strong>$ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(Math.abs(selectedClient.saldo))}</strong>
                </div>
              </div>

              <div className="form-group mb-3">
                <label className="form-label text-dark">Monto a Devolver ($)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  onKeyDown={handleNumericKeyDown}
                  step="any"
                  min="0.01"
                  max={Math.abs(selectedClient.saldo)}
                  required
                />
              </div>

              <div className="form-group mb-4">
                <label className="form-label text-dark">Medio de Pago</label>
                <select 
                  className="form-select"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  required
                >
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia Bancaria">Transferencia Bancaria</option>
                  <option value="Mercado Pago">Mercado Pago</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn-nav-back"
                  onClick={() => setRefundModal(false)}
                  disabled={submittingRefund}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  style={{ backgroundColor: '#10b981', width: 'auto', padding: '10px 20px' }}
                  disabled={submittingRefund}
                >
                  {submittingRefund ? 'Procesando...' : 'Confirmar Devolución'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW: PRODUCTS INVENTORY (PRODUCTOS / STOCK)                   */}
      {/* ============================================================== */}
      {viewMode === 'products' && (
        <div>
          {/* Header & Add Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Buscar por nombre o rubro..." 
                style={{ maxWidth: '280px', fontSize: '0.9rem' }}
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
              />
              {productSearchQuery && (
                <button 
                  type="button" 
                  className="btn-nav-back"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setProductSearchQuery('')}
                >
                  Limpiar
                </button>
              )}
            </div>
            <button 
              type="button" 
              className="btn-new-task" 
              style={{ backgroundColor: '#8b5cf6', color: '#ffffff' }}
              onClick={() => handleOpenProductModal(null)}
            >
              <i className="bi bi-plus-circle me-1"></i> Nuevo Producto
            </button>
          </div>

          {/* Products List Table */}
          <div className="table-responsive">
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', backgroundColor: '#f8fafc' }}>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortProducts('nombre')}
                  >
                    Nombre {productSortField === 'nombre' && (productSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortProducts('rubro')}
                  >
                    Rubro {productSortField === 'rubro' && (productSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortProducts('precio')}
                  >
                    Precio {productSortField === 'precio' && (productSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortProducts('stock')}
                  >
                    Stock {productSortField === 'stock' && (productSortAsc ? '▴' : '▾')}
                  </th>
                  <th 
                    style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortProducts('iva')}
                  >
                    IVA {productSortField === 'iva' && (productSortAsc ? '▴' : '▾')}
                  </th>
                  <th style={{ padding: '12px 8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter(p => {
                    const query = productSearchQuery.toLowerCase().trim();
                    if (!query) return true;
                    return p.nombre.toLowerCase().includes(query) || (p.rubro && p.rubro.toLowerCase().includes(query));
                  })
                  .sort((a, b) => {
                    let comparison = 0;
                    if (productSortField === 'nombre') {
                      comparison = (a.nombre || '').localeCompare(b.nombre || '');
                    } else if (productSortField === 'rubro') {
                      comparison = (a.rubro || '').localeCompare(b.rubro || '');
                    } else if (productSortField === 'precio') {
                      comparison = (parseFloat(a.precio) || 0) - (parseFloat(b.precio) || 0);
                    } else if (productSortField === 'stock') {
                      comparison = (parseFloat(a.stock) || 0) - (parseFloat(b.stock) || 0);
                    } else if (productSortField === 'iva') {
                      comparison = (parseFloat(a.iva) || 0) - (parseFloat(b.iva) || 0);
                    }
                    return productSortAsc ? comparison : -comparison;
                  })
                  .map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: '600' }}>{p.nombre}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{p.rubro || '-'}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '700' }}>
                        $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(p.precio)}
                      </td>
                      <td style={{ 
                        padding: '12px 8px', 
                        textAlign: 'right', 
                        fontWeight: '700',
                        color: parseFloat(p.stock || 0) <= 0 ? '#ef4444' : parseFloat(p.stock || 0) <= 5 ? '#f97316' : 'var(--text-dark)'
                      }}>
                        {p.stock !== undefined ? p.stock : '0'}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span style={{ 
                          padding: '3px 8px', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 'bold',
                          backgroundColor: p.iva === 0 ? '#ecfdf5' : p.iva === 10.5 ? '#eff6ff' : '#f5f3ff',
                          color: p.iva === 0 ? '#10b981' : p.iva === 10.5 ? '#3b82f6' : '#8b5cf6'
                        }}>
                          {p.iva !== undefined ? `${p.iva}%` : '21%'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                          <button 
                            type="button" 
                            className="btn-nav-back" 
                            style={{ padding: '4px 8px', minWidth: 'auto', border: '1px solid var(--border-color)', color: '#8b5cf6' }}
                            onClick={() => handleOpenProductModal(p)}
                            title="Editar"
                          >
                            <i className="bi bi-pencil-fill"></i>
                          </button>
                          <button 
                            type="button" 
                            className="btn-nav-back" 
                            style={{ padding: '4px 8px', minWidth: 'auto', border: '1px solid var(--border-color)', color: '#ef4444' }}
                            onClick={() => handleDeleteProduct(p.id)}
                            title="Eliminar"
                          >
                            <i className="bi bi-trash-fill"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      No hay productos registrados en el inventario.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: NUEVO / EDITAR PRODUCTO                                 */}
      {/* ============================================================== */}
      {newProductModal && (
        <div className="modal-backdrop" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}>
          <div className="page-card" style={{ width: '90%', maxWidth: '450px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.3s ease-out', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', margin: 0, color: '#8b5cf6' }}>
                {editingProduct ? 'Editar Producto' : 'Crear Nuevo Producto'}
              </h3>
              <button 
                type="button" 
                className="btn-nav-back" 
                style={{ padding: '4px 8px', border: 'none' }}
                onClick={() => setNewProductModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <form onSubmit={handleSaveProduct}>
              <div className="form-group mb-3">
                <label className="form-label">Nombre del Producto</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: Yerba Mate Orgánica (1kg)"
                  value={prodNombre}
                  onChange={(e) => setProdNombre(e.target.value)}
                  required
                />
              </div>

              <div className="form-group mb-3">
                <label className="form-label">Rubro / Categoría</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: Almacén, Bebidas, Limpieza..."
                  value={prodRubro}
                  onChange={(e) => setProdRubro(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }} className="mb-3">
                <div className="form-group mb-0">
                  <label className="form-label">Precio Final ($)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="0.00"
                    step="any"
                    min="0"
                    value={prodPrecio}
                    onChange={(e) => setProdPrecio(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    required
                  />
                </div>
                
                <div className="form-group mb-0">
                  <label className="form-label">Stock</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="0"
                    step="any"
                    value={prodStock}
                    onChange={(e) => setProdStock(e.target.value)}
                    onKeyDown={handleNumericKeyDown}
                    required
                  />
                </div>
              </div>

              <div className="form-group mb-4">
                <label className="form-label">Alícuota de IVA</label>
                <select 
                  className="form-select"
                  value={prodIva}
                  onChange={(e) => setProdIva(parseFloat(e.target.value))}
                  required
                >
                  <option value={21.00}>21.0% (Tasa General)</option>
                  <option value={10.50}>10.5% (Tasa Reducida)</option>
                  <option value={0.00}>0% / Exento</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn-nav-back"
                  onClick={() => setNewProductModal(false)}
                  disabled={savingProduct}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  style={{ backgroundColor: '#8b5cf6', width: 'auto', padding: '10px 20px' }}
                  disabled={savingProduct}
                >
                  {savingProduct ? 'Guardando...' : 'Guardar Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLocationQrModal && locationQrData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200
        }}>
          <div className="page-card" style={{
            width: '90%', maxWidth: '380px', padding: '25px', boxShadow: 'var(--shadow-lg)',
            textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '15px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#8b5cf6', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="bi bi-qr-code"></i> Ubicación GPS
              </h3>
              <button 
                type="button" 
                className="btn-close" 
                style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setShowLocationQrModal(false);
                  setLocationQrData(null);
                }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ margin: '10px 0' }}>
              <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '15px', fontWeight: '500' }}>
                Escaneá con tu celular para abrir en el mapa:
              </p>
              <div style={{ backgroundColor: '#f8fafc', padding: '15px', borderRadius: '12px', display: 'inline-block', border: '1px solid #e2e8f0', marginBottom: '15px' }}>
                <img 
                  src={locationQrData.qrUrl} 
                  alt="QR Code de Ubicación" 
                  style={{ width: '200px', height: '200px', display: 'block' }}
                />
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', wordBreak: 'break-word', padding: '0 10px' }}>
                {locationQrData.address}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
              <button 
                type="button" 
                className="btn-new-task" 
                style={{ backgroundColor: '#475569', color: 'white', padding: '8px 16px', fontSize: '0.85rem', margin: 0 }}
                onClick={() => {
                  setShowLocationQrModal(false);
                  setLocationQrData(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvoiceOptions && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          width: '100vw', 
          height: '100vh', 
          backgroundColor: 'rgba(0,0,0,0.8)', 
          zIndex: 99999, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          backdropFilter: 'none' // Disable any background blur that might be causing issues
        }}>
          <div style={{ 
            width: '90%', 
            maxWidth: '400px', 
            backgroundColor: '#ffffff', 
            borderRadius: '24px', 
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', 
            overflow: 'hidden',
            animation: 'zoomIn 0.3s ease-out'
          }}>
            <div style={{ padding: '30px 24px 20px', textAlign: 'center', position: 'relative' }}>
              <button 
                onClick={() => setShowInvoiceOptions(false)}
                style={{ 
                  position: 'absolute', 
                  top: '15px', 
                  right: '15px', 
                  background: 'none', 
                  border: 'none', 
                  fontSize: '1.5rem', 
                  cursor: 'pointer',
                  color: '#94a3b8'
                }}
              >
                <i className="bi bi-x"></i>
              </button>
              
              <h5 style={{ fontWeight: '800', fontSize: '1.4rem', color: '#1e293b', marginBottom: '10px' }}>Opciones de Factura</h5>
              <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '30px', padding: '0 10px' }}>
                ¿Cómo deseás gestionar la factura del pedido?
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '12px', 
                    padding: '18px', 
                    borderRadius: '16px', 
                    backgroundColor: '#3b82f6', 
                    color: 'white', 
                    border: 'none', 
                    fontWeight: '700',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)'
                  }}
                  onClick={() => {
                    handleDownloadInvoice(selectedOrderForInvoice);
                    setShowInvoiceOptions(false);
                  }}
                >
                  <i className="bi bi-file-pdf-fill" style={{ fontSize: '1.2rem' }}></i> Descargar PDF
                </button>
                
                <button 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '12px', 
                    padding: '18px', 
                    borderRadius: '16px', 
                    backgroundColor: '#25D366', 
                    color: 'white', 
                    border: 'none', 
                    fontWeight: '700',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(37, 211, 102, 0.3)'
                  }}
                  onClick={() => handleShareInvoiceViaWhatsApp(selectedOrderForInvoice)}
                >
                  <i className="bi bi-whatsapp" style={{ fontSize: '1.2rem' }}></i> Enviar por WhatsApp
                </button>
              </div>
              
              <button 
                style={{ 
                  marginTop: '20px', 
                  background: 'none', 
                  border: 'none', 
                  color: '#94a3b8', 
                  fontSize: '0.9rem', 
                  fontWeight: '600', 
                  cursor: 'pointer' 
                }}
                onClick={() => setShowInvoiceOptions(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Clientes;
