/**
 * Storage Provider Registry (the storage provider lifecycle)
 *
 * Takes a DocumentStorageConfig (from an authorized handoff or test config),
 * validates composition rules, instantiates concrete provider instances via
 * registered factories, reports capabilities, and returns a preflight result.
 *
 * Factory pattern: provider factories are registered by kind. New provider
 * implementations plug in by registering a factory — zero registry changes.
 *
 * @see composition-validator.ts for the pure validation logic
 * @see provider.ts for the Provider interface
 */

import type {
  DocumentStorageConfig,
  StorageProviderKind,
} from '@mog-sdk/types-document/storage/document-provider';
import type { StorageProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { CompositionValidationResult } from '@mog-sdk/types-document/storage/composition';
import type { ProviderFactory, ProviderInstance } from './factory';
import { validateComposition, determineReadyMode } from './composition-validator';

// =============================================================================
// Preflight Result
// =============================================================================

/**
 * Result of a registry preflight: validated composition, instantiated
 * providers, selected ready mode, and per-provider capabilities.
 */
export interface ProviderPreflightResult {
  /** Instantiated provider instances, in config order. */
  readonly providers: ProviderInstance[];
  /** The ready mode determined by the composition and durability config. */
  readonly selectedReadyMode: 'readyReadWrite' | 'readyReadOnly' | 'readyEphemeral';
  /** Composition validation result (violations, warnings, effective durability). */
  readonly compositionResult: CompositionValidationResult;
  /** Per-provider capabilities keyed by providerRefId. */
  readonly capabilities: Map<string, StorageProviderCapabilities>;
}

// =============================================================================
// Storage Provider Registry
// =============================================================================

/**
 * Registry for storage provider factories. The lifecycle system uses this
 * to preflight provider compositions: validate rules, instantiate providers,
 * and determine the ready mode.
 *
 * Usage:
 * ```ts
 * const registry = new StorageProviderRegistry();
 * registry.registerFactory('indexeddb', async (config) => { ... });
 * registry.registerFactory('memory', async (config) => { ... });
 *
 * const result = await registry.preflight(storageConfig);
 * if (!result.compositionResult.valid) {
 *   // handle violations
 * }
 * ```
 */
export class StorageProviderRegistry {
  private readonly factories = new Map<StorageProviderKind, ProviderFactory>();

  /**
   * Register a factory for a given provider kind. Overwrites any
   * previously registered factory for the same kind.
   */
  registerFactory(kind: StorageProviderKind, factory: ProviderFactory): void {
    this.factories.set(kind, factory);
  }

  /**
   * Check whether a factory is registered for a given kind.
   */
  hasFactory(kind: StorageProviderKind): boolean {
    return this.factories.has(kind);
  }

  /**
   * Run preflight for a storage config:
   *   1. Validate composition rules (pure, sync)
   *   2. Instantiate providers via registered factories (async)
   *   3. Collect capabilities
   *   4. Determine ready mode
   *
   * If composition validation fails with errors, the preflight still returns
   * the result (with `compositionResult.valid === false`). The caller decides
   * whether to proceed, fall back, or abort.
   *
   * If a factory is missing for a required provider kind, a composition
   * violation is synthesized. Optional providers with missing factories
   * are skipped with a warning.
   */
  async preflight(config: DocumentStorageConfig): Promise<ProviderPreflightResult> {
    // Step 1: validate composition (pure, sync)
    const compositionResult = validateComposition(config);

    // Step 2: instantiate providers
    const instances: ProviderInstance[] = [];
    const capabilities = new Map<string, StorageProviderCapabilities>();
    const instantiationViolations: import('@mog-sdk/types-document/storage/composition').CompositionViolation[] =
      [];

    for (const providerConfig of config.providers) {
      const factory = this.factories.get(providerConfig.kind);

      if (!factory) {
        if (providerConfig.required) {
          instantiationViolations.push({
            code: 'COMP_NO_FACTORY',
            message:
              `No factory registered for required provider kind "${providerConfig.kind}" ` +
              `(providerRefId: "${providerConfig.providerRefId}").`,
            severity: 'error',
            rule: 'factory-available',
            involvedProviderRefIds: [providerConfig.providerRefId],
          });
        } else {
          instantiationViolations.push({
            code: 'COMP_NO_FACTORY_OPTIONAL',
            message:
              `No factory registered for optional provider kind "${providerConfig.kind}" ` +
              `(providerRefId: "${providerConfig.providerRefId}"). Skipping.`,
            severity: 'warning',
            rule: 'factory-available',
            involvedProviderRefIds: [providerConfig.providerRefId],
          });
        }
        continue;
      }

      try {
        const instance = await factory(providerConfig);
        instances.push(instance);
        capabilities.set(providerConfig.providerRefId, instance.capabilities);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (providerConfig.required) {
          instantiationViolations.push({
            code: 'COMP_FACTORY_ERROR',
            message:
              `Factory for provider "${providerConfig.providerRefId}" (kind: ${providerConfig.kind}) ` +
              `failed: ${message}`,
            severity: 'error',
            rule: 'factory-instantiation',
            involvedProviderRefIds: [providerConfig.providerRefId],
          });
        } else {
          instantiationViolations.push({
            code: 'COMP_FACTORY_ERROR_OPTIONAL',
            message:
              `Factory for optional provider "${providerConfig.providerRefId}" (kind: ${providerConfig.kind}) ` +
              `failed: ${message}. Continuing without it.`,
            severity: 'warning',
            rule: 'factory-instantiation',
            involvedProviderRefIds: [providerConfig.providerRefId],
          });
        }
      }
    }

    // Merge instantiation violations into the composition result
    const mergedResult: CompositionValidationResult = {
      valid:
        compositionResult.valid && !instantiationViolations.some((v) => v.severity === 'error'),
      violations: [
        ...compositionResult.violations,
        ...instantiationViolations.filter((v) => v.severity === 'error'),
      ],
      warnings: [
        ...compositionResult.warnings,
        ...instantiationViolations.filter((v) => v.severity === 'warning'),
      ],
      effectiveDurability: compositionResult.effectiveDurability,
      readOnlyFallbackApplied: compositionResult.readOnlyFallbackApplied,
    };

    // Step 3: determine ready mode
    const selectedReadyMode = determineReadyMode(config, mergedResult);

    return {
      providers: instances,
      selectedReadyMode,
      compositionResult: mergedResult,
      capabilities,
    };
  }
}

// =============================================================================
// Default Factory Registration
// =============================================================================

/**
 * Register all provider factories that don't require external dependencies.
 * Covers: memory, indexeddb, filesystem, objectStore, databaseLog, test.
 *
 * Factories requiring host-supplied resolvers (hostCallback, readOnlySnapshot,
 * redactedPublishedSnapshot) and unimplemented kinds (tauriSidecar, remoteApi)
 * must be registered separately via `registry.registerFactory()`.
 */
export function registerDefaultFactories(registry: StorageProviderRegistry): void {
  // Lazy imports avoid pulling every provider into bundles that only use a subset.
  registry.registerFactory('memory', async (config) => {
    const { createMemoryRegistryFactory } = await import('./memory-provider');
    return createMemoryRegistryFactory()(config);
  });

  registry.registerFactory('indexeddb', async (config) => {
    const { createIndexedDbProviderFactory } = await import('./indexeddb-provider');
    return createIndexedDbProviderFactory()(config);
  });

  registry.registerFactory('filesystem', async (config) => {
    const { createFilesystemProviderFactory } = await import('./filesystem-provider');
    return createFilesystemProviderFactory()(config);
  });

  registry.registerFactory('objectStore', async (config) => {
    const { createObjectStoreRegistryFactory } = await import('./object-store-provider');
    return createObjectStoreRegistryFactory()(config);
  });

  registry.registerFactory('databaseLog', async (config) => {
    const { createDatabaseLogRegistryFactory } = await import('./database-log-provider');
    return createDatabaseLogRegistryFactory()(config);
  });

  registry.registerFactory('test', async (config) => {
    const { createTestRegistryFactory } = await import('./test-provider');
    return createTestRegistryFactory()(config);
  });
}
