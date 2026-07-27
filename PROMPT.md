# Prompt para construir Gestion360i

Usá este documento como brief completo para una AI (Cursor, ChatGPT, Claude, etc.) al crear o extender la webapp.

---

## Proyecto: Gestion360i — Sistema de gestión para comercios (Argentina)

### Objetivo

Construir una webapp modular de gestión operativa para un negocio retail/gastronomía (ej: dietética, almacén). Debe funcionar como **terminal de empleados** y como **panel de control del dueño**, con datos en la nube vía Supabase.

- **Nombre comercial:** Gestion360i
- **Idioma de la UI:** español (Argentina)
- **Moneda:** ARS ($)

---

## Stack técnico (obligatorio)

- **Frontend:** React 18 + Vite 5
- **Backend/BD:** Supabase (Auth + PostgreSQL + Storage + Edge Functions)
- **Estilos:** Bootstrap 5.3 + Bootstrap Icons + CSS custom
- **Fuentes:** Inter (texto) + Outfit (títulos)
- **Librerías:**
  - `@supabase/supabase-js` (datos y auth)
  - `exceljs` (exportar Excel)
  - `jspdf` (PDFs)
  - `@arcasdk/core` o integración AFIP/ARCA para facturación electrónica
- **Sin** Next.js, sin Redux. Estado local con React hooks.
- Puerto dev: 3000

---

## Arquitectura

### Multi-tenancy

- Cada **empresa** es un tenant (`gst_businesses`)
- Cada **usuario** tiene perfil en `gst_profiles` con `business_id` y `role`
- Cada **terminal** (caja/oficina) tiene ID en `gst_terminals`
- **TODAS** las tablas operativas llevan prefijo `gst_` y columna `business_id`
- Nunca usar tablas sin prefijo (`clientes`, `personal`, etc.)

### Capas de código

```
src/
  main.jsx
  App.jsx              → routing por estado, auth, layout
  supabaseClient.js    → capa de datos única (`db.*`), auth, helpers
  pages/               → un archivo por módulo
  index.css            → estilos globales
supabase/
  functions/arca-invoice/  → facturación AFIP
GST_unified_schema.sql     → esquema SQL canónico
```

### Reglas de la capa de datos (`supabaseClient.js`)

