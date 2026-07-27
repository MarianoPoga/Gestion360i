-- =========================================================
-- GST_unified_schema.sql
-- ESQUEMA UNIFICADO MULTI-EMPRESA PARA GESTION360i
-- Preparado para integración con Empresa360i
-- =========================================================

-- 1. ESTRUCTURA MAESTRA (Multi-tenancy)
-- =========================================================

-- TABLA: GST_businesses
-- Representa a cada cliente/empresa que contrata el servicio.
CREATE TABLE IF NOT EXISTS public.GST_businesses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    owner_email text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_profiles
-- Perfiles de usuario vinculados a negocios
CREATE TABLE IF NOT EXISTS public.GST_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE,
    role text DEFAULT 'admin', -- 'admin', 'manager', 'empleado'
    full_name text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_terminals
-- Representa a cada punto de venta o oficina de una empresa.
CREATE TABLE IF NOT EXISTS public.GST_terminals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- Ej: 'Caja 01', 'Oficina Central', 'Sucursal Norte'
    terminal_type text DEFAULT 'employee' NOT NULL, -- 'employee' o 'owner'
    last_access timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_configs
-- Almacena la configuración particular de cada terminal (lo que antes era localStorage).
CREATE TABLE IF NOT EXISTS public.GST_configs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE CASCADE NOT NULL,
    config_key text NOT NULL, -- Ej: 'rendiciones_config', 'compras_config'
    config_value jsonb NOT NULL, -- El JSON con los settings
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(terminal_id, config_key)
);

-- 2. OPERACIONES Y DATOS
-- =========================================================

-- TABLA: GST_productos
CREATE TABLE IF NOT EXISTS public.GST_productos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    nombre text NOT NULL,
    rubro text,
    precio numeric(12,2) DEFAULT 0.00 NOT NULL,
    stock numeric(12,2) DEFAULT 0.00 NOT NULL,
    iva numeric(5,2) DEFAULT 21.00 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_proveedores
