# Plan de módulo — Resultados

Documento de diseño para implementar el módulo **Resultados** en Gestion360i.  
Estado: **planificación cerrada** · Última actualización: 2026-08-07

---

## 1. Objetivo

Dar al dueño/administrador una **vista financiera clara del negocio** en un solo lugar:

1. **Resumen ejecutivo** — números clave del período (tarjetas).
2. **Ventas por caja + composición** — total general y desglose por turno/caja y por medio de pago.
3. **Gráficos** — tendencias y composición de egresos.
4. **Grilla detalle tipo Excel** — cada movimiento exportable, filtrable y ordenable.
5. **Export PDF y Excel** — del resumen y del detalle del período.

No reemplaza la contabilidad formal ni AFIP. Es un **panel operativo** armado con los datos que el sistema ya registra.

---

## 2. Decisiones acordadas

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Cómo medir ventas? | **Por caja (turno) y total del período.** Además, **composición de cada venta** por medio de pago (efectivo, tarjeta, cuenta corriente, etc.) desde `gst_cierres_caja.medio_01..15` con nombres de `cierre_conceptos`. |
| 2 | ¿Incluir cuenta corriente clientes? | **Sí.** Cobros, cargos y saldos en tab dedicado y en movimientos unificados. |
| 3 | ¿Período default? | **Mes en curso** al entrar al módulo. |
| 4 | ¿KPIs extra? | **No por ahora** (sin % delivery/local ni similares en MVP). |
| 5 | ¿Export? | **PDF y Excel** desde el MVP (no postergar PDF). |

---

## 3. Usuarios y permisos

| Rol        | Acceso propuesto                                      |
|-----------|--------------------------------------------------------|
| `admin`   | Lectura completa + export PDF y Excel                  |
| `cajero`  | Solo lectura (configurable en `role_permissions`)      |
| `operario`| Sin acceso por defecto                                 |

---

## 4. Qué significa cada número (definiciones)

| Métrica | Fuente principal | Notas |
|--------|------------------|-------|
| **Ventas totales** | Σ `gst_cierres_caja.total` | Suma de todos los cierres del período (número “oficial” de ingresos). |
| **Ventas por caja** | `gst_cierres_caja` agrupado por `turno` | Una fila por cierre: fecha, turno/caja, total. |
| **Composición de venta** | `medio_01..15` + `cierre_conceptos` | Efectivo (`medio_01`), tarjetas, transferencias, cuenta corriente, etc. según configuración de medios. |
| **Cuenta corriente clientes** | `gst_cliente_movimientos` | Cobros (ingreso), cargos por pedidos (no caja inmediata). Tab propio + filas en Movimientos. |
| **Compras / gastos** | `gst_compras` | Por `fecha`, IVA desglosado. |
| **Pagos proveedores** | `gst_proveedor_pagos` + CC proveedores | Egresos. |
| **Impuestos y servicios** | Pago Impuestos | Sin factura de compra. |
| **Adelantos** | `gst_empleado_movimientos` | Efectivo + mercadería. |
| **Pagos periódicos** | `gst_pagos_periodicos` (pagados) | Gastos fijos. |
| **Resultado operativo** | fórmula | `Ventas (cierres) − Egresos operativos`. CC clientes se muestra aparte; no se mezcla con caja para no duplicar. |

> No hay **CMV** por producto hoy. El resultado es **operativo de caja**, no margen contable.

---

## 5. Fuentes de datos

```
gst_cierres_caja         → ventas por turno, medios medio_01..15, compras/adelantos del turno
gst_pedidos              → cruce comercial (cliente, delivery/local, estado)
gst_compras              → egresos con factura
gst_proveedor_pagos      → pagos a proveedores
gst_empleado_movimientos → adelantos
gst_rendiciones          → caja fuerte
gst_pagos_periodicos     → gastos fijos pagados
gst_cliente_movimientos  → CC clientes (cobros, cargos, ajustes)
cierre_conceptos (config)→ etiquetas de medios de pago
cierre_turnos (config)   → nombres de cajas/turnos
```

Métodos `db` nuevos:

- `getResultadosResumen({ desde, hasta })`
- `getResultadosVentasPorCaja({ desde, hasta, turno? })` — totales + medios por cierre
- `getResultadosComposicionVentas({ desde, hasta })` — agregado de medios en el período
- `getResultadosMovimientos({ desde, hasta, tipo? })`
- `getResultadosCuentaCorriente({ desde, hasta })`
- `getResultadosDetalleEgresos({ desde, hasta, tipo? })`
- `getResultadosSeriesMensuales({ meses })` — fase 2

