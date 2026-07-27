import React, { useState, useEffect } from 'react';
import { db } from '../supabaseClient';

function Results() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ ventas: 0, compras: 0, balance: 0 });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    // Placeholder for real stats logic
    setStats({ ventas: 1250000, compras: 850000, balance: 400000 });
    setLoading(false);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  };

  return (
    <div className="page-container p-4">
      <h2 className="page-title mb-4">
        <i className="bi bi-graph-up text-primary me-2"></i> Reportes y Resultados
      </h2>

      <div className="row mb-4">
        <div className="col-md-4">
          <div className="card border-0 shadow-sm p-4 text-center" style={{ borderRadius: '15px' }}>
            <div className="text-muted small text-uppercase mb-2">Ventas del Mes</div>
            <div className="fs-2 fw-bold text-success">{formatCurrency(stats.ventas)}</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm p-4 text-center" style={{ borderRadius: '15px' }}>
            <div className="text-muted small text-uppercase mb-2">Compras del Mes</div>
            <div className="fs-2 fw-bold text-danger">{formatCurrency(stats.compras)}</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm p-4 text-center" style={{ borderRadius: '15px' }}>
            <div className="text-muted small text-uppercase mb-2">Utilidad Estimada</div>
            <div className="fs-2 fw-bold text-primary">{formatCurrency(stats.balance)}</div>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm p-5 text-center" style={{ borderRadius: '15px', backgroundColor: '#f8f9fa' }}>
        <div className="py-5">
          <i className="bi bi-bar-chart-line text-muted display-1"></i>
          <h4 className="text-muted mt-3">Módulo de Gráficos en Desarrollo</h4>
          <p className="text-muted">Pronto podrás visualizar tus ventas y gastos de forma interactiva.</p>
        </div>
      </div>
    </div>
  );
}

export default Results;
