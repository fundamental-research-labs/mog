/**
 * TestProvider — MemoryProvider subclass with failure injection.
 *
 * Extends MemoryProvider with fine-grained control over:
 *   - Per-operation failure injection (attach, append, flush, checkpoint, detach)
 *   - Per-operation latency injection
 *   - Operation counters for test assertions
 *   - Update inspection for verifying Provider behavior
 *
 * The TestProvider is the primary tool for testing orchestrator resilience,
 * error handling, and degraded-mode behavior. Every failure scenario the
 * orchestrator must handle can be reproduced via `setFailure` / `setLatency`.
 *
 * Accepts `TestProviderConfig` from `@mog-sdk/types-document/storage`.
 *
 * @see memory-provider.ts — base implementation
 * @see provider.ts — the Provider contract
 */

import {
  MemoryProvider,
  type MemoryProviderOptions,
  type MemoryProviderStorage,
} from './memory-provider';
import type {
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointMode,
  ProviderCheckpointResult,
  ProviderDoc,
} from './provider';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type { StorageProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Options
// =============================================================================

export type TestProviderFailureOperation =
  | 'attach'
  | 'appendUpdate'
  | 'flush'
  | 'checkpoint'
  | 'detach'
  | 'flushSync';

export type TestProviderLatencyOperation = 'attach' | 'flush' | 'checkpoint' | 'detach';

export interface TestProviderOptions extends MemoryProviderOptions {
  /**
   * When true, all operations fail by default. Individual operations
   * can be toggled via `setFailure`.
   */
  simulateFailures?: boolean;

  /**
   * Simulated latency applied to all async operations by default.
   * Individual operations can be tuned via `setLatency`.
   */
  simulatedLatencyMs?: number;
}

// =============================================================================
// Helpers
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// TestProvider
// =============================================================================

export class TestProvider extends MemoryProvider {
  override readonly name = 'TestProvider';

  // Failure flags per operation
  private failures: Map<TestProviderFailureOperation, boolean> = new Map();

  // Latency per async operation
  private latencies: Map<TestProviderLatencyOperation, number> = new Map();

  // Operation counters
  private _attachCount = 0;
  private _appendCount = 0;
  private _flushCount = 0;
  private _flushSyncCount = 0;
  private _checkpointCount = 0;
  private _detachCount = 0;

  // Recorded updates for inspection
  private _recordedUpdates: Uint8Array[] = [];

  constructor(docId: string, options: TestProviderOptions = {}) {
    // Wire up the failFlushSync hook to our failure map
    const failFlushSync = () => {
      return this.failures.get('flushSync') ?? false;
    };
    super(docId, { ...options, failFlushSync });

    // Apply blanket failure/latency from config
    if (options.simulateFailures) {
      for (const op of [
        'attach',
        'appendUpdate',
        'flush',
        'checkpoint',
        'detach',
        'flushSync',
      ] as TestProviderFailureOperation[]) {
        this.failures.set(op, true);
      }
    }

    if (options.simulatedLatencyMs && options.simulatedLatencyMs > 0) {
      for (const op of [
        'attach',
        'flush',
        'checkpoint',
        'detach',
      ] as TestProviderLatencyOperation[]) {
        this.latencies.set(op, options.simulatedLatencyMs);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Capabilities (same as MemoryProvider — not durable)
  // ---------------------------------------------------------------------------

  override getCapabilities(): StorageProviderCapabilities {
    return {
      ...super.getCapabilities(),
      durable: false,
    };
  }

  override getIdentity(): StorageProviderIdentity {
    return {
      providerRefId: `test:${this.docId}`,
      storageScope: {
        kind: 'explicit-no-scope',
        reason: 'deterministic-test-fixture',
      },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  // ---------------------------------------------------------------------------
  // Provider interface overrides with failure injection
  // ---------------------------------------------------------------------------

  override async attach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<ProviderAttachResult> {
    this._attachCount++;

    const latency = this.latencies.get('attach') ?? 0;
    if (latency > 0) await delay(latency);

    if (this.failures.get('attach')) {
      throw new Error('TestProvider: simulated attach failure');
    }

    return super.attach(doc, mode);
  }

  override appendUpdate(update: Uint8Array): void {
    this._appendCount++;
    this._recordedUpdates.push(new Uint8Array(update));

    if (this.failures.get('appendUpdate')) {
      // Silent drop — per the contract, appendUpdate must not throw.
      return;
    }

    super.appendUpdate(update);
  }

  override async flush(): Promise<void> {
    this._flushCount++;

    const latency = this.latencies.get('flush') ?? 0;
    if (latency > 0) await delay(latency);

    if (this.failures.get('flush')) {
      throw new Error('TestProvider: simulated flush failure');
    }

    return super.flush();
  }

  override flushSync(): void {
    this._flushSyncCount++;
    // Failure injection is handled by the failFlushSync callback in the
    // constructor — it reads from our failures map.
    super.flushSync();
  }

  override async checkpointFullState(
    doc: ProviderDoc,
    mode: ProviderCheckpointMode = { kind: 'normal' },
  ): Promise<ProviderCheckpointResult> {
    this._checkpointCount++;

    const latency = this.latencies.get('checkpoint') ?? 0;
    if (latency > 0) await delay(latency);

    if (this.failures.get('checkpoint')) {
      throw new Error('TestProvider: simulated checkpoint failure');
    }

    return super.checkpointFullState(doc, mode);
  }

  override async detach(): Promise<void> {
    this._detachCount++;

    const latency = this.latencies.get('detach') ?? 0;
    if (latency > 0) await delay(latency);

    if (this.failures.get('detach')) {
      throw new Error('TestProvider: simulated detach failure');
    }

    return super.detach();
  }

  // ---------------------------------------------------------------------------
  // Test control methods
  // ---------------------------------------------------------------------------

  /**
   * Toggle failure injection for a specific operation.
   */
  setFailure(operation: TestProviderFailureOperation, shouldFail: boolean): void {
    this.failures.set(operation, shouldFail);
  }

  /**
   * Set simulated latency for an async operation.
   */
  setLatency(operation: TestProviderLatencyOperation, ms: number): void {
    this.latencies.set(operation, ms);
  }

  /**
   * Clear all failure and latency injections.
   */
  clearInjections(): void {
    this.failures.clear();
    this.latencies.clear();
  }

  // ---------------------------------------------------------------------------
  // Test inspection methods
  // ---------------------------------------------------------------------------

  getAttachCount(): number {
    return this._attachCount;
  }

  getAppendCount(): number {
    return this._appendCount;
  }

  getFlushCount(): number {
    return this._flushCount;
  }

  getFlushSyncCount(): number {
    return this._flushSyncCount;
  }

  getCheckpointCount(): number {
    return this._checkpointCount;
  }

  getDetachCount(): number {
    return this._detachCount;
  }

  /**
   * Get all updates that were passed to appendUpdate, in order,
   * regardless of whether they were dropped by failure injection.
   */
  getRecordedUpdates(): Uint8Array[] {
    return [...this._recordedUpdates];
  }

  /**
   * Reset all operation counters and recorded updates.
   */
  resetCounters(): void {
    this._attachCount = 0;
    this._appendCount = 0;
    this._flushCount = 0;
    this._flushSyncCount = 0;
    this._checkpointCount = 0;
    this._detachCount = 0;
    this._recordedUpdates = [];
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory function for TestProvider instances. The factory
 * returns a new TestProvider bound to the given docId and shared storage.
 */
export function createTestProviderFactory(
  options: TestProviderOptions = {},
): (docId: string) => TestProvider {
  const storage: MemoryProviderStorage = options.storage ?? new Map();
  return (docId: string) => new TestProvider(docId, { ...options, storage });
}

/**
 * Registry-compatible factory for TestProvider.
 */
export function createTestRegistryFactory(): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'test') {
      throw new Error(`TestProviderFactory: expected kind "test", got "${config.kind}"`);
    }
    const provider = new TestProvider(config.providerRefId, {
      simulateFailures: config.simulateFailures,
      simulatedLatencyMs: config.simulatedLatencyMs,
    });
    return {
      config,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}
