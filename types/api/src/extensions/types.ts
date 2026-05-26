/**
 * Extension Types
 *
 * Pure type definitions for the extension/add-in system.
 * These types define extension manifests, permissions, lifecycle states,
 * and runtime instances. They are shared between the extension host,
 * the extension registry, and UI components that display extension state.
 *
 * @module @mog-sdk/contracts/extensions
 */

// =============================================================================
// PERMISSIONS
// =============================================================================

/** Granular permissions that an extension can request. */
export type ExtensionPermission =
  | 'spreadsheet:read'
  | 'spreadsheet:write'
  | 'spreadsheet:format'
  | 'spreadsheet:structure'
  | 'charts:read'
  | 'charts:write'
  | 'selection:read'
  | 'selection:write'
  | 'user:read'
  | 'network:fetch';

// =============================================================================
// MANIFEST CONFIGURATION
// =============================================================================

/** Panel layout configuration for a sidebar extension. */
export interface ExtensionPanelConfig {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

/** Office.js compatibility shim configuration. */
export interface ExtensionOfficeJsConfig {
  shimVersion: string;
  shimUrl: string;
}

/** Content Security Policy overrides for the extension iframe. */
export interface ExtensionCSPConfig {
  connectSrc: string[];
}

/** Author metadata for an extension. */
export interface ExtensionAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Extension manifest — the static declaration of an extension's identity,
 * capabilities, and configuration. Loaded from the extension's manifest.json.
 */
export interface ExtensionManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  description: string;
  author: ExtensionAuthor;
  icon: string;
  entryPoint: string;
  permissions: ExtensionPermission[];
  panel?: ExtensionPanelConfig;
  officejs?: ExtensionOfficeJsConfig;
  csp?: ExtensionCSPConfig;
}

// =============================================================================
// RUNTIME STATE
// =============================================================================

/** Lifecycle states of a running extension instance. */
export type ExtensionLifecycleState =
  | 'idle'
  | 'loading'
  | 'handshaking'
  | 'ready'
  | 'error'
  | 'disconnected';

/** Runtime state of a loaded extension instance. */
export interface ExtensionInstance {
  manifest: ExtensionManifest;
  state: ExtensionLifecycleState;
  baseUrl: string;
  sessionId: string | null;
  error: string | null;
  lastActivity: number;
  subscribedEvents: Set<string>;
}
