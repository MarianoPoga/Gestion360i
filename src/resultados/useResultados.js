import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../supabaseClient';
import {
  buildComposicionVentas,
  buildComprasDetalle,
  buildEgresosPorCategoria,
  buildIngresosEgresosDiarios,
  buildMovimientosCc,
  buildMovimientosUnificados,
  buildResumen,
  buildVentasPorCaja,
} from './resultadosQueries';
import {
  endOfDayIso,
  formatPeriodLabel,
  resolvePeriodRange,
  resolvePreviousPeriodRange,
  startOfDayIso,
} from './resultadosPeriod';
import { PERIOD_PRESETS, RESULTADOS_TABS } from './resultadosTypes';

export const useResultados = () => {
  const [preset, setPreset] = useState(PERIOD_PRESETS.MONTH);
  const [customDesde, setCustomDesde] = useState('');
  const [customHasta, setCustomHasta] = useState('');
  const [turnoFilter, setTurnoFilter] = useState('');
  const [activeTab, setActiveTab] = useState(RESULTADOS_TABS.MOVIMIENTOS);
  const [searchText, setSearchText] = useState('');
  const [sortField, setSortField] = useState('fecha');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(null);

  const range = useMemo(
    () => resolvePeriodRange(preset, customDesde, customHasta),
    [preset, customDesde, customHasta]
  );

  const periodLabel = useMemo(
    () => formatPeriodLabel(range.desde, range.hasta),
    [range.desde, range.hasta]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const prev = resolvePreviousPeriodRange(range);
      const desdeIso = startOfDayIso(range.desde);
      const hastaIso = endOfDayIso(range.hasta);
      const prevDesdeIso = startOfDayIso(prev.desde);
      const prevHastaIso = endOfDayIso(prev.hasta);

      const [
        cierres,
        compras,
        movimientosCcRaw,
        cierresAnterior,
        comprasAnterior,
        mediosConfig,
        clientes,
        turnos,
      ] = await Promise.all([
        db.getCierresCajaByRange(desdeIso, hastaIso),
        db.getComprasByRange(desdeIso, hastaIso),
        db.getClienteMovimientosByRange(desdeIso, hastaIso),
        db.getCierresCajaByRange(prevDesdeIso, prevHastaIso),
        db.getComprasByRange(prevDesdeIso, prevHastaIso),
        db.getCierreConceptos(),
        db.getClientes(),
        db.getCierreTurnos(),
      ]);

      const clientesMap = {};
      (clientes || []).forEach((c) => {
        clientesMap[c.id] = c.nombre || c.razon_social || 'Cliente';
      });

      setRaw({
        cierres: cierres || [],
        compras: compras || [],
        movimientosCcRaw: movimientosCcRaw || [],
        cierresAnterior: cierresAnterior || [],
        comprasAnterior: comprasAnterior || [],
        mediosConfig: mediosConfig || [],
        clientesMap,
        turnos: turnos || [],
      });
    } catch (err) {
      console.error('[Resultados] load:', err);
      setError(err.message || 'Error al cargar resultados');
    } finally {
      setLoading(false);
    }
  }, [range.desde, range.hasta]);

  useEffect(() => {
    load();
  }, [load]);

  const computed = useMemo(() => {
    if (!raw) return null;
    const filterOpts = { ...range, turnoFilter };
    const movimientosCc = buildMovimientosCc(
      raw.movimientosCcRaw,
      raw.clientesMap,
      range
    );

    return {
      resumen: buildResumen({
        cierres: raw.cierres,
        compras: raw.compras,
        ...range,
        turnoFilter,
        cierresAnterior: raw.cierresAnterior,
        comprasAnterior: raw.comprasAnterior,
      }),
      ventasPorCaja: buildVentasPorCaja(
        raw.cierres,
        raw.mediosConfig,
        filterOpts
      ),
      composicionVentas: buildComposicionVentas(
        raw.cierres,
        raw.mediosConfig,
        filterOpts
      ),
      egresosPorCategoria: buildEgresosPorCategoria(raw.compras, range),
      ingresosEgresosDiarios: buildIngresosEgresosDiarios({
        cierres: raw.cierres,
        compras: raw.compras,
        ...range,
        turnoFilter,
      }),
      movimientos: buildMovimientosUnificados({
        cierres: raw.cierres,
        compras: raw.compras,
        movimientosCc,
        ...range,
        turnoFilter,
      }),
      movimientosCc,
      comprasDetalle: buildComprasDetalle(raw.compras, range),
      turnos: raw.turnos,
      mediosConfig: raw.mediosConfig,
    };
  }, [raw, range, turnoFilter]);

  const filteredMovimientos = useMemo(() => {
    if (!computed) return [];
    let rows = [...computed.movimientos];
    const q = searchText.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.concepto, r.tipo, r.categoria, r.caja, r.cliente]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'fecha') {
        cmp = new Date(a.fecha) - new Date(b.fecha);
      } else if (sortField === 'ingreso') {
        cmp = (a.ingreso || 0) - (b.ingreso || 0);
      } else if (sortField === 'egreso') {
        cmp = (a.egreso || 0) - (b.egreso || 0);
      } else if (sortField === 'concepto') {
        cmp = String(a.concepto).localeCompare(String(b.concepto));
      }
      return sortAsc ? cmp : -cmp;
    });
    return rows;
  }, [computed, searchText, sortField, sortAsc]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortAsc((v) => !v);
    } else {
      setSortField(field);
      setSortAsc(field === 'concepto');
    }
  };

  return {
    preset,
    setPreset,
    customDesde,
    setCustomDesde,
    customHasta,
    setCustomHasta,
    turnoFilter,
    setTurnoFilter,
    activeTab,
    setActiveTab,
    searchText,
    setSearchText,
    sortField,
    sortAsc,
    toggleSort,
    loading,
    error,
    reload: load,
    range,
    periodLabel,
    computed,
    filteredMovimientos,
  };
};
