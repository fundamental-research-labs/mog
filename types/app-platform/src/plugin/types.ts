import type { CompatibilityRequirement } from '../manifest/types';
import type { CapabilityId, CapabilitySubject } from '../capabilities/types';
import type { ContributionDeclaration } from '../contributions/types';

// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __pluginIdBrand: unique symbol;

/** Opaque identifier for a registered plugin. */
export type PluginId = string & {
  readonly [__pluginIdBrand]: typeof __pluginIdBrand;
};

/** Create a branded PluginId from a raw string. */
export function createPluginId(raw: string): PluginId {
  return raw as PluginId;
}

// ─── Isolation Mode ──────────────────────────────────────────────────────────

/** How the plugin's code is isolated at runtime. */
export type PluginIsolationMode =
  | 'same-realm-trusted'
  | 'worker-sandbox'
  | 'iframe-sandbox'
  | 'server-side'
  | 'disabled';

// ─── Extension Target ────────────────────────────────────────────────────────

/** What host surface a plugin extends. */
export type PluginExtensionTarget =
  | 'shell'
  | 'app'
  | 'view'
  | 'command'
  | 'panel'
  | 'file-type'
  | 'extension-slot'
  | 'connector'
  | 'workflow-trigger';

// ─── Activation Event ────────────────────────────────────────────────────────

/** Kind of event that triggers plugin activation. */
export type ActivationEventKind =
  | 'onStartup'
  | 'onCommand'
  | 'onFileType'
  | 'onView'
  | 'onResourceKind'
  | 'onCustomEvent';

/** Typed activation trigger for a plugin. */
export interface PluginActivationEvent {
  /** Kind of activation trigger. */
  readonly kind: ActivationEventKind;
  /** Trigger-specific selector (e.g. command ID, file extension). */
  readonly selector?: string;
}

// ─── Plugin Entry ────────────────────────────────────────────────────────────

/** Entry point descriptor for a plugin. */
export interface PluginEntryDescriptor {
  /** Module specifier or URL. */
  readonly module: string;
  /** Named export to invoke. */
  readonly export?: string;
}

// ─── Plugin Manifest ─────────────────────────────────────────────────────────

/** Complete manifest describing an installable plugin. */
export interface PluginManifest {
  /** Unique plugin identifier. */
  readonly pluginId: PluginId;
  /** Semver version string. */
  readonly version: string;
  /** Host compatibility requirements. */
  readonly hostCompatibility: readonly CompatibilityRequirement[];
  /** Extension targets this plugin extends. */
  readonly extends: readonly PluginExtensionTarget[];
  /** Entry point descriptor. */
  readonly entry: PluginEntryDescriptor;
  /** Contribution declarations. */
  readonly contributions: readonly ContributionDeclaration[];
  /** Capability IDs this plugin may request. */
  readonly capabilities: readonly CapabilityId[];
  /** Events that trigger activation. */
  readonly activationEvents: readonly PluginActivationEvent[];
  /** Runtime isolation mode. */
  readonly isolationMode: PluginIsolationMode;
}

// ─── Plugin Instance State ───────────────────────────────────────────────────

/** Lifecycle state of a plugin instance. */
export type PluginInstanceState =
  | 'registered'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'denied'
  | 'unsupportedIsolation'
  | 'crashed'
  | 'disabled';

// ─── Plugin Activation ───────────────────────────────────────────────────────

/** Runtime state of an activated plugin instance. */
export interface PluginActivation {
  /** Plugin identifier. */
  readonly pluginId: PluginId;
  /** What triggered activation. */
  readonly activationTarget: PluginActivationEvent;
  /** Grant subject for capability checks. */
  readonly grantSubject: CapabilitySubject;
  /** Resource scopes the plugin is authorized for. */
  readonly resourceScopes: readonly string[];
  /** Contribution lease IDs. */
  readonly contributionLeases: readonly string[];
  /** Channel session identifier for IPC. */
  readonly channelSession: string;
  /** Current lifecycle state. */
  readonly state: PluginInstanceState;
}