Siempre filtrar por `business_id` + rango de fechas.

---

## 6. Propuesta de UI

### Layout general

```
┌──────────────────────────────────────────────────────────────┐
│  Filtros: [Hoy][Semana][Mes ✓ default][Custom]  Caja:[Todos▼]│
├──────────────────────────────────────────────────────────────┤
│  KPI Ventas total │ KPI Egresos │ KPI Resultado │ vs mes ant. │
├──────────────────────────────────────────────────────────────┤
│  VENTAS POR CAJA (tabla + fila TOTAL)                        │
│  Caja      │ Fecha cierre │ Total  │ Efec │ Tarj │ CC │ …   │
│  Delivery  │ 07/08        │ 450000 │ ...  │ ...  │ .. │     │
│  Local     │ 07/08        │ 320000 │ ...  │ ...  │ .. │     │
│  TOTAL     │              │ 770000 │ Σ    │ Σ    │ Σ  │     │
├──────────────────────────┬───────────────────────────────────┤
│  Barras: ing vs egr/día  │  Dona: composición egresos        │
├──────────────────────────┴───────────────────────────────────┤
│  Tabs: [Movimientos][Ventas/cierres][Compras][Pagos][CC cli.]│
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Grilla sticky · sort · filtro texto · paginación         ││
│  └──────────────────────────────────────────────────────────┘│
│  [ Exportar Excel ]  [ Exportar PDF ]                        │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Bloque «Ventas por caja» (prioridad visual)

Ubicado **debajo de KPIs**, antes de gráficos.

**Tabla resumen:**

| Columna | Origen |
|---------|--------|
| Caja / Turno | `cierre.turno` |
| Fecha | `cierre.fecha` |
| Total venta | `cierre.total` |
| Efectivo | `medio_01` |
| Medio 2…15 | `medio_02..15` con nombre desde config (Tarjeta, Transferencia, Cuenta corriente, etc.) |
| Compras turno | `cierre.compras` (informativo) |
| Adelantos | `cierre.adelantos_efectivo + adelantos_merc` |

- **Fila TOTAL** al pie: suma de columnas numéricas del período filtrado.
- Filtro por caja aplica a esta tabla, KPI de ventas y tab Ventas/cierres.
- Click en una fila → expandir o scroll al detalle del cierre en tab «Ventas/cierres».

**Gráfico complementario (MVP):** dona o barras horizontales con **composición agregada de medios** del total de ventas del período (no solo egresos).

### 6.2 KPIs

| KPI | Notas |
|-----|-------|
| Ventas totales | Σ cierres del período |
| Egresos totales | Compras + pagos + adelantos + impuestos + periódicos |
| Resultado operativo | Ventas − Egresos |
| vs período anterior | Mismo rango de días, mes anterior |

Sin KPIs extra acordados por ahora.

### 6.3 Gráficos

**MVP:**
- Barras: ingresos vs egresos por día.
- Dona: composición **egresos** por categoría.
- Dona/barras: composición **ventas** por medio de pago (total período).

**Fase 2:**
- Línea evolución mensual (6–12 meses).
- Comparativa entre cajas Local vs Delivery en el tiempo.

**Librería:** `recharts` (agregar a `package.json`).

### 6.4 Grillas (tabs)

#### Movimientos (unificado)

Incluye cierres (como ingreso), compras, pagos, adelantos, impuestos, periódicos y **movimientos CC clientes** (tipo Cobro CC / Cargo CC).

| Columna | Descripción |
|---------|-------------|
| Fecha | formato AR |
| Tipo | Venta / Compra / Cobro CC / … |
| Concepto | |
| Categoría | |
| Caja | |
| Cliente | si CC |
| Ingreso / Egreso | |
| Origen | ref |

#### Ventas / cierres

Detalle crudo de cada cierre + columnas de medios.

#### Compras / Pagos

Como en plan anterior.

#### Cuenta corriente clientes

| Columna | Descripción |
|---------|-------------|
| Fecha | |
| Cliente | |
| Concepto | pedido, cobro, ajuste |
| Debe / Haber | |
| Saldo parcial | opcional running |

> **Anti-duplicado:** las ventas al contado van por cierres; los cargos CC por pedidos a crédito. Los **cobros** CC son ingreso de caja cuando se registran (aparecen en movimientos; cruce con medios si el cobro impactó un cierre).

### 6.5 Export

**Excel** (`exceljs`):
- Hoja Resumen (KPIs + ventas por caja + total + composición medios).
- Hoja Movimientos.
- Hoja Ventas/cierres (con columnas de medios).
- Hoja Compras.
- Hoja Cuenta corriente.

**PDF** (`jspdf`):
- Página 1: resumen ejecutivo (KPIs, tabla ventas por caja + total, composición medios en texto o mini-tabla).
- Páginas siguientes: detalle del tab activo o movimientos completos (paginado automático).

Ambos botones visibles en MVP. Nombre archivo: `resultados_YYYY-MM-DD_YYYY-MM-DD.xlsx|pdf`.

---

## 7. Filtros globales

| Filtro | Default | Valores |
|--------|---------|---------|
| Período | **Mes en curso** | Hoy · Semana · Mes · Mes anterior · Personalizado |
| Caja / Turno | Todos | Lista desde `cierre_turnos` |
| Tipo movimiento | Todos | Ingresos · Egresos · CC |
| Categoría compra | Todas | Categorías Compras |

Un solo estado en `useResultados()`; recalcula KPIs, ventas por caja, gráficos y grilla.

---

## 8. Arquitectura de código

```
src/
  pages/Results.jsx
  resultados/
    resultadosTypes.js
    resultadosQueries.js      → agregaciones (ventas por caja, composición medios)
    resultadosExport.js       → Excel + PDF
    useResultados.js
  supabaseClient.js           → db.getResultados*
