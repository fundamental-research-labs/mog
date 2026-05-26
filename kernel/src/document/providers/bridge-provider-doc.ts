/**
 * Bridge-backed `ProviderDoc` production-path adapter.
 *
 * The Provider interface (`./provider.ts`) talks to a doc-side handle via
 * `applyUpdate`, `encodeDiff`, `currentStateVector`. In production those
 * three operations are forwarded to a yrs `Doc` living inside the compute
 * engine (Rust); the orchestrator has a `ComputeBridge` already wired,
 * so the production `ProviderDoc` is a thin shim that calls the bridge.
 *
 * This module exists so:
 *   1. The orchestrator (`rust-document.ts`) can hand a real `ProviderDoc`
 *      to a Provider's `attach()` without a circular dependency between
 *      `Provider` and the bridge-housing layer.
 *   2. The IndexedDBProvider's compaction path (`setProviderDocFactory`,
 *      see `indexeddb-provider.ts`) can build transient ProviderDocs from
 *      the same bridge — no MockProviderDoc in production code paths.
 *
 * The conformance suite still uses `MockProviderDoc` (no bridge required),
 * but every shipping attach flows through this adapter so the test/prod
 * paths are identical in shape.
 *
 * @see ./provider.ts — the `ProviderDoc` interface contract
 */

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import type { ProviderDoc } from './provider';

/**
 * Build a `ProviderDoc` backed by `bridge`. The returned object is stable
 * (same reference returned on subsequent reads of any property) and stateless
 * — all state lives inside the bridge / compute engine.
 *
 * `applyUpdate(bytes)` calls `bridge.syncApply(bytes)` (which the engine
 * routes through `compute_apply_sync_update`); the returned `MutationResult`
 * is discarded — Providers only care that the bytes were accepted, not the
 * recalc result.
 *
 * `currentStateVector()` calls `bridge.currentStateVector()`.
 *
 * `encodeDiff(remoteSv)` calls `bridge.encodeDiff(remoteSv)`.
 *
 * @param bridge The ComputeBridge instance the orchestrator already holds.
 * @param docId  Document identifier — kept for diagnostics; the bridge
 *               itself owns docId routing internally, so the shim does
 *               not have to thread the docId through every call.
 */
export function createBridgeBackedProviderDoc(bridge: ComputeBridge, docId: string): ProviderDoc {
  return {
    docId,
    async applyUpdate(update: Uint8Array): Promise<void> {
      // `syncApply` is a mutation route — its return is the recalc result,
      // which Providers don't observe. We `await` so failures surface to the
      // caller (Provider attach replay would otherwise swallow apply errors).
      await bridge.syncApply(update);
    },
    encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
      return bridge.encodeDiff(remoteSv);
    },
    currentStateVector(): Promise<Uint8Array> {
      return bridge.currentStateVector();
    },
  };
}
