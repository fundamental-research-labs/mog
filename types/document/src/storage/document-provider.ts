/**
 * Document storage provider contracts
 *
 * Canonical storage types consumed by @mog-sdk/types-host and the kernel
 * storage lifecycle. Provider registry and lifecycle depend on these types.
 */

import type { StorageProviderConfig } from './provider-configs';
import type { StorageProviderKind, StorageProviderRole } from './provider-kinds';
export type { StorageProviderKind, StorageProviderRole } from './provider-kinds';

// =============================================================================
// Core Enums / Unions
// =============================================================================

export type DocumentOpenIntent =
  | 'create'
  | 'open'
  | 'importInitialize'
  | 'readOnlySnapshot'
  | 'ephemeral';

export type DocumentDurabilityMode =
  | 'ephemeral'
  | 'durableLocal'
  | 'localFirst'
  | 'remoteBacked'
  | 'readOnly';

// =============================================================================
// Document Storage Config
// =============================================================================

export interface DocumentStorageConfig {
  readonly intent: DocumentOpenIntent;
  readonly durability: DocumentDurabilityMode;
  readonly providers: readonly StorageProviderConfig[];
  readonly requireDurabilityBeforeReady: boolean;
  readonly allowReadOnlyFallback: boolean;
}
