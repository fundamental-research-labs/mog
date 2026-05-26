/**
 * Extension Panel Type Definitions
 *
 * Types for the secure, cross-origin extension system that hosts add-ins
 * in sandboxed iframes with postMessage communication.
 *
 * @module extensions/types
 */

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Fine-grained permissions that extensions can request.
 * Permissions are enforced at the host side, not the extension side.
 */
export type ExtensionPermission =
  // Spreadsheet data
  | 'spreadsheet:read' // Read cells, formulas, ranges
  | 'spreadsheet:write' // Write cells, formulas
  | 'spreadsheet:format' // Change formatting
  | 'spreadsheet:structure' // Insert/delete rows, columns, sheets

  // Charts
  | 'charts:read' // Read chart data
  | 'charts:write' // Create/modify charts

  // Selection
  | 'selection:read' // Read current selection
  | 'selection:write' // Change selection

  // User info (future)
  | 'user:read' // Read user name/email

  // Network (future)
  | 'network:fetch'; // Make network requests via host

// =============================================================================
// Extension Manifest
// =============================================================================

/**
 * Panel configuration in the manifest
 */
export interface ExtensionPanelConfig {
  /** Default panel width in pixels */
  defaultWidth: number;
  /** Minimum panel width in pixels */
  minWidth: number;
  /** Maximum panel width in pixels */
  maxWidth: number;
}

/**
 * Office JS shim configuration
 */
export interface ExtensionOfficeJsConfig {
  /** Version of the Office JS shim to use */
  shimVersion: string;
  /** URL to load the shim from */
  shimUrl: string;
}

/**
 * Content Security Policy overrides (for connect-src)
 */
export interface ExtensionCSPConfig {
  /** Additional allowed connect-src origins */
  connectSrc: string[];
}

/**
 * Extension author metadata
 */
export interface ExtensionAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Extension manifest format.
 * Extensions include a manifest.json describing their metadata and requirements.
 */
export interface ExtensionManifest {
  /** JSON schema URL for validation */
  $schema?: string;

  /** Unique extension identifier (e.g., "shortcut-ai") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Brief description */
  description: string;

  /** Author information */
  author: ExtensionAuthor;

  /** Path to icon (relative to manifest) */
  icon: string;

  /** Entry point HTML file (relative to manifest) */
  entryPoint: string;

  /** Required permissions */
  permissions: ExtensionPermission[];

  /** Panel configuration */
  panel?: ExtensionPanelConfig;

  /** Office JS shim configuration (optional) */
  officejs?: ExtensionOfficeJsConfig;

  /** CSP overrides */
  csp?: ExtensionCSPConfig;
}

// =============================================================================
// Extension Lifecycle
// =============================================================================

/**
 * Extension lifecycle states
 */
export type ExtensionLifecycleState =
  | 'idle' // Not loaded
  | 'loading' // Iframe loading
  | 'handshaking' // Performing handshake
  | 'ready' // Ready for use
  | 'error' // Error state
  | 'disconnected'; // Connection lost

/**
 * Runtime state of a loaded extension
 */
export interface ExtensionInstance {
  /** Manifest data */
  manifest: ExtensionManifest;

  /** Current lifecycle state */
  state: ExtensionLifecycleState;

  /** Full URL to the extension (e.g., https://extensions.shortcut.io/shortcut-ai/1.0.0/) */
  baseUrl: string;

  /** Session ID assigned during handshake */
  sessionId: string | null;

  /** Error message if state is 'error' */
  error: string | null;

  /** Timestamp of last successful communication */
  lastActivity: number;

  /** Subscribed event names */
  subscribedEvents: Set<string>;
}

// =============================================================================
// Message Protocol
// =============================================================================

/**
 * Base message interface for all extension messages.
 * All messages include protocol version and unique ID for correlation.
 */
