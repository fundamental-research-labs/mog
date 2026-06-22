/**
 * sync-mutation-result.test.ts
 *
 * Remote sync mutation-result coverage.
 *
 * These tests verify that `ComputeCore.syncApply()` returns a MutationResult
 * with properly populated domain-change fields (sheetChanges, structureChanges,
 * mergeChanges, etc.) when a remote peer's Yrs update is applied.
 *
 * EXPECTED TO FAIL until the Rust layer fix lands:
 * `rebuild_from_yrs_after_sync` currently returns `MutationResult::empty()`
 * with only `recalc` populated. All other fields are empty, so the TS layer
 * never fires domain events for remote peer changes.
 *
 * The tests use two HeadlessEngine instances with real NAPI transport.
 * Both engines fork from the same authoritative Yrs full-state bytes before
 * Engine A performs a mutation, then we sync the Yrs diff to Engine B
 * and assert the MutationResult returned by syncApply on B.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { classifyLegacyRawUpdate } from '@mog-sdk/types-document/storage';
import type { SyncApplyMutationMetadataWire } from '../compute-types.gen';
import {
  createAdmittedSyncApplyContext,
  toSyncApplyOperationContextWire,
  type AdmittedSyncApplyContext,
} from '../sync-apply-admission';

// ---------------------------------------------------------------------------
// NAPI addon + SDK loading (same pattern as collab-e2e.test.ts)
// ---------------------------------------------------------------------------

const napiPkgPath = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'compute',
  'napi',
);
const esmRequire = createRequire(join(napiPkgPath, 'package.json'));
let addon: any;
try {
  addon = esmRequire(napiPkgPath);
} catch {
  // addon not built
}

const sdkPath = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'runtime',
  'sdk',
  'src',
  'boot.ts',
);

let createHeadlessEngine: any;
let createHeadlessEngineFromYrsState: any;
let _getComputeBridge: any;
try {
  const sdkMod = await import(sdkPath);
  createHeadlessEngine = sdkMod.createHeadlessEngine;
  createHeadlessEngineFromYrsState = sdkMod.createHeadlessEngineFromYrsState;
  _getComputeBridge =
    sdkMod._getComputeBridge ?? ((engine: any) => engine?.lifecycle?.computeBridge);
} catch {
  // SDK not loadable
}

const hasBasicSupport =
  addon &&
  createHeadlessEngine &&
  createHeadlessEngineFromYrsState &&
  _getComputeBridge &&
  typeof addon.yrs_state_to_snapshot_json === 'function';

// Probe whether we can actually create an engine (NAPI transport may not
// resolve correctly in all Jest environments due to conditional exports).
let canCreateEngine = false;
if (hasBasicSupport) {
  try {
    const probe = await createHeadlessEngine({ computeAddon: addon });
    _getComputeBridge(probe);
    try {
      probe.dispose();
    } catch {
      /* */
    }
    canCreateEngine = true;
  } catch {
    // Engine creation failed (e.g. WASM fetch in Node) — skip suite
  }
}

const describeWithEngine = canCreateEngine ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EngineFixture {
  engine: any;
  bridge: any;
}

interface SyncAtoBApplyResult {
  mutationResult: any;
  syncApplyContext: AdmittedSyncApplyContext;
  metadata?: SyncApplyMutationMetadataWire;
}

async function makeEngine(): Promise<EngineFixture> {
  const engine = await createHeadlessEngine({ computeAddon: addon });
  const bridge = _getComputeBridge(engine);
  return { engine, bridge };
}

async function makeEngineFromYrsState(yrsState: Uint8Array): Promise<EngineFixture> {
  const engine = await createHeadlessEngineFromYrsState(addon, yrsState);
  const bridge = _getComputeBridge(engine);
  return { engine, bridge };
}

async function makeForkedEngines(
  setup?: (seed: EngineFixture) => Promise<void>,
): Promise<[EngineFixture, EngineFixture, EngineFixture]> {
  const seed = await makeEngine();
  if (setup) {
    await setup(seed);
  }
  const state = await seed.bridge.core.syncFullState();
  const a = await makeEngineFromYrsState(new Uint8Array(state));
  const b = await makeEngineFromYrsState(new Uint8Array(state));
  return [seed, a, b];
}

/**
 * Sync A's changes to B and return the MutationResult from B's syncApply.
 */
async function syncAtoB(a: EngineFixture, b: EngineFixture): Promise<any> {
  const result = await syncAtoBWithResult(a, b);
  return result.mutationResult;
}

/**
 * Sync A's changes to B and return the full sync-apply bridge result.
 */
