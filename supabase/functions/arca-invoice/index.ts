import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Afip from "npm:@afipsdk/afip.js"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestBody = await req.json()
    const { 
      orderId, 
      cuitEmisor, 
      puntoVenta, 
      total, 
      items, 
      facturaTipo, 
      ambiente, 
      cert, 
      key,
      cuitReceptor,
      accessToken
    } = requestBody

    console.log(`[ARCA Invoicing Request Received]`)
    console.log(`Order ID: ${orderId}, CUIT Emisor: ${cuitEmisor}, PV: ${puntoVenta}, Tipo: ${facturaTipo}, Ambiente: ${ambiente}, Total: $${total}`)

    const cuitClean = String(cuitEmisor).replace(/[^0-9]/g, '')
    const puntoVentaNum = parseInt(puntoVenta, 10) || 1

    // Detect if we should use Mock Simulator (e.g. if CUIT is dummy or certs are missing)
    const isDummyCuit = !cuitClean || cuitClean.length !== 11 || cuitClean.startsWith('123456')
    const useMock = isDummyCuit || !cert || !key || cert.trim() === '' || key.trim() === ''

    if (useMock) {
      console.log(`[ARCA Simulator] Using mock connection because of missing or test credentials.`)
      
      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const randomInvoiceNum = Math.floor(Math.random() * 90000) + 10000
      const nextInvoiceNumStr = `${String(puntoVentaNum).padStart(4, '0')}-${String(randomInvoiceNum).padStart(8, '0')}`
      const cae = "7628" + Math.floor(1000000000 + Math.random() * 9000000000)
      const vencimientoCaeDate = new Date()
      vencimientoCaeDate.setDate(vencimientoCaeDate.getDate() + 10)
      
      return new Response(
        JSON.stringify({
          cae: cae,
          cae_vencimiento: vencimientoCaeDate.toISOString().split('T')[0],
          factura_nro: nextInvoiceNumStr,
          factura_fecha: new Date().toISOString().split('T')[0],
          factura_tipo: facturaTipo === 'A' ? 'Factura A' : 'Factura B',
          error: null
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    console.log(`[ARCA Real SOAP Client via afipsdk] Connecting to AFIP ${ambiente} environment...`)
    
    // Instanciar el SDK de AFIP
    const afip = new Afip({
      CUIT: parseInt(cuitClean, 10),
      cert: cert,
      key: key,
      production: (ambiente === 'produccion'),
      res_folder: '/tmp',
      access_token: accessToken || undefined
    })

    // Configurar Tipo de Comprobante (1 para Factura A, 6 para Factura B)
    const cbteTipo = facturaTipo === 'A' ? 1 : 6

    // Configurar Receptor
    // Por defecto, asumimos Consumidor Final (DNI 99, número 0)
    let docTipo = 99
    let docNro = 0

    const cuitReceptorClean = cuitReceptor ? String(cuitReceptor).replace(/[^0-9]/g, '') : ''
    
    if (cuitReceptorClean && cuitReceptorClean.length === 11) {
      docTipo = 80 // CUIT
      docNro = parseInt(cuitReceptorClean, 10)
    } else if (cuitReceptorClean && cuitReceptorClean.length >= 7 && cuitReceptorClean.length <= 8) {
      docTipo = 96 // DNI
      docNro = parseInt(cuitReceptorClean, 10)
    }

    if (cbteTipo === 1 && docTipo !== 80) {
      throw new Error("Factura A requiere obligatoriamente un CUIT válido del cliente receptor.")
    }

    // Consultar el último número de comprobante registrado en AFIP para este punto de venta y tipo
    console.log(`[ARCA WSFE] Querying last voucher for PV: ${puntoVentaNum}, Type: ${cbteTipo}...`)
    const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoVentaNum, cbteTipo)
    const nextVoucher = lastVoucher + 1

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '') // Formato YYYYMMDD
    
    // Group and calculate tax basis and splits (21%, 10.5%, 0%)
    const rateTotals: Record<number, number> = {}
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const qty = parseFloat(item.cantidad || 0)
        const val = parseFloat(item.valor || 0)
        const rate = parseFloat(item.iva_alicuota !== undefined ? item.iva_alicuota : 21)
        const subtotal = qty * val
        rateTotals[rate] = (rateTotals[rate] || 0) + subtotal
      }
    } else {
      // Fallback: entire amount treated at general 21% rate
      rateTotals[21] = parseFloat(total)
    }

    const roundVal = (val: number) => Math.round((val + Number.EPSILON) * 100) / 100

    let impNeto = 0
    let impIva = 0
    let impOpEx = 0
    const ivaList: Array<{ Id: number, BaseImp: number, Importe: number }> = []

    const IVA_MAP: Record<number, number> = {
      21: 5,
      10.5: 4,
      27: 6
    }

    for (const [rateStr, subtotal] of Object.entries(rateTotals)) {
      const rate = parseFloat(rateStr)
      if (rate === 0) {
        impOpEx += roundVal(subtotal)
      } else {
        const divisor = 1 + (rate / 100)
        const net = subtotal / divisor
        const iva = subtotal - net
        const roundedNet = roundVal(net)
        const roundedIva = roundVal(iva)
        
        ivaList.push({
          Id: IVA_MAP[rate] || 5,
          BaseImp: roundedNet,
          Importe: roundedIva
        })
        impNeto += roundedNet
        impIva += roundedIva
      }
    }

    const calculatedTotal = roundVal(impNeto + impIva + impOpEx)

    // Crear el comprobante
    const voucherData: any = {
      CantReg: 1,
      PtoVta: puntoVentaNum,
      CbteTipo: cbteTipo,
      Concepto: 1, // 1 = Productos
      DocTipo: docTipo,
      DocNro: docNro,
      CbteDesde: nextVoucher,
      CbteHasta: nextVoucher,
      CbteFch: parseInt(dateStr, 10),
      ImpTotal: calculatedTotal,
      ImpTotConc: 0,
      ImpNeto: roundVal(impNeto),
      ImpOpEx: roundVal(impOpEx),
      ImpTrib: 0,
      ImpIva: roundVal(impIva),
      ImpIVA: roundVal(impIva),
      MonId: 'PES',
      MonCotiz: 1,
      FchServDesde: null,
      FchServHasta: null,
      FchVtoPago: null
    }

    if (ivaList.length > 0) {
      voucherData.Iva = ivaList
    }

    console.log(`[ARCA WSFE] Requesting CAE for Voucher #${nextVoucher}... Payload:`, JSON.stringify(voucherData))
    const result = await afip.ElectronicBilling.createVoucher(voucherData)

    let formattedVto = result.CAEFchVto
    if (formattedVto && formattedVto.length === 8 && !formattedVto.includes('-')) {
      formattedVto = `${formattedVto.substring(0, 4)}-${formattedVto.substring(4, 6)}-${formattedVto.substring(6, 8)}`
    }

    const responseData = {
      cae: result.CAE,
      cae_vencimiento: formattedVto, // Formateado como YYYY-MM-DD
      factura_nro: `${String(puntoVentaNum).padStart(4, '0')}-${String(nextVoucher).padStart(8, '0')}`,
      factura_fecha: new Date().toISOString().split('T')[0],
      factura_tipo: cbteTipo === 1 ? 'Factura A' : 'Factura B',
      error: null
    }

    console.log(`[ARCA WSFE Success] Deployed CAE: ${result.CAE} for invoice ${responseData.factura_nro}`)
    
    return new Response(
      JSON.stringify(responseData),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error(`[ARCA Edge Function Exception]`, error)
    return new Response(
      JSON.stringify({ error: error.message || String(error) }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
