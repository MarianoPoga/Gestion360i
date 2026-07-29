/** Texto de referencia: el más largo, define el tamaño uniforme de todos los tiles. */
export const REFERENCE_MODULE_LABEL = 'Pagos';

export default function ModuleCardLabel({ label, fontSize }) {
  return (
    <div className="module-card-label-wrap">
      <span
        className="module-card-label"
        style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
      >
        {label}
      </span>
    </div>
  );
}
