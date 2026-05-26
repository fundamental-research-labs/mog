/**
 * Extension Panel Constants
 *
 * Configuration values for the extension system including origins,
 * timeouts, rate limits, and default dimensions.
 *
 * @module extensions/constants
 */

import { isDev as envIsDev, isTest as envIsTest } from '@mog/env';

// =============================================================================
// Origins
// =============================================================================

/**
 * Production origin for extension hosting.
 * Extensions are served from a separate origin for cross-origin isolation.
 */
export const EXTENSION_ORIGIN_PRODUCTION = 'https://extensions.shortcut.io';

/**
 * CDN origin for shared resources (e.g., Office JS shim)
 */
export const CDN_ORIGIN = 'https://cdn.shortcut.io';

/**
 * Development mode origins (localhost variations)
 */
export const DEV_EXTENSION_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  // Add-in dev servers (HTTPS)
  'https://localhost:4000',
  'https://127.0.0.1:4000',
  // Sandboxed iframe origin (without allow-same-origin, the origin is "null")
  // This is safe in dev mode because we still validate message structure
  'null',
] as const;

/**
 * Check if we're in development mode.
 * Delegates to @mog/env helpers, which handle both Vite (import.meta.env)
 * and Node/Jest (process.env) runtimes without leaking `process` globals.
 */
export function isDev(): boolean {
  return envIsDev() || envIsTest();
}

/**
 * Get the extension origin based on environment.
 * In development, allows localhost. In production, only the production origin.
 */
export function getExtensionOrigin(): string {
  if (isDev()) {
    // In dev mode, return the first dev origin as default
    // Real validation happens in origin-validator.ts
    return DEV_EXTENSION_ORIGINS[0];
  }
  return EXTENSION_ORIGIN_PRODUCTION;
}

/**
 * Get the host origin (current window origin)
 */
export function getHostOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://app.shortcut.io'; // Fallback for SSR/tests
}

// =============================================================================
// Protocol
// =============================================================================

/**
 * Protocol version string for message validation
 */
export const EXTENSION_PROTOCOL_VERSION = 'shortcut-extension-v1' as const;

// =============================================================================
// Timeouts
// =============================================================================

/**
 * Timeout for extension iframe to load (ms)
 */
export const EXTENSION_LOAD_TIMEOUT = 15_000;

/**
 * Timeout for handshake to complete (ms)
 */
export const HANDSHAKE_TIMEOUT = 10_000;

/**
 * Default timeout for API requests (ms)
 */
export const API_REQUEST_TIMEOUT = 30_000;

/**
 * Heartbeat interval to check extension health (ms)
 */
export const HEARTBEAT_INTERVAL = 30_000;

/**
 * Time after which an extension is considered disconnected if no activity (ms)
 */
export const DISCONNECT_THRESHOLD = 60_000;

/**
 * Delay before retrying failed connection (ms)
 */
export const RETRY_BASE_DELAY = 1_000;

/**
 * Maximum retry delay with exponential backoff (ms)
 */
export const RETRY_MAX_DELAY = 30_000;

/**
 * Maximum number of connection retry attempts
 */
export const MAX_RETRY_ATTEMPTS = 5;

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Maximum API requests per second per extension
 */
export const API_REQUESTS_PER_SECOND = 100;

/**
 * Maximum events per second to forward to an extension
 */
export const EVENTS_PER_SECOND = 50;

/**
 * Maximum number of pending (in-flight) requests per extension
 */
export const MAX_PENDING_REQUESTS = 50;

/**
 * Rate limit window duration (ms)
 */
export const RATE_LIMIT_WINDOW = 1_000;

// =============================================================================
// Panel Dimensions
// =============================================================================

/**
 * Default panel width (px)
 */
export const DEFAULT_PANEL_WIDTH = 400;

/**
 * Minimum panel width (px)
 */
export const MIN_PANEL_WIDTH = 280;

/**
 * Maximum panel width (px)
 */
export const MAX_PANEL_WIDTH = 800;

/**
 * Panel resize handle width (px)
 */
export const RESIZE_HANDLE_WIDTH = 8;

// =============================================================================
// Iframe Sandbox
// =============================================================================

/**
 * Sandbox flags for extension iframes.
 *
 * CRITICAL: Do NOT add 'allow-same-origin' - this would defeat cross-origin isolation!
 *
 * Allowed:
 * - allow-scripts: Required for extension code to run
 * - allow-forms: Required for form submissions within extension
 * - allow-popups: Required for OAuth flows, external links
 * - allow-popups-to-escape-sandbox: Popups not sandboxed (for OAuth)
 *
 * Denied (by omission):
 * - allow-same-origin: Would defeat security isolation
 * - allow-top-navigation: Extension cannot navigate host
 * - allow-modals: Extension cannot block host with alert/confirm
 * - allow-pointer-lock: Extension cannot capture pointer
 * - allow-orientation-lock: Extension cannot lock orientation
 */
export const IFRAME_SANDBOX_FLAGS =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';

/**
 * Permissions policy for extension iframes
 */
export const IFRAME_ALLOW_POLICY = 'clipboard-write';

/**
 * Referrer policy for extension iframes
 */
export const IFRAME_REFERRER_POLICY = 'no-referrer';

// =============================================================================
// Local Storage Keys
// =============================================================================

/**
 * Key for storing panel visibility preference
 */
export const STORAGE_KEY_PANEL_VISIBLE = 'shortcut:extension-panel:visible';

/**
 * Key for storing panel width preference
 */
export const STORAGE_KEY_PANEL_WIDTH = 'shortcut:extension-panel:width';

/**
 * Key for storing active extension ID
 */
export const STORAGE_KEY_ACTIVE_EXTENSION = 'shortcut:extension-panel:active';

// =============================================================================
// Events
// =============================================================================

/**
 * Spreadsheet events that can be forwarded to extensions
 */
export const FORWARDABLE_EVENTS = [
  'selectionChanged',
  'cellChanged',
  'cellsChanged',
  'sheetActivated',
  'sheetAdded',
  'sheetDeleted',
  'sheetRenamed',
  'chartSelected',
  'chartUpdated',
] as const;

export type ForwardableEvent = (typeof FORWARDABLE_EVENTS)[number];

/**
 * Permission required for each event type
 */
export const EVENT_PERMISSIONS: Record<ForwardableEvent, import('./types').ExtensionPermission> = {
  selectionChanged: 'selection:read',
  cellChanged: 'spreadsheet:read',
  cellsChanged: 'spreadsheet:read',
  sheetActivated: 'spreadsheet:read',
  sheetAdded: 'spreadsheet:read',
  sheetDeleted: 'spreadsheet:read',
  sheetRenamed: 'spreadsheet:read',
  chartSelected: 'charts:read',
  chartUpdated: 'charts:read',
};

/**
 * Debounce delays for high-frequency events (ms)
 */
export const EVENT_DEBOUNCE_DELAYS: Partial<Record<ForwardableEvent, number>> = {
  selectionChanged: 50, // Debounce during drag selection
  cellChanged: 0, // No debounce for individual cell changes
  cellsChanged: 100, // Batch rapid changes
};
