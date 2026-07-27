# Hoja de Ruta - Gestión360i

En este archivo iremos registrando las mejoras, cambios y pendientes de cada módulo del sistema.

## 📅 Pagos Periódicos (Gastos Generales)
- [x] Crear vista de Simulación Anual dividida por meses y quincenas.
- [x] Implementar grupos colapsables con totales parciales por mes/grupo.
- [x] Redirigir ítems "Sin Factura" al módulo Pago Impuestos/Servicios.
- [x] Ventana emergente/formulario para confirmar/modificar el monto al pagar.
- [x] Sincronización de fechas: el pago se registra en el mes donde se hizo clic.
- [x] Sistema de reordenamiento por arrastre (Drag & Drop) con persistencia en BD.
- [x] Estandarización visual: uso de selector de color dinámico y estados Rojo/Verde.
- [x] Prevención de duplicados al cargar conceptos guía.

## 🛒 Compras
- [ ] 
- [ ] 

## 💰 Clientes / Pedidos
- [ ] 
- [ ] 

## 🔒 Cierre de Caja
- [ ] No permitir cerrar cajas posteriores al dia de la fecha
- [x] En ULTIMOS CIERRES REGISTRADOS, los valores de Turno ponerlos en burbujas de colores segun el turno/Caja. También cambia el titulo de la columna por Turno/Caja
- [x] No funcionan los botones para dar adelantos, tanto de dinero como de mercaderia
- [ ] Formatear los montos ingresados para que sea mas fácil su visualización
- [ ] Darle distintos colores a las burbujas en ultimas cajas cerradas
## 💰 Fondos

## 👥 Empleados
- [ ] 
- [ ] 

## 💸 Pago Proveedores
- [x] Crear módulo independiente para pagos a proveedores (separado de Adelantos).
- [x] Sincronizar con permisos y configuración global.

## 🧾 Pago Impuestos / Servicios
- [x] Crear módulo independiente para registrar impuestos/servicios periódicos sin factura.
- [x] Sincronizar con simulación de Pagos Periódicos e impactar automáticamente la fecha del último pago.
- [x] Impactar automáticamente en la caja o fondos de Rendición correspondientes.

## 💰 Adelantos
- [x] Crear módulo independiente para adelantos a empleados (separado de Pagos).
- [x] Mantener configuración de topes y tipos de retiro (Efectivo/Mercadería).
- [ ] 

## 🚚 Proveedores
- [ ] 
- [ ] 

## 📝 Rendiciones
- [ ] 
- [ ] 

## 📊 Dashboard (Panel de Control)
- [x] Implementar visualización de colores personalizados por módulo.
- [ ] 

## 📈 Resultados
- [ ] 
- [ ] 

## 📋 Tareas (Checklist)
- [ ] 
- [ ] 

## ⚙️ Configuración
- [x] Implementar selector de colores (30 tonos) para cada módulo.
- [x] Validar que no se repitan colores entre módulos.
- [x] Refactorizar estructura de renderizado para mayor escalabilidad (renderModuleHeader).
- [x] Consolidar la selección de colores de todos los módulos en una sección unificada e independiente.
- [x] Implementar sistema interactivo Drag & Drop (arrastrar y soltar) con intercambio inteligente y compatibilidad táctil (clic para seleccionar).
