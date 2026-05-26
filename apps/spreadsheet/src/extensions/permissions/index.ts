/**
 * Extension Permissions Module
 *
 * @module extensions/permissions
 */

export {
  // Default permission map
  DEFAULT_PERMISSION_MAP,
  MethodNotFoundError,
  PermissionDeniedError,
  // Classes
  PermissionEnforcer,
  // Error classes
  PermissionError,
  // Factory and singleton
  createPermissionEnforcer,
  getDefaultPermissionEnforcer,
  resetDefaultPermissionEnforcer,
  type MethodPermission,
  // Types
  type PermissionCheckResult,
  type PermissionEnforcerOptions,
} from './PermissionEnforcer';
