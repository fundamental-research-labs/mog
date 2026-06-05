/**
 * Storage runtime profile types
 *
 * Profiles identify the runtime context and default provider composition
 * for a document session. The lifecycle uses these to select default
 * providers and validate composition rules.
 */

// =============================================================================
// Runtime Profile
// =============================================================================

/**
 * Identifies the runtime context for provider selection.
 * Each profile implies a default set of providers and composition rules.
 */
export type StorageRuntimeProfile =
  | 'browser-standalone'
  | 'browser-embed-editable'
  | 'browser-published-readonly'
  | 'browser-local-first-sync'
  | 'headless-ephemeral'
  | 'sdk-node-durable'
  | 'server-remote-backed'
  | 'tauri-desktop'
  | 'test';

// =============================================================================
// Profile Descriptor
// =============================================================================

/**
 * Metadata about a runtime profile, used by the registry to
 * resolve default provider compositions.
 */
export interface StorageRuntimeProfileDescriptor {
  /** The profile identifier. */
  readonly profile: StorageRuntimeProfile;
  /** Human-readable description. */
  readonly description: string;
  /** Whether this profile supports offline operation. */
  readonly offlineCapable: boolean;
  /** Whether this profile supports real-time collaboration. */
  readonly collaborationCapable: boolean;
  /** Default durability mode for this profile. */
  readonly defaultDurability: string;
  /** Provider kinds typically used with this profile. */
  readonly typicalProviderKinds: readonly string[];
}
