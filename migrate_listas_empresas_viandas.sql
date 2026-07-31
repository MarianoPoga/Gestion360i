-- migrate_listas_empresas_viandas.sql
-- Renombra "Lista Empresas" → "Empresas por Producto" y agrega "Empresas por Viandas".
-- Ejecutar en Supabase SQL Editor (una sola vez).

DO $$
DECLARE
  biz record;
  lista_empresas_producto_id uuid;
  lista_empresas_viandas_id uuid;
  lista_efectivo_id uuid;
BEGIN
  FOR biz IN SELECT id FROM public.gst_businesses LOOP
    SELECT id INTO lista_empresas_producto_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Empresas por Producto'
    LIMIT 1;

    IF lista_empresas_producto_id IS NULL THEN
      SELECT id INTO lista_empresas_producto_id
      FROM public.gst_listas_precios
      WHERE business_id = biz.id AND nombre = 'Lista Empresas'
      LIMIT 1;

      IF lista_empresas_producto_id IS NOT NULL THEN
        UPDATE public.gst_listas_precios
        SET nombre = 'Empresas por Producto', orden = 2, activa = true
        WHERE id = lista_empresas_producto_id;
      ELSE
        INSERT INTO public.gst_listas_precios (business_id, nombre, es_default, activa, orden)
        VALUES (biz.id, 'Empresas por Producto', false, true, 2)
        RETURNING id INTO lista_empresas_producto_id;
      END IF;
    ELSE
      UPDATE public.gst_listas_precios
      SET orden = 2, activa = true
      WHERE id = lista_empresas_producto_id;
    END IF;

    SELECT id INTO lista_empresas_viandas_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Empresas por Viandas'
    LIMIT 1;

    IF lista_empresas_viandas_id IS NULL THEN
      INSERT INTO public.gst_listas_precios (business_id, nombre, es_default, activa, orden)
      VALUES (biz.id, 'Empresas por Viandas', false, true, 3)
      RETURNING id INTO lista_empresas_viandas_id;
    ELSE
      UPDATE public.gst_listas_precios
      SET orden = 3, activa = true
      WHERE id = lista_empresas_viandas_id;
    END IF;

    SELECT id INTO lista_efectivo_id
    FROM public.gst_listas_precios
    WHERE business_id = biz.id AND nombre = 'Lista Efectivo'
    LIMIT 1;

    IF lista_efectivo_id IS NOT NULL THEN
      UPDATE public.gst_listas_precios
      SET orden = 4, activa = true
      WHERE id = lista_efectivo_id;
    END IF;

    INSERT INTO public.gst_lista_precio_items (business_id, lista_id, producto_id, precio)
    SELECT biz.id, lista_empresas_viandas_id, p.id, p.precio
    FROM public.gst_productos p
    WHERE p.business_id = biz.id
    ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio = EXCLUDED.precio;
  END LOOP;
END $$;