export interface BaseMessage {
  /** Protocol version for compatibility */
  protocol: 'shortcut-extension-v1';
  /** Message type discriminator */
  type: string;
  /** Unique message ID for request/response correlation */
  id: string;
  /** Timestamp for debugging and timeout detection */
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Handshake Messages
// -----------------------------------------------------------------------------

/**
 * Host -> Extension: Initial configuration after extension signals ready
 */
export interface InitMessage extends BaseMessage {
  type: 'INIT';
  /** Host origin for validation */
  hostOrigin: string;
  /** Extension's granted permissions */
  permissions: ExtensionPermission[];
  /** Current spreadsheet context */
  context: {
    activeSheetId: string;
    activeSheetName: string;
    selection: { range: string } | null;
  };
}

/**
 * Extension -> Host: Extension has loaded and is ready (sent twice - once on load, once after INIT processed)
 */
export interface ReadyMessage extends BaseMessage {
  type: 'READY';
  /** Extension ID from manifest */
  extensionId: string;
  /** Extension version from manifest */
  version: string;
  /** Office JS shim version loaded (if applicable) */
  shimVersion?: string;
}

/**
 * Host -> Extension: Handshake complete, normal operation begins
 */
export interface ConnectedMessage extends BaseMessage {
  type: 'CONNECTED';
  /** Session ID for this connection */
  sessionId: string;
}

// -----------------------------------------------------------------------------
// API Messages
// -----------------------------------------------------------------------------

/**
 * Extension -> Host: API call request
 */
export interface ApiRequestMessage extends BaseMessage {
  type: 'API_REQUEST';
  /** API method to call (e.g., "sheet.getCell") */
  method: string;
  /** Method arguments (must be structured-cloneable) */
  args: unknown[];
}

/**
 * API error details
 */
export interface ApiError {
  /** Error code (e.g., "PERMISSION_DENIED", "METHOD_NOT_FOUND") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
}

/**
 * Host -> Extension: API call response
 */
export interface ApiResponseMessage extends BaseMessage {
  type: 'API_RESPONSE';
  /** ID of the request this responds to */
  requestId: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Result if successful */
  result?: unknown;
  /** Error if unsuccessful */
  error?: ApiError;
}

// -----------------------------------------------------------------------------
// Event Messages
// -----------------------------------------------------------------------------

/**
 * Host -> Extension: Spreadsheet event notification
 */
export interface EventMessage extends BaseMessage {
  type: 'EVENT';
  /** Event name (e.g., "selectionChanged", "cellChanged") */
  event: string;
  /** Event data */
  data: unknown;
}

/**
 * Extension -> Host: Subscribe to events
 */
export interface SubscribeMessage extends BaseMessage {
  type: 'SUBSCRIBE';
  /** Events to subscribe to */
  events: string[];
}

/**
 * Extension -> Host: Unsubscribe from events
 */
export interface UnsubscribeMessage extends BaseMessage {
  type: 'UNSUBSCRIBE';
  /** Events to unsubscribe from */
  events: string[];
}

// -----------------------------------------------------------------------------
// Message Union Types
// -----------------------------------------------------------------------------

/**
 * Messages sent from Host to Extension
 */
export type HostToExtensionMessage =
  | InitMessage
  | ConnectedMessage
  | ApiResponseMessage
  | EventMessage;

/**
 * Messages sent from Extension to Host
 */
export type ExtensionToHostMessage =
  | ReadyMessage
  | ApiRequestMessage
  | SubscribeMessage
  | UnsubscribeMessage;

/**
 * All message types
 */
export type ExtensionMessage = HostToExtensionMessage | ExtensionToHostMessage;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a valid extension message
 */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  return (
    msg.protocol === 'shortcut-extension-v1' &&
    typeof msg.type === 'string' &&
    typeof msg.id === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

/**
 * Check if a message is a READY message
 */
export function isReadyMessage(msg: ExtensionMessage): msg is ReadyMessage {
  return msg.type === 'READY';
}

/**
 * Check if a message is an API_REQUEST message
 */
export function isApiRequestMessage(msg: ExtensionMessage): msg is ApiRequestMessage {
  return msg.type === 'API_REQUEST';
}

/**
 * Check if a message is a SUBSCRIBE message
 */
export function isSubscribeMessage(msg: ExtensionMessage): msg is SubscribeMessage {
  return msg.type === 'SUBSCRIBE';
}

/**
 * Check if a message is an UNSUBSCRIBE message
 */
export function isUnsubscribeMessage(msg: ExtensionMessage): msg is UnsubscribeMessage {
  return msg.type === 'UNSUBSCRIBE';
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Pending request tracking
 */
export interface PendingRequest {
  /** Request message ID */
  id: string;
  /** API method being called */
  method: string;
  /** Timestamp when request was sent */
  timestamp: number;
  /** Promise resolve function */
  resolve: (result: unknown) => void;
  /** Promise reject function */
  reject: (error: Error) => void;
}

/**
 * Rate limiter state
 */
export interface RateLimiterState {
  /** Request timestamps for rate limiting */
  timestamps: number[];
  /** Number of requests in current window */
  count: number;
}