- Exportar objeto `db` con métodos async por entidad (`getClientes`, `saveCompra`, etc.)
- Siempre filtrar por `business_id` obtenido del perfil del usuario logueado
- Credenciales Supabase: `localStorage` + fallback `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- Modo demo: fallback a `localStorage` mock solo si Supabase no está configurado
- Nunca mezclar datos de distintos `business_id`

---

## Autenticación y roles

### Login / Registro

- Pantalla de login con signup (crea user + business + terminal + profile admin)
- Roles: `admin`, `cajero`, `operario`
- Admin: acceso total + configuración
- Cajero: cierre, pedidos, pagos periódicos (configurable)
- Operario: cajero + adelantos + rendiciones

### Sesión

- Al login: cargar perfil, setear `business_id` y `terminal_id` en localStorage
- Header muestra nombre del negocio y rol del usuario
- Botón logout limpia sesión

---

## Módulos funcionales

Activables/desactivables desde Configuración. Color personalizable por módulo.

| ID | Página | Función |
|----|--------|---------|
| `dashboard` | Dashboard.jsx | Menú principal con tarjetas por módulo |
| `clientes` | Clientes.jsx | Pedidos, clientes, productos, cuenta corriente, facturación ARCA |
| `cierre` | Cierre.jsx | Cierre de caja por turno, conceptos, adelantos del turno |
| `compras` | Compras.jsx | Registro de compras/gastos, IVA desglosado, facturas pendientes |
| `adelantos` | Adelantos.jsx | Adelantos a empleados (efectivo/mercadería) |
| `pago-proveedores` | Pagos.jsx | Pagos a proveedores |
| `pago-impuestos` | PagoImpuestos.jsx | Impuestos/servicios sin factura |
| `pagos-periodicos` | PeriodicPayments.jsx | Simulación anual de gastos fijos, drag & drop |
| `rendiciones` | Rendiciones.jsx | Caja fuerte, rendición de fondos |
| `employees` | Employees.jsx | RRHH, movimientos, accesos de usuario |
| `providers` | Providers.jsx | Cuenta corriente proveedores |
| `results` | Results.jsx | Reportes/resultados |
| `configuration` | Configuration.jsx | Solo admin: módulos, colores, Supabase, ARCA, permisos |

---

## Esquema de base de datos (Supabase)

Usar `GST_unified_schema.sql` como fuente de verdad.

**Maestras:** `gst_businesses`, `gst_profiles`, `gst_terminals`, `gst_configs`

**Operativas:** `gst_clientes`, `gst_cliente_direcciones`, `gst_cliente_movimientos`, `gst_productos`, `gst_pedidos`, `gst_pedido_items`, `gst_compras`, `gst_proveedores`, `gst_proveedor_pagos`, `gst_personal`, `gst_empleado_movimientos`, `gst_cierres_caja`, `gst_rendiciones`, `gst_tareas`, `gst_pagos_periodicos`

Todas con: `id uuid`, `business_id uuid NOT NULL`, `created_at timestamptz`

Permisos: GRANT ALL en tablas `gst_%` a `anon` y `authenticated` (ver `fix_permissions.sql`)

---

## Funcionalidades clave por módulo

### Clientes / Pedidos

- ABM clientes (nombre, razón social, CUIT, condición IVA, teléfono)
- Direcciones múltiples con GPS/coords embebidas en texto
- Pedidos con ítems, envío, medio de pago, estados (Pendiente/Entregado/Cancelado)
- Cuenta corriente: movimientos debe/haber, saldo
- Facturación electrónica AFIP/ARCA vía Edge Function
- Export Excel de pedidos

### Cierre de caja

- Turnos configurables (Mañana/Tarde/Noche)
- Conceptos de ingreso configurables
- Vincular compras, adelantos y pagos al cierre
- Historial de cierres con burbujas de color por turno

### Compras

- Registro con desglose IVA (21%, 10.5%, 27%, exento, percepciones)
- Categorías, conceptos, formas de pago configurables
- Facturas pendientes de proveedor
- Template WhatsApp para reclamar facturas

### Pagos periódicos

- Vista simulación anual por mes/quincena
- Grupos colapsables con subtotales
- Drag & drop con persistencia en BD
- Estados: estimado vs corroborado, pagado/no pagado
- Ítems "sin factura" redirigen a Pago Impuestos

### Configuración (admin)

- Toggle on/off por módulo
- Selector de 30 colores por módulo (sin repetir)
- Credenciales Supabase + test de conexión
- Config ARCA: CUIT, certificado, clave, punto de venta, ambiente
- Permisos extra por rol (ej: cajero puede compras)
- API Key Gemini (lectura IA de facturas)

---

## UI/UX

- Layout: header fijo (logo negocio + usuario + logout), contenido, footer
- Navegación: dashboard → módulo → botón "Volver al Menú" con borde color del módulo
- Login: diseño glassmorphism oscuro, blobs de color
- Admin en dashboard: botón flotante de configuración
- Responsive, usable en tablet/móvil
- Feedback: spinners, alerts success/error, confirmaciones en acciones destructivas
- Montos en formato `$ 1.234,56` (separador miles punto, decimales coma)

---

## Integraciones externas

1. **Supabase Auth** — email/password
2. **Supabase Storage** — bucket `gst_invoices` para PDFs de facturas
3. **AFIP/ARCA** — Edge Function `arca-invoice` con certificado digital
4. **Google Maps** — links desde direcciones de clientes
5. **WhatsApp** — links `wa.me` con templates configurables
6. **Gemini API** — OCR/lectura de facturas (opcional)

---

## Convenciones de código

- Componentes funcionales con hooks
- Un `useEffect` para cargar datos al montar cada página
- Métodos de `db.*` para toda persistencia (no llamar supabase directo desde páginas, salvo casos excepcionales)
- CSS: clases existentes (`app-container`, `login-card`, `btn-nav-back`, etc.)
- Comentarios solo para lógica de negocio no obvia
- Cambios mínimos, reutilizar patrones existentes

---

## Entregables esperados

1. Proyecto Vite funcional en localhost
2. `GST_unified_schema.sql` completo
3. `fix_permissions.sql`
4. `.env.example` con variables Vite
5. Login + dashboard + al menos 3 módulos core (Clientes, Cierre, Compras)
6. Capa `db` en `supabaseClient.js` con patrón `gst_` + `business_id`
7. README con: setup Supabase, variables env, `npm run dev`, deploy

---

## Lo que NO quiero

- Tablas sin prefijo `gst_`
- Frameworks distintos al stack definido
- Estado global innecesario (Redux, Zustand) salvo que lo justifiques
- Hardcodear credenciales en el código
- Mock data cuando Supabase está configurado
- UI en inglés

---

## Contexto de negocio

Es para un comercio real en Argentina (ej: "Rincón Natural" / dietética). Maneja pedidos con delivery, cuenta corriente de clientes, compras a proveedores con facturación AFIP, cierre diario de caja por turno, y control de gastos fijos mensuales.

**Prioridad:** que funcione operativamente en el día a día del negocio, no que sea un demo bonito.

---

## Plan de implementación por fases

### Fase 1 — Base
- Auth (login/signup)
- Schema Supabase + permisos
- Dashboard + configuración de módulos
- Capa `db` en `supabaseClient.js`

### Fase 2 — Operación core
- Clientes + pedidos + productos
- Cierre de caja
- Compras

### Fase 3 — Finanzas
- Proveedores + pagos
- Adelantos + rendiciones
- Pagos periódicos + pago impuestos

### Fase 4 — Avanzado
- Facturación ARCA
- Resultados / reportes
- Export Excel/PDF
- Permisos granulares por rol

---

## Criterios de aceptación

- [ ] Puedo registrarme, crear un negocio y loguearme
- [ ] Puedo configurar Supabase desde la UI o `.env`
- [ ] Puedo crear un cliente, hacer un pedido, y verlo en la lista
- [ ] Dos empresas distintas no ven los datos de la otra
- [ ] Puedo cerrar caja de un turno y ver el historial
- [ ] Puedo registrar una compra con IVA desglosado
- [ ] Los módulos se activan/desactivan desde Configuración
- [ ] Todo persiste en tablas `gst_*` con el `business_id` correcto

---

## Prompt corto (para arrancar rápido)

```
Construí Gestion360i siguiendo PROMPT.md de este repo.

Stack: React 18 + Vite + Supabase + Bootstrap 5.
Multi-tenant con tablas gst_* y business_id en cada registro.
Empezá por Fase 1: auth, schema, dashboard, supabaseClient.js.
Usá GST_unified_schema.sql como esquema. UI en español argentino.
No uses tablas sin prefijo gst_. No hardcodees credenciales.
```

---

## Archivos de referencia en este repo

| Archivo | Propósito |
|---------|-----------|
| `GST_unified_schema.sql` | Esquema SQL canónico |
| `fix_permissions.sql` | Permisos Supabase |
| `.env.example` | Variables de entorno |
| `src/supabaseClient.js` | Capa de datos |
| `src/App.jsx` | Routing y layout |
| `TODO.md` | Roadmap por módulo |
| `diagnose_data.sql` | Diagnóstico de datos |
| `migrate_legacy_to_gst.sql` | Migración one-time a gst_* |
