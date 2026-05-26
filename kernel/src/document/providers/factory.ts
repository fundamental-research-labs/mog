import type { StorageProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { Provider } from './provider';

/**
 * A concrete provider instance with its config and reported capabilities.
 */
export interface ProviderInstance {
  /** The config used to create this provider. */
  readonly config: StorageProviderConfig;
  /** The instantiated Provider implementation. */
  readonly provider: Provider;
  /** Capabilities reported by the factory for this provider. */
  readonly capabilities: StorageProviderCapabilities;
}

/**
 * A factory function that creates a ProviderInstance from a typed config.
 * Factories are registered per StorageProviderKind.
 */
export type ProviderFactory = (config: StorageProviderConfig) => Promise<ProviderInstance>;