```

Reutilizar:
- `cierreMedios.js` — IDs y lectura efectivo.
- `getCierreConceptos()` — nombres de medios.
- Helpers de `dateUtils.js`.

---

## 9. Fases de implementación

### Fase 1 — MVP

- [x] Filtros (default mes en curso).
- [x] KPIs: ventas totales, egresos, resultado, vs mes anterior.
- [x] **Tabla ventas por caja + fila TOTAL + composición medios.**
- [x] Tabs: Movimientos, Ventas/cierres, Compras, **CC clientes**.
- [x] Movimientos: cierres + compras + CC clientes.
- [x] Gráficos: barras ing/egr + dona medios ventas + dona egresos.
- [x] **Export Excel y PDF.**
- [x] Métodos `db.getCierresCajaByRange`, `getComprasByRange`, `getClienteMovimientosByRange`.

### Fase 1.5 — Egresos completos

- [ ] Pagos proveedores, adelantos, impuestos, pagos periódicos en Movimientos.
- [ ] Tab Pagos dedicado.

### Fase 2 — Análisis avanzado

- [ ] Series mensuales 6–12 meses.
- [ ] Evolución por caja Local/Delivery.
- [ ] Cache / optimización si hace falta.

### Fase 3 — Opcional

- [ ] CMV / margen si hay costo en productos.
- [ ] Presupuesto vs real.

---

## 10. Decisiones técnicas

| Tema | Decisión |
|------|----------|
| Gráficos | `recharts` en fase 1 |
| Excel | `exceljs` |
| PDF | `jspdf` + `jspdf-autotable` (tablas legibles) en fase 1 |
| Default período | Mes en curso |
| Ventas | Cierres por caja + total + medios |
| CC clientes | Incluida |
| Estado | `useState` + `useResultados` hook |

---

## 11. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Doble conteo cierre + pedido | Ventas = solo cierres; pedidos CC = cargos; cobros CC aparte |
| Medios renombrados en config | Guardar snapshot de nombre al exportar; en UI usar config actual |
| PDF largo | Paginar; opción “solo resumen” vs “resumen + detalle” |
| Performance | Paginación grilla; índice `fecha` en queries |

---

## 12. Criterios de aceptación (MVP)

- [ ] Al entrar, período = mes en curso.
- [ ] Se ve ventas **por caja**, **total** y **composición por medio** (efectivo, tarjeta, CC, etc.).
- [ ] Tab CC clientes con movimientos del período.
- [ ] Grilla ordenable y filtrable.
- [ ] Export Excel y PDF funcionan con el período filtrado.
- [ ] Solo datos del `business_id` del usuario.

---

## 13. Próximo paso

1. ~~Responder preguntas abiertas~~ ✓
2. Implementar Fase 1: `resultadosQueries.js` → `db.getResultados*` → `Results.jsx`.
3. Agregar dependencias: `recharts`, `jspdf-autotable` (si hace falta para tablas PDF).

---

*Referencia: `src/pages/Results.jsx`, `src/cierreMedios.js`, `PROMPT.md`, `GST_unified_schema.sql`.*