CREATE TABLE IF NOT EXISTS public.GST_proveedores (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    nombre text NOT NULL,
    cuit text,
    alias text,
    tipo text DEFAULT 'Mercadería'::text,
    detalle text DEFAULT ''::text,
    pago text DEFAULT 'Caja'::text,
    factura text DEFAULT 'Sin factura'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_compras
CREATE TABLE IF NOT EXISTS public.GST_compras (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    proveedor text NOT NULL,
    alias text,
    cuit text,
    tipo text,
    detalle text,
    pago text,
    factura text,
    monto_neto numeric(12,2) DEFAULT 0.00,
    monto_neto_10_5 numeric(12,2) DEFAULT 0.00,
    monto_neto_27 numeric(12,2) DEFAULT 0.00,
    iva_10_5 numeric(12,2) DEFAULT 0.00,
    iva_21 numeric(12,2) DEFAULT 0.00,
    iva_27 numeric(12,2) DEFAULT 0.00,
    monto_exento numeric(12,2) DEFAULT 0.00,
    monto_no_gravado numeric(12,2) DEFAULT 0.00,
    percep_iva numeric(12,2) DEFAULT 0.00,
    percep_iibb numeric(12,2) DEFAULT 0.00,
    iibb_jurisdiccion text,
    percep_ganancias numeric(12,2) DEFAULT 0.00,
    impuestos_internos numeric(12,2) DEFAULT 0.00,
    tasas_municipales numeric(12,2) DEFAULT 0.00,
    total numeric(12,2) NOT NULL,
    caja_cierre text,
    conceptos_desglose jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_personal
CREATE TABLE IF NOT EXISTS public.GST_personal (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    nombre text NOT NULL,
    apodo text,
    cuit text,
    cbu text,
    telefono text,
    direccion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_empleado_movimientos (Pagos y Adelantos)
CREATE TABLE IF NOT EXISTS public.GST_empleado_movimientos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    empleado text NOT NULL,
    concepto text NOT NULL,
    monto numeric(12,2) NOT NULL,
    caja_cierre text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_proveedor_pagos
CREATE TABLE IF NOT EXISTS public.GST_proveedor_pagos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    proveedor text NOT NULL,
    alias text,
    origen text, -- Ej: 'Caja', 'Banco', 'Rendición'
    monto numeric(12,2) NOT NULL,
    observacion text,
    caja_cierre text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_cierres_caja
CREATE TABLE IF NOT EXISTS public.GST_cierres_caja (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    turno text NOT NULL,
    efectivo numeric(12,2) DEFAULT 0.00 NOT NULL,
    transferencia numeric(12,2) DEFAULT 0.00 NOT NULL,
    tarjeta numeric(12,2) DEFAULT 0.00 NOT NULL,
    qr_pago numeric(12,2) DEFAULT 0.00 NOT NULL,
    link_pago numeric(12,2) DEFAULT 0.00 NOT NULL,
    cta_cte numeric(12,2) DEFAULT 0.00 NOT NULL,
    adelantos_efectivo numeric(12,2) DEFAULT 0.00 NOT NULL,
    adelantos_merc numeric(12,2) DEFAULT 0.00 NOT NULL,
    compras numeric(12,2) DEFAULT 0.00 NOT NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_rendiciones (Caja Fuerte)
CREATE TABLE IF NOT EXISTS public.GST_rendiciones (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    concepto text NOT NULL,
    debe numeric(12,2) DEFAULT 0.00 NOT NULL,
    haber numeric(12,2) DEFAULT 0.00 NOT NULL,
    categoria text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_tareas
CREATE TABLE IF NOT EXISTS public.GST_tareas (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    caracter text,
    tarea text NOT NULL,
    usuario text DEFAULT 'Empleado'::text NOT NULL,
    estado text DEFAULT 'Pendiente'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. CLIENTES Y PEDIDOS
-- =========================================================

-- TABLA: GST_clientes
CREATE TABLE IF NOT EXISTS public.GST_clientes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    nombre text NOT NULL,
    razon_social text,
    cuit text,
    saldo numeric(12,2) DEFAULT 0.00 NOT NULL,
    telefono text,
    condicion_iva text DEFAULT 'Consumidor Final'::text NOT NULL,
    direccion_predeterminada text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_cliente_direcciones
CREATE TABLE IF NOT EXISTS public.GST_cliente_direcciones (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    cliente_id uuid REFERENCES public.GST_clientes(id) ON DELETE CASCADE NOT NULL,
    direccion text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_pedidos
CREATE TABLE IF NOT EXISTS public.GST_pedidos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    terminal_id uuid REFERENCES public.GST_terminals(id) ON DELETE SET NULL,
    cliente_id uuid REFERENCES public.GST_clientes(id) ON DELETE SET NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL,
    con_envio boolean DEFAULT false NOT NULL,
    direccion_envio text,
    estado text DEFAULT 'Pendiente'::text NOT NULL,
    repartidor text,
    medio_pago text,
    factura_nro text,
    factura_fecha date,
    factura_tipo text,
    fecha timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- TABLA: GST_pedido_items
CREATE TABLE IF NOT EXISTS public.GST_pedido_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.GST_businesses(id) ON DELETE CASCADE NOT NULL,
    pedido_id uuid REFERENCES public.GST_pedidos(id) ON DELETE CASCADE NOT NULL,
    producto text NOT NULL,
    cantidad numeric(10,2) NOT NULL,
    valor numeric(12,2) NOT NULL,
    iva_alicuota numeric(5,2) DEFAULT 21.00 NOT NULL,
    observacion text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =========================================================
-- SEGURIDAD: Row Level Security (RLS)
-- Comentar o descomentar según se desee activar ahora o luego.
-- =========================================================

-- ALTER TABLE public.GST_productos ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Empresas ven solo sus productos" ON public.GST_productos 
-- FOR ALL USING (business_id = auth.jwt()-\u003e\u003e'business_id');

-- [Repetir para el resto de las tablas GST_]
