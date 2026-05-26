/**
 * Extension API Module
 *
 * @module extensions/api
 */

// API Method Registry
export {
  ApiMethodRegistry,
  DuplicateMethodError,
  MethodExecutionError,
  // Errors
  MethodNotRegisteredError,
  createApiMethodRegistry,
  getDefaultApiMethodRegistry,
  resetDefaultApiMethodRegistry,
  // Types
  type ApiContext,
  type ApiMethodDefinition,
  type ApiMethodHandler,
  type ApiMethodRegistryOptions,
} from './ApiMethodRegistry';

// API Router
export {
  // Constants
  API_ERROR_CODES,
  ApiRouter,
  createApiRouter,
  getDefaultApiRouter,
  resetDefaultApiRouter,
  // Types
  type ApiErrorCode,
  type ApiRouterOptions,
  type ApiRouterStats,
  type RouteResult,
} from './ApiRouter';
