import React from 'react';
import {
  EXPENSE_IRREGULAR_TYPES,
  EXPENSE_REGULAR_WITH_INVOICE,
  EXPENSE_REGULAR_WITHOUT_INVOICE,
  EXPENSE_GUIDE_TREES,
  COMPRAS_PROVIDER_CATEGORY_NAMES,
} from '../expenseTypes';

const treeLine = { borderLeft: '2px solid #cbd5e1', marginLeft: '10px', paddingLeft: '14px' };

const renderTreeNode = (node, depth = 0) => {
  if (typeof node === 'string') {
    return (
      <div key={node} style={{ ...treeLine, marginTop: '4px', color: '#334155', fontSize: '0.82rem' }}>
        {node}
      </div>
    );
  }

  return (
    <div key={node.label} style={{ marginTop: depth === 0 ? '8px' : '6px' }}>
      <div style={{ fontWeight: depth === 0 ? 700 : 600, color: depth === 0 ? '#1e40af' : '#475569', fontSize: depth === 0 ? '0.9rem' : '0.85rem' }}>
        {node.label}
        {node.hint && (
          <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '6px', fontSize: '0.78rem' }}>
            — {node.hint}
          </span>
        )}
      </div>
      {node.children?.map((child) => renderTreeNode(child, depth + 1))}
    </div>
  );
};

const renderTreePanel = (tree) => (
  <div
    style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: '14px',
      height: '100%',
    }}
  >
    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', fontSize: '0.9rem' }}>
      {tree.title}
    </div>
    <div style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '0.88rem' }}>{tree.root}</div>
    {tree.branches.map((branch) => renderTreeNode(branch))}
  </div>
);

function ExpenseGuideModal({ open, onClose, accentColor = '#ef4444' }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2500,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-guide-title"
        style={{
          background: '#fff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '960px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: '1px solid #e2e8f0',
            position: 'sticky',
            top: 0,
            background: '#fff',
            zIndex: 1,
          }}
        >
          <h3 id="expense-guide-title" style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>
            <i className="bi bi-journal-text me-2" style={{ color: accentColor }}></i>
            Guía de tipos de gasto
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}
            aria-label="Cerrar"
          >
            &times;
          </button>
        </div>

        <div style={{ padding: '20px 22px', fontSize: '0.88rem', color: '#334155', lineHeight: 1.55 }}>
          <p style={{ margin: '0 0 16px 0' }}>
            Los gastos se organizan en <strong>irregulares</strong> (compras puntuales) y <strong>regulares</strong> (recurrentes).
            En <strong>Compras</strong> siempre hay <strong>proveedor y factura</strong>.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            {renderTreePanel(EXPENSE_GUIDE_TREES.naturaleza)}
            {renderTreePanel(EXPENSE_GUIDE_TREES.factura)}
            {renderTreePanel(EXPENSE_GUIDE_TREES.registro)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div style={{ background: '#f8fbff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '10px' }}>Irregulares — solo Compras</div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {EXPENSE_IRREGULAR_TYPES.map((item) => (
                  <li key={item.name} style={{ marginBottom: '8px' }}>
                    <strong>{item.name}:</strong> {item.description}
                    <span style={{ display: 'block', fontSize: '0.78rem', color: '#64748b' }}>Ej.: {item.examples}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: '10px' }}>
                Regulares con proveedor y factura — Compras y/o Calendario
              </div>
              {EXPENSE_REGULAR_WITH_INVOICE.map((item) => (
                <div key={item.name} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #dcfce7' }}>
                  <strong>{item.name}</strong>
                  <div>{item.description}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '4px' }}>Ej.: {item.examples}</div>
                  <div style={{ fontSize: '0.78rem', marginTop: '6px' }}>
                    <strong>Compras:</strong> {item.comprasWhen}
                  </div>
                  <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                    <strong>Calendario:</strong> {item.calendarioWhen}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontWeight: 700, color: '#475569', marginBottom: '10px' }}>
                Regulares sin factura — solo Pagos / Calendario
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {EXPENSE_REGULAR_WITHOUT_INVOICE.map((item) => (
                  <li key={item.name} style={{ marginBottom: '8px' }}>
                    <strong>{item.name}:</strong> {item.description}
                    <span style={{ display: 'block', fontSize: '0.78rem', color: '#64748b' }}>Ej.: {item.examples}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p style={{ margin: '16px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Categorías de proveedor en Compras: {COMPRAS_PROVIDER_CATEGORY_NAMES.join(' · ')}.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ExpenseGuideModal;
