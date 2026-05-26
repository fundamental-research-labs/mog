import type { EventStore } from './event-store';
import type { ActorRecorder } from './recorders/actor-recorder';
import type { OSDevToolsHook } from './types';

const MUTATING_BRIDGE_METHOD =
  /^(setCells|insertRow|deleteRow|insertCol|deleteCol|paste|moveRange|clearRange|fillRange|sort|autoFill|setRange|structureChange)/;

type MutationRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutationRecord {
  return typeof value === 'object' && value !== null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isMutationResult(value: unknown): value is MutationRecord {
  if (!isRecord(value)) return false;
  if (isRecord(value.recalc)) return true;
  return [
    'propertyChanges',
    'dimensionChanges',
    'mergeChanges',
    'visibilityChanges',
    'commentChanges',
    'filterChanges',
    'tableChanges',
    'sheetChanges',
    'settingsChanges',
    'structureChanges',
    'rangeChanges',
    'workbookSettingsChanges',
  ].some((key) => Array.isArray(value[key]));
}

function extractMutationResult(result: unknown): {
  viewportPatchBytes: number;
  result: MutationRecord;
} | null {
  if (Array.isArray(result) && result[0] instanceof Uint8Array && isMutationResult(result[1])) {
    return { viewportPatchBytes: result[0].byteLength, result: result[1] };
  }

  if (isMutationResult(result)) {
    return { viewportPatchBytes: 0, result };
  }

  return null;
}

function mutationCellCounts(result: MutationRecord): {
  changedCellCount: number;
  recalcedCellCount: number;
} {
  const recalc = isRecord(result.recalc) ? result.recalc : undefined;
  return {
    changedCellCount: arrayLength(result.changedCells),
    recalcedCellCount: arrayLength(result.recalcedCells) || arrayLength(recalc?.changedCells),
  };
}

export function setupGlobalHook(store: EventStore, actorRecorder: ActorRecorder): OSDevToolsHook {
  // Correlation ID for causal event linking
  let _nextCorrelationId = 1;
  let _activeCorrelationId: number | undefined;
  let _correlationResetTimer: ReturnType<typeof setTimeout> | undefined;

  // Flow schema v2 (O-1): `tSinceStepStart` reads the per-step anchor that
  // `EventStore.clear()` resets on every `__dt.clear()` call.
  function tSinceStepStart(): number {
    if (typeof performance === 'undefined') return 0;
    return Math.max(0, performance.now() - store.stepStartT);
  }

  function startCorrelation(): number {
    const id = _nextCorrelationId++;
    _activeCorrelationId = id;
    // Auto-expire after 200ms (covers async bridge call + viewport update + canvas frame)
    if (_correlationResetTimer !== undefined) clearTimeout(_correlationResetTimer);
    _correlationResetTimer = setTimeout(() => {
      _activeCorrelationId = undefined;
      _correlationResetTimer = undefined;
    }, 200);
    return id;
  }

  const hook: OSDevToolsHook = {
    reportActor(actorId: string, inspectionEvent: unknown) {
      actorRecorder.record(actorId, inspectionEvent);
    },
    reportRender(appId, componentId, phase, actualDurationMs, baseDurationMs) {
      store.push({
        type: 'render',
        timestamp: Date.now(),
        appId,
        componentId,
        phase: phase as 'mount' | 'update' | 'nested-update',
        actualDurationMs,
        baseDurationMs,
        // Flow schema v2: render events come from React internals.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    reportEvent(event) {
      store.push({
        type: 'eventbus',
        timestamp: Date.now(),
        eventType: event.type,
        eventData: event,
        correlationId: _activeCorrelationId,
        // Flow schema v2: EventBus is internal app plumbing.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    reportCanvasFrame(layerTimings, bufferGeneration?) {
      const totalMs = Object.values(layerTimings).reduce((sum, t) => sum + t.lastMs, 0);
      const event: import('./types').CanvasFrameEvent = {
        type: 'canvas',
        timestamp: Date.now(),
        layerTimings,
        totalMs,
        correlationId: _activeCorrelationId,
        // Flow schema v2: canvas-frame events come from the rAF loop.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      };
      if (bufferGeneration !== undefined) {
        event.bufferGeneration = bufferGeneration;
      }
      store.push(event);
    },
    reportBridgeCall(bridge, method, args, durationMs, result, error) {
      const event: import('./types').BridgeCallEvent = {
        type: 'bridge',
        timestamp: Date.now(),
        bridgeName: bridge,
        method,
        durationMs,
        args,
        error,
        // Flow schema v2: bridge calls are app→kernel reads/writes. We tag
        // `source: 'internal'` here; O-B will refine `kind` to 'bridge.read'/
        // 'bridge.write'/'bridge.lifecycle' using the manifest from O-0.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      };

      const mutationResult =
        !error && MUTATING_BRIDGE_METHOD.test(method) ? extractMutationResult(result) : null;
      if (mutationResult) {
        const counts = mutationCellCounts(mutationResult.result);
        event.mutationMeta = {
          viewportPatchBytes: mutationResult.viewportPatchBytes,
          changedCellCount: counts.changedCellCount,
          recalcedCellCount: counts.recalcedCellCount,
        };
        event.correlationId = startCorrelation();
      }

      // Tag with active correlation (for non-mutation calls that happen within a correlation window)
      if (!event.correlationId && _activeCorrelationId !== undefined) {
        event.correlationId = _activeCorrelationId;
      }

      store.push(event);
    },
    reportViewportBuffer(event) {
      store.push({
        type: 'viewport-buffer',
        timestamp: Date.now(),
        ...event,
        correlationId: _activeCorrelationId,
        // Flow schema v2: viewport-buffer applies are internal kernel→ui sync.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    reportAction(action, durationMs, result, payload) {
      const corrId = startCorrelation();
      store.push({
        type: 'action',
        timestamp: Date.now(),
        action,
        durationMs,
        handled: result.handled,
        error: result.error,
        receiptCount: result.receipts?.length ?? 0,
        receiptDomains: result.receipts?.map((r: any) => r.domain).filter(Boolean),
        payload,
        correlationId: corrId,
        // Flow schema v2: today every dispatched action originates from a
        // keyboard/pointer event. O-D overrides this for harness-helper-
        // driven dispatches by emitting a synthetic `source: 'harness'` action
        // record from `withHarnessAction` (see `reportHarnessAction` below).
        source: 'keyboard',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    reportHarnessAction(entry) {
      // Synthetic flow-action emitted by `withHarnessAction` (O-D). Tagged
      // `source: 'harness'` and `kind: 'harness.helper'` so downstream
      // consumers can tell helper-driven dispatches from keyboard-driven
      // ones. We piggyback on any active correlation window so harness
      // actions show up in the same flow as the bridge calls / viewport
      // patches they triggered; if no correlation is active we open one
      // (so the action still surfaces in `getLastFlow()`).
      const corrId = _activeCorrelationId ?? startCorrelation();
      store.push({
        type: 'action',
        timestamp: Date.now(),
        action: entry.name,
        durationMs: entry.durationMs ?? 0,
        handled: entry.handled,
        error: entry.error,
        receiptCount: 0,
        payload: undefined,
        correlationId: corrId,
        source: 'harness',
        // `kind` lives on flow sub-array entries, not store events, so the
        // harness-helper classifier is applied in `buildFlow` based on
        // `source === 'harness'`.
        tSinceStepStart: entry.tSinceStepStart,
      });
    },
    reportReceipt(receipts) {
      store.push({
        type: 'receipt',
        timestamp: Date.now(),
        receipts: receipts.map((r) => ({
          domain: r.domain,
          action: r.action,
          id: r.id,
          hasBounds: r.bounds != null,
          hasObject: r.object != null,
        })),
        patchCount: receipts.length,
        correlationId: _activeCorrelationId,
        // Flow schema v2: receipts are emitted by the action-pipeline runtime.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    reportSceneGraphPatch(patches) {
      store.push({
        type: 'scenegraph',
        timestamp: Date.now(),
        patches: patches.map((p) => ({
          objectId: p.objectId,
          kind: p.kind,
          objectType: (p.data as any)?.type,
          hasBounds: p.bounds != null,
          hasData: p.data != null,
          skipped: p.skipped,
          skipReason: p.skipReason,
        })),
        correlationId: _activeCorrelationId,
        // Flow schema v2: scenegraph patches are an internal canvas mechanism.
        source: 'internal',
        tSinceStepStart: tSinceStepStart(),
      });
    },
    getCorrelationId() {
      return _activeCorrelationId;
    },
    getStepStartT() {
      return store.stepStartT;
    },
  };

  window.__OS_DEVTOOLS__ = hook;
  return hook;
}