async function syncAtoBWithResult(
  a: EngineFixture,
  b: EngineFixture,
): Promise<SyncAtoBApplyResult> {
  const coreA = a.bridge.core;
  const coreB = b.bridge.core;

  const svB = await coreB.syncStateVector();
  const diff = await coreA.syncDiff(svB);
  expect(diff.byteLength).toBeGreaterThan(0);
  const payloadHash = createHash('sha256').update(diff).digest('hex');
  const provenance = classifyLegacyRawUpdate({ payloadHash, updateId: `test-sync:${payloadHash}` });
  const syncApplyContext = createAdmittedSyncApplyContext({
    source: 'test-sync-mutation-result',
    docId: b.docId,
    envelopeVersion: 'classified-raw',
    updateId: provenance.updateIdentity.updateId,
    payloadHash,
    provenance,
  });
  if (typeof coreB.syncApplyWithMetadata === 'function') {
    const result = await coreB.syncApplyWithMetadata(diff, syncApplyContext);
    return {
      mutationResult: result.mutationResult,
      syncApplyContext,
      metadata: result.metadata,
    };
  }
  return {
    mutationResult: await coreB.syncApply(diff, syncApplyContext),
    syncApplyContext,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithEngine('syncApply MutationResult field population', () => {
  const fixtures: EngineFixture[] = [];

  afterEach(async () => {
    for (const f of fixtures) {
      try {
        await f.bridge.destroy();
      } catch {
        /* */
      }
      try {
        f.engine.dispose();
      } catch {
        /* */
      }
    }
    fixtures.length = 0;
  });

  it('sheet create: sheetChanges is non-empty when remote peer adds a sheet', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    // Engine A creates a new sheet
    await a.engine.workbook.sheets.add('NewSheet');

    // Sync A → B
    const result = await syncAtoB(a, b);

    // The MutationResult from syncApply should report sheetChanges
    expect(result.sheetChanges).toBeDefined();
    expect(result.sheetChanges!.length).toBeGreaterThan(0);
  }, 30_000);

  it('sheet rename: sheetChanges is non-empty when remote peer renames a sheet', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    // Engine A renames the active sheet
    await a.engine.workbook.sheets.rename(0, 'RenamedSheet');

    // Sync A → B
    const result = await syncAtoB(a, b);

    expect(result.sheetChanges).toBeDefined();
    expect(result.sheetChanges!.length).toBeGreaterThan(0);
  }, 30_000);

  it('merge cells: mergeChanges is non-empty when remote peer merges a range', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    // Engine A merges A1:B2 on the active sheet
    await a.engine.workbook.activeSheet.structure.merge('A1:B2');

    // Sync A → B
    const result = await syncAtoB(a, b);

    expect(result.mergeChanges).toBeDefined();
    expect(result.mergeChanges!.length).toBeGreaterThan(0);
  }, 30_000);

  it('row insert: structureChanges is non-empty when remote peer inserts rows', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    // Engine A inserts 3 rows at index 0
    await a.engine.workbook.activeSheet.structure.insertRows(0, 3);

    // Sync A → B
    const result = await syncAtoB(a, b);

    expect(result.structureChanges).toBeDefined();
    expect(result.structureChanges!.length).toBeGreaterThan(0);
  }, 30_000);

  it('sheet delete: sheetChanges is non-empty when remote peer deletes a sheet', async () => {
    const [seed, a, b] = await makeForkedEngines(async (baseline) => {
      await baseline.engine.workbook.sheets.add('ToDelete');
    });
    fixtures.push(seed, a, b);

    // Engine A deletes the extra sheet
    await a.engine.workbook.sheets.remove('ToDelete');

    // Sync A → B
    const result = await syncAtoB(a, b);

    expect(result.sheetChanges).toBeDefined();
    expect(result.sheetChanges!.length).toBeGreaterThan(0);
  }, 30_000);

  it('forked engines share default sheet history before cell sync', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    await a.engine.workbook.activeSheet.setCell('A1', 42);
    await syncAtoB(a, b);

    const sheetId = b.engine.activeSheetId;
    const cellData = await b.bridge.getCellData(sheetId as any, 0, 0);
    expect((cellData as any)?.raw?.value ?? (cellData as any)?.raw).toBe(42);
  }, 30_000);

  it('syncApplyWithMetadata returns the Rust provenance report for a remote update', async () => {
    const [seed, a, b] = await makeForkedEngines();
    fixtures.push(seed, a, b);

    await a.engine.workbook.activeSheet.setCell('A1', 99);
    const result = await syncAtoBWithResult(a, b);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.mutationResult).toEqual(result.mutationResult);
    expect(result.metadata!.provenanceReport).toEqual({
      appliedContext: toSyncApplyOperationContextWire(result.syncApplyContext),
      pendingSegmentStatus: 'notEvaluated',
      pendingSegmentIds: [],
      batchDurabilityStatus: 'notEvaluated',
    });
  }, 30_000);
});
