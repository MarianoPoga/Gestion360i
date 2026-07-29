import { MODULE_LABELS } from './moduleLabels';

export const ROLE_KEYS = ['admin', 'gerente', 'operario', 'cajero'];

export const DEFAULT_ROLE_LABELS = {
  admin: 'Administrador',
  gerente: 'Gerente',
  operario: 'Operario',
  cajero: 'Cajero',
};

export const PERMISSION_MODULES = [
  { id: 'cierre', label: MODULE_LABELS.cierre },
  { id: 'compras', label: MODULE_LABELS.compras },
  { id: 'adelantos', label: MODULE_LABELS.adelantos },
  { id: 'pago-proveedores', label: MODULE_LABELS['pago-proveedores'] },
  { id: 'pago-impuestos', label: MODULE_LABELS['pago-impuestos'] },
  { id: 'rendiciones', label: MODULE_LABELS.rendiciones },
  { id: 'pagos-periodicos', label: MODULE_LABELS['pagos-periodicos'] },
  { id: 'clientes', label: MODULE_LABELS.clientes },
  { id: 'proveedores', label: MODULE_LABELS.proveedores },
  { id: 'empleados', label: MODULE_LABELS.empleados },
  { id: 'resultados', label: MODULE_LABELS.resultados },
  { id: 'tareas', label: MODULE_LABELS.tareas },
];

const MODULE_IDS = PERMISSION_MODULES.map((m) => m.id);

export const normalizeRoleKey = (role) => {
  if (!role) return 'cajero';
  if (role === 'manager') return 'gerente';
  return ROLE_KEYS.includes(role) ? role : 'cajero';
};

export const isBusinessAdmin = (profile) => normalizeRoleKey(profile?.role) === 'admin';

export const buildDefaultMatrix = (legacy = {}) => {
  const matrix = {
    admin: Object.fromEntries(MODULE_IDS.map((id) => [id, true])),
    gerente: Object.fromEntries(MODULE_IDS.map((id) => [id, true])),
    operario: {
      cierre: true,
      compras: legacy.cajero_can_compras === true,
      adelantos: true,
      'pago-proveedores': true,
      'pago-impuestos': true,
      rendiciones: legacy.operario_can_retiros === true,
      'pagos-periodicos': true,
      clientes: true,
      proveedores: false,
      empleados: false,
      resultados: false,
      tareas: false,
    },
    cajero: {
      cierre: true,
      compras: legacy.cajero_can_compras === true,
      adelantos: false,
      'pago-proveedores': false,
      'pago-impuestos': false,
      rendiciones: false,
      'pagos-periodicos': true,
      clientes: true,
      proveedores: false,
      empleados: false,
      resultados: false,
      tareas: false,
    },
  };
  return matrix;
};

export const normalizeRolePermissions = (stored, enabledModules = {}) => {
  if (stored?.version === 2 && stored.roles && stored.matrix) {
    const roles = {};
    ROLE_KEYS.forEach((key) => {
      const val = stored.roles[key];
      roles[key] = (typeof val === 'string' ? val : val?.label) || DEFAULT_ROLE_LABELS[key];
    });

    const matrix = buildDefaultMatrix();
    ROLE_KEYS.forEach((roleKey) => {
      matrix[roleKey] = { ...matrix[roleKey], ...(stored.matrix[roleKey] || {}) };
    });
    MODULE_IDS.forEach((id) => {
      matrix.admin[id] = true;
    });

    return { version: 2, roles, matrix };
  }

  return {
    version: 2,
    roles: { ...DEFAULT_ROLE_LABELS },
    matrix: buildDefaultMatrix(stored || {}),
  };
};

export const getEnabledPermissionModules = (modules = {}) =>
  PERMISSION_MODULES.filter((m) => modules[m.id] !== false);

export const hasModulePermission = (rolePermissions, profile, moduleId, modules = {}) => {
  if (!profile) return false;

  const role = normalizeRoleKey(profile.role);
  if (role === 'admin') return true;
  if (modules[moduleId] === false) return false;

  const config = normalizeRolePermissions(rolePermissions, modules);
  return config.matrix[role]?.[moduleId] === true;
};

export const toggleMatrixPermission = (config, roleKey, moduleId, value) => {
  if (roleKey === 'admin') return config;
  return {
    ...config,
    matrix: {
      ...config.matrix,
      [roleKey]: {
        ...config.matrix[roleKey],
        [moduleId]: value,
      },
    },
  };
};

export const updateRoleLabel = (config, roleKey, label) => ({
  ...config,
  roles: {
    ...config.roles,
    [roleKey]: label,
  },
});

export const getRoleOptions = (rolePermissions) => {
  const config = normalizeRolePermissions(rolePermissions);
  return ROLE_KEYS.filter((key) => key !== 'admin').map((key) => ({
    value: key,
    label: config.roles[key] || DEFAULT_ROLE_LABELS[key],
  }));
};

export const LEGACY_USUARIO_TO_ROLE = {
  Administrador: 'admin',
  Empleado: 'operario',
  Gerente: 'gerente',
  Cajero: 'cajero',
};

export const resolveTaskRoleKey = (usuario) => {
  if (!usuario) return null;
  if (ROLE_KEYS.includes(usuario)) return usuario;
  return LEGACY_USUARIO_TO_ROLE[usuario] || null;
};

export const getTaskRoleLabel = (usuario, roles = DEFAULT_ROLE_LABELS) => {
  const key = resolveTaskRoleKey(usuario);
  if (key) return roles[key] || DEFAULT_ROLE_LABELS[key];
  return usuario || null;
};

export const taskVisibleForRole = (usuario, profileRole) => {
  const viewerRole = normalizeRoleKey(profileRole);
  if (viewerRole === 'admin' || viewerRole === 'gerente') return true;
  const taskRole = resolveTaskRoleKey(usuario);
  if (!taskRole) return true;
  return taskRole === viewerRole;
};

export const getTaskRoleOptions = (rolePermissions) => {
  const config = normalizeRolePermissions(rolePermissions);
  return ROLE_KEYS.map((key) => ({
    value: key,
    label: config.roles[key] || DEFAULT_ROLE_LABELS[key],
  }));
};
