/**
 * Extension Panel Module
 *
 * Secure, cross-origin extension system for hosting add-ins in sandboxed iframes.
 *
 * @module extensions
 */

// =============================================================================
// Components
// =============================================================================

export { ExtensionHost, ExtensionPanel } from './components';

// =============================================================================
// Security
// =============================================================================

export {
  clearOriginCache,
  extractMessageId,
  formatValidationError,
  getTrustedOriginsList,
  isValidExtensionOrigin,
  isValidMessage,
  validateExtensionOrigin,
  validateHostOrigin,
  validateMessage,
  type MessageValidationResult,
  type OriginValidationResult,
} from './security';

// =============================================================================
// Extension Manager
// =============================================================================

export {
  ExtensionManager,
  getExtensionManager,
  resetExtensionManager,
  type ExtensionManagerState,
  type LoadExtensionOptions,
} from './ExtensionManager';

// =============================================================================
// Types
// =============================================================================

export type {
  ApiError,
  // Messages - API
  ApiRequestMessage,
  ApiResponseMessage,
  // Messages - Base
  BaseMessage,
  ConnectedMessage,
  // Messages - Events
  EventMessage,
  ExtensionAuthor,
  ExtensionCSPConfig,
  ExtensionInstance,
  // Lifecycle
  ExtensionLifecycleState,
  // Manifest
  ExtensionManifest,
  ExtensionMessage,
  ExtensionOfficeJsConfig,
  ExtensionPanelConfig,
  // Permissions
  ExtensionPermission,
  ExtensionToHostMessage,
  // Message Unions
  HostToExtensionMessage,
  // Messages - Handshake
  InitMessage,
  // Utilities
  PendingRequest,
  RateLimiterState,
  ReadyMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from './types';

// Type guards
export {
  isApiRequestMessage,
  isExtensionMessage,
  isReadyMessage,
  isSubscribeMessage,
  isUnsubscribeMessage,
} from './types';

// =============================================================================
// Messaging
// =============================================================================

export {
  HandshakeError,
  // Handshake Manager
  HandshakeManager,
  HandshakeTimeoutError,
  HandshakeValidationError,
  // Message Bridge
  MessageBridge,
  MessageBridgeError,
  OriginValidationError,
  RateLimitError,
  RequestTimeoutError,
  // Request Tracker
  RequestTracker,
  RequestTrackerError,
  TooManyRequestsError,
  createHandshakeManager,
  createMessageBridge,
  createRequestTracker,
  type HandshakeContext,
  type HandshakeOptions,
  type HandshakeResult,
  type HandshakeState,
  type MessageBridgeOptions,
  type MessageBridgeStats,
  type RequestTrackerOptions,
  type RequestTrackerStats,
  type SendMessageOptions,
  type TrackRequestOptions,
} from './messaging';

// =============================================================================
// Permissions
// =============================================================================

export {
  // Constants
  DEFAULT_PERMISSION_MAP,
  MethodNotFoundError,
  PermissionDeniedError,
  // Permission Enforcer
  PermissionEnforcer,
  // Errors
  PermissionError,
  createPermissionEnforcer,
  getDefaultPermissionEnforcer,
  resetDefaultPermissionEnforcer,
  type MethodPermission,
  // Types
  type PermissionCheckResult,
  type PermissionEnforcerOptions,
} from './permissions';

// =============================================================================
// API
// =============================================================================

export {
  // Constants
  API_ERROR_CODES,
  // API Method Registry
  ApiMethodRegistry,
  // API Router
  ApiRouter,
  DuplicateMethodError,
  MethodExecutionError,
  // Errors
  MethodNotRegisteredError,
  createApiMethodRegistry,
  createApiRouter,
  getDefaultApiMethodRegistry,
  getDefaultApiRouter,
  resetDefaultApiMethodRegistry,
  resetDefaultApiRouter,
  // Types
  type ApiContext,
  type ApiErrorCode,
  type ApiMethodDefinition,
  type ApiMethodHandler,
  type ApiMethodRegistryOptions,
  type ApiRouterOptions,
  type ApiRouterStats,
  type RouteResult,
} from './api';

// =============================================================================
// Constants
// =============================================================================

export {
  // Rate Limiting
  API_REQUESTS_PER_SECOND,
  API_REQUEST_TIMEOUT,
  CDN_ORIGIN,
  // Panel Dimensions
  DEFAULT_PANEL_WIDTH,
  DEV_EXTENSION_ORIGINS,
  DISCONNECT_THRESHOLD,
  EVENTS_PER_SECOND,
  EVENT_DEBOUNCE_DELAYS,
  EVENT_PERMISSIONS,
  // Timeouts
  EXTENSION_LOAD_TIMEOUT,
  // Origins
  EXTENSION_ORIGIN_PRODUCTION,
  // Protocol
  EXTENSION_PROTOCOL_VERSION,
  // Events
  FORWARDABLE_EVENTS,
  HANDSHAKE_TIMEOUT,
  HEARTBEAT_INTERVAL,
  IFRAME_ALLOW_POLICY,
  IFRAME_REFERRER_POLICY,
  // Iframe Security
  IFRAME_SANDBOX_FLAGS,
  MAX_PANEL_WIDTH,
  MAX_PENDING_REQUESTS,
  MAX_RETRY_ATTEMPTS,
  MIN_PANEL_WIDTH,
  RATE_LIMIT_WINDOW,
  RESIZE_HANDLE_WIDTH,
  RETRY_BASE_DELAY,
  RETRY_MAX_DELAY,
  STORAGE_KEY_ACTIVE_EXTENSION,
  // Storage Keys
  STORAGE_KEY_PANEL_VISIBLE,
  STORAGE_KEY_PANEL_WIDTH,
  getExtensionOrigin,
  getHostOrigin,
  isDev,
  type ForwardableEvent,
} from './constants';

// =============================================================================
// Events
// =============================================================================

export {
  // Event Forwarder
  EventForwarder,
  // Event Subscription Manager
  EventSubscriptionManager,
  createEventForwarder,
  createEventSubscriptionManager,
  getDefaultEventSubscriptionManager,
  resetDefaultEventSubscriptionManager,
  type CellChangedEventData,
  type CellsChangedEventData,
  type ChartSelectedEventData,
  type ChartUpdatedEventData,
  type EventForwarderOptions,
  type EventForwarderStats,
  type EventSubscriptionManagerOptions,
  type SelectionChangedEventData,
  type SendEventCallback,
  type SheetActivatedEventData,
  type SheetAddedEventData,
  type SheetDeletedEventData,
  type SheetRenamedEventData,
  type SpreadsheetEventData,
  // Types
  type SubscriptionResult,
} from './events';
