import type { EventStore } from '../event-store';
import type { ActorRecorder } from '../recorders/actor-recorder';
import { DebugRecorder } from '../recorders/debug-recorder';
import type { BugReport, DebugRecordingBundle } from '../recorders/debug-recorder-types';
import type {
  ActorEvent,
  ActionDispatchEvent,
  BridgeCallEvent,
  DevToolsConsoleAPI,
  DevToolsStatus,
  InvariantsRunOutput,
  ProgrammaticError,
  ProgrammaticFlow,
  ReceiptEvent,
  ViewportBufferEvent,
} from '../types';
import { runInstalledInvariants } from '../invariants-slot';
import {
  printBufferEvents,
  printCellHistory,
  printEntries,
  printFlow,
  printMachine,
  printMachines,
  printMutations,
  printSlow,
  printTransitions,
} from './printer';
import {
  getActiveComputeBridge,
  printViewportCell,
  printViewportDetail,
  printViewportSummary,
  readCellFormat,
  readCellValue,
  readCellsViaBridge,
  readDataBarRatio,
  readDisplayedFormatsViaBridge,
  readIconBucket,
  readResolvedNumberFormats,
} from './viewport-inspector';

export function createConsoleAPI(
  store: EventStore,
  actorRecorder: ActorRecorder,
): DevToolsConsoleAPI {
  // Error capture ring buffer (max 100 entries)
  const errorBuffer: ProgrammaticError[] = [];
  const MAX_ERROR_BUFFER = 100;

  function pushError(source: string, error: string, stack?: string) {
    errorBuffer.push({ timestamp: Date.now(), source, error, stack });
    if (errorBuffer.length > MAX_ERROR_BUFFER) errorBuffer.shift();
  }

  /**
   * Coerce an arbitrary error value (caught from `try/catch` or rejection)
   * into a `(message, stack)` pair for the ring buffer. Mirrors the legacy
   * `unhandledrejection` handler so all four ingestion paths
   * (`unhandledrejection`, `window.error`, `__dt.captureError`,
   * `console.error`) produce uniformly-shaped entries.
   */
  function formatErrorMessageWithCauses(err: Error): string {
    const parts: string[] = [];
    let current: unknown = err;
    while (current instanceof Error) {
      const name = current.name || current.constructor?.name || 'Error';
      parts.push(`${name}: ${current.message}`);
      current = (current as Error & { cause?: unknown }).cause;
      if (parts.length >= 8) break;
    }
    return parts.length > 1 ? parts.join(' <- caused by ') : err.message;
  }

  function coerceError(err: unknown): { message: string; stack?: string } {
    if (err instanceof Error) {
      return { message: formatErrorMessageWithCauses(err), stack: err.stack };
    }
    if (typeof err === 'string') return { message: err };
    try {
      return { message: JSON.stringify(err) };
    } catch {
      return { message: String(err) };
    }
  }

  // Capture unhandled promise rejections, sync uncaught errors, and (when
  // enabled) console.error. All four sources flow into the same ring buffer
  // tagged by `source` per Round 6 / O-A.
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      const { message, stack } = coerceError(event.reason);
      pushError('unhandledrejection', message, stack);
    });

    // Synchronous uncaught errors (`throw` outside a Promise chain).
    // ErrorEvent.error is the actual Error; ErrorEvent.message is the
    // serialized message (used as fallback for cross-origin errors that
    // suppress the .error field).
    window.addEventListener('error', (event: ErrorEvent) => {
      const err = event.error;
      if (err) {
        const { message, stack } = coerceError(err);
        pushError('window.error', message, stack);
      } else {
        // Cross-origin or sourceless ErrorEvent — fall back to the message
        // string. Best-effort; some browsers replace it with "Script error."
        pushError(
          'window.error',
          event.message || 'window.error (no message)',
          event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
        );
      }
    });
  }

  // ── console.error interception (off in production, on under app-eval) ──
  //
  // Off by default — production builds shouldn't pay the wrapping cost.
  // The app-eval harness enables this via `__dt.setCaptureConsoleErrors(true)`
  // once per page init so every `console.error(...)` call also lands in the
  // ring buffer.
  let originalConsoleError: typeof console.error | null = null;
  let consoleErrorCaptureEnabled = false;

  function setCaptureConsoleErrors(enabled: boolean): boolean {
    const prev = consoleErrorCaptureEnabled;
    if (enabled === prev) return prev;
    if (typeof console === 'undefined') return prev;

    if (enabled) {
      // Stash the unwrapped console.error and replace with a wrapper.
      originalConsoleError = console.error.bind(console);
      console.error = ((...args: unknown[]) => {
        try {
          // Format the error similar to how console.error renders it.
          // If the first argument is an Error, prefer its message + stack.
          const first = args[0];
          if (first instanceof Error) {
            const { message, stack } = coerceError(first);
            pushError('console.error', message, stack);
          } else {
            const message = args
              .map((a) => {
                if (typeof a === 'string') return a;
                if (a instanceof Error) return coerceError(a).message;
                try {
                  return JSON.stringify(a);
                } catch {
                  return String(a);
                }
              })
              .join(' ');
            pushError('console.error', message);
          }
        } catch {
          // Never let the buffer push break console.error itself.
        }
        // Always still pass through to the real console.error so devs see
        // the message in the actual browser console.
        originalConsoleError?.(...args);
      }) as typeof console.error;
      consoleErrorCaptureEnabled = true;
    } else {
      // Restore. We re-assign exactly the previously-captured original;
      // calling setCaptureConsoleErrors(true) → setCaptureConsoleErrors(false)
      // round-trips cleanly.
      if (originalConsoleError) {
        console.error = originalConsoleError;
        originalConsoleError = null;
      }
      consoleErrorCaptureEnabled = false;
    }
    return prev;
  }

  // ── pointer-event ring buffer + step-start timestamp ──
  // The Playwright `addInitScript` from app-eval seeds these slots before
  // any frame script runs. If devtools loads first (or in a non-app-eval
  // session), we create them here. The factory copies any pre-existing
  // ring buffer's items so init-script-pushed events aren't lost.
  type PointerEventRecord = {
    source: 'pointer';
    kind: 'pointer.click' | 'pointer.drag' | 'context-menu.open';
    tSinceStepStart: number;
    correlationId?: number;
    [extra: string]: unknown;
  };
  type PointerRingBuffer = {
    items: PointerEventRecord[];
    push(e: PointerEventRecord): void;
    drainBefore(t: number): PointerEventRecord[];
    clear(): void;
  };

  const POINTER_RING_MAX = 256;
  const winRoot = (typeof window !== 'undefined' ? window : undefined) as
    | (Window & { __dt?: { _pointerEvents?: { items?: unknown[] }; _stepStartedAt?: number } })
    | undefined;
  const preExistingPointerItems: PointerEventRecord[] = (() => {
    const existing = winRoot?.__dt?._pointerEvents;
    return Array.isArray(existing?.items) ? (existing!.items as PointerEventRecord[]).slice() : [];
  })();
  const pointerItems: PointerEventRecord[] = preExistingPointerItems;
  const pointerEvents: PointerRingBuffer = {
    items: pointerItems,
    push(e) {
      pointerItems.push(e);
      if (pointerItems.length > POINTER_RING_MAX) pointerItems.shift();
    },
    drainBefore(t: number) {
      const out: PointerEventRecord[] = [];
      let i = 0;
      while (i < pointerItems.length && pointerItems[i].tSinceStepStart < t) {
        out.push(pointerItems[i]);
        i++;
      }
      pointerItems.splice(0, out.length);
      return out;
    },
    clear() {
      pointerItems.length = 0;
    },
  };

  // Step-start anchor: `clearEventBuffer` in app-eval sets this to
  // `performance.now()` after `dt.clear()` so per-event tSinceStepStart is
  // computable in the browser at event-dispatch time.
  let stepStartedAt = (() => {
    const v = winRoot?.__dt?._stepStartedAt;
    return typeof v === 'number' ? v : 0;
  })();

  // ── Internal helpers for mutation APIs ──

  /**
   * app-eval / app-eval rendered-state readback helpers — collapse a scene-graph object's
   * type to the user-visible drawing kind that scenarios reason about.
   * The scene types (`picture`, `oleObject`, `connector`, `ink`, etc.) are
   * an implementation detail; the corpus speaks in terms of `image`,
   * `chart`, `shape`, `formControl`, `smartArt`, `wordArt`.
   */
  function mapSceneTypeToDrawingKind(
    sceneType: string,
    obj: { data?: { textEffect?: unknown; wordArt?: unknown } & Record<string, unknown> },
  ): import('../types').DrawingKind {
    switch (sceneType) {
      case 'picture':
        return 'image';
      case 'chart':
        return 'chart';
      case 'diagram':
        return 'diagram';
      case 'smartart':
        return 'smartArt';
      case 'textbox': {
        // Text effects are textbox subtypes distinguished by scene data.
        // The legacy alias is accepted at this external compatibility boundary only.
        const data = (obj as { data?: { textEffect?: unknown; wordArt?: unknown } }).data;
        return data?.textEffect || data?.wordArt ? 'wordArt' : 'shape';
      }
      // Form controls aren't a separate scene type today — they're stored
      // as 'shape' with a formControl marker on their data. Default
      // `shape` here; expand the discriminator when the renderer surfaces
      // form controls as a first-class scene type.
      case 'shape':
      case 'connector':
      case 'ink':
      case 'equation':
      case 'oleObject':
      default:
        return 'shape';
    }
  }

  /** Snap a document-pixel point to the nearest cell using whatever the
   *  worksheet exposes. Returns null when no resolver is available. */
  function safeCellSnap(ws: any, docX: number, docY: number): { row: number; col: number } | null {
    try {
      // Several worksheet implementations expose `documentPixelToCell`;
      // fall through to coordinate-system primitives otherwise.
      if (typeof ws?.layout?.documentPixelToCell === 'function') {
        const r = ws.layout.documentPixelToCell(docX, docY);
        if (r && typeof r.row === 'number' && typeof r.col === 'number') {
          return { row: r.row, col: r.col };
        }
      }
      const coordinator = (window as any).__COORDINATOR__;
      const coords = coordinator?.renderer?.getCoordinateSystem?.();
      if (typeof coords?.documentPixelToCell === 'function') {
        const r = coords.documentPixelToCell(docX, docY);
        if (r && typeof r.row === 'number' && typeof r.col === 'number') {
          return { row: r.row, col: r.col };
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  /** Pull a "src"-like field from an arbitrary scene object's data. */
  function extractSrc(obj: { type: string; data?: Record<string, unknown> }): string | null {
    const d = obj.data;
    if (!d) return null;
    if (typeof d.src === 'string') return d.src;
    if (typeof (d as { chartId?: unknown }).chartId === 'string')
      return (d as { chartId: string }).chartId;
    return null;
  }

  type ElementRectLike = {
    x?: number;
    y?: number;
    left?: number;
    top?: number;
    width: number;
    height: number;
  };

  type FormControlElementLike = {
    getAttribute?: (name: string) => string | null;
    getBoundingClientRect?: () => ElementRectLike;
    ownerDocument?: {
      defaultView?: {
        getComputedStyle?: (element: unknown) => {
          display?: string;
          visibility?: string;
          opacity?: string;
        };
      };
    };
    style?: { left?: string; top?: string };
  };

  function readCssPx(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isRenderedFormControlElement(element: FormControlElementLike): boolean {
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    const style =
      element.ownerDocument?.defaultView?.getComputedStyle?.(element) ??
      (typeof getComputedStyle !== 'undefined' ? getComputedStyle(element as Element) : null);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') {
      return false;
    }

    return true;
  }

  function getRenderedDomFormControls(
    ws: any,
    existingIds: Set<string>,
  ): import('../types').DrawingDescriptor[] {
    const doc =
      typeof document !== 'undefined'
        ? document
        : ((typeof window !== 'undefined' ? (window as any).document : undefined) as
            | Document
            | undefined);
    if (!doc?.querySelectorAll) return [];

    const out: import('../types').DrawingDescriptor[] = [];
    const elements = Array.from(
      doc.querySelectorAll('[data-form-control-id]'),
    ) as FormControlElementLike[];

    for (const element of elements) {
      if (!isRenderedFormControlElement(element)) continue;

      const id = element.getAttribute?.('data-form-control-id');
      if (!id || existingIds.has(id)) continue;

      const rect = element.getBoundingClientRect!();
      const x = readCssPx(element.style?.left) ?? rect.x ?? rect.left ?? 0;
      const y = readCssPx(element.style?.top) ?? rect.y ?? rect.top ?? 0;
      const fromCell = safeCellSnap(ws, x, y);
      const toCell = safeCellSnap(ws, x + rect.width, y + rect.height);

      out.push({
        id,
        kind: 'formControl',
        anchor: {
          from: fromCell ?? { row: 0, col: 0 },
          ...(toCell ? { to: toCell } : {}),
        },
        boundsPx: {
          x,
          y,
          w: rect.width,
          h: rect.height,
        },
        visible: true,
      });
    }

    return out;
  }

  /**
   * Get the active Workbook.
   * Primary path: __COORDINATOR__.workbook (sync, always works when a document is open).
   * Fallback: __SHELL__ → store → documentManager → handle.workbook (async).
   */
  function getActiveWorkbook(): any | null {
    try {
      // Primary: sync access via __COORDINATOR__
      const coord = (window as any).__COORDINATOR__;
      if (coord?.workbook) return coord.workbook;

      // Fallback: __SHELL__ path (may be async, but try sync access first)
      const shell = (window as any).__SHELL__;
      if (!shell) return null;

      const state = shell.store?.getState?.();
      if (!state) return null;

      const fileId = state.activeFileId;
      if (!fileId) return null;

      const handle = shell.documentManager?.getDocument?.(fileId);
      if (!handle) return null;

      // handle.workbook may be a getter (sync) or a function (async-cached).
      // Try sync access first.
      const wb = typeof handle.workbook === 'function' ? handle.workbook() : handle.workbook;
      // If it's a Promise, we can't use it synchronously — return null and let caller retry
      if (wb && typeof wb.then === 'function') return null;
      return wb ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Read the current selection ranges.
   * Primary path: __COORDINATOR__.grid selection snapshot (sync, reliable).
   * Fallback: actor recorder machine contexts.
   */
  function getActiveSelection(): {
    ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  } | null {
    try {
      // Primary: sync access via __COORDINATOR__
      const coord = (window as any).__COORDINATOR__;
      const selSnapshot =
        coord?.grid?.access?.accessors?.selection?.getRanges?.() ??
        coord?.grid?.getSelectionSnapshot?.() ??
        coord?.grid?.selection?.getRanges?.();
      if (Array.isArray(selSnapshot) && selSnapshot.length > 0) {
        return { ranges: selSnapshot };
      }

      // Fallback: actor recorder machine contexts
      for (const [, machine] of actorRecorder.machines) {
        const ctx = machine.context as any;
        if (!ctx) continue;

        // Path 1: context.selection.ranges (array of range objects)
        if (ctx.selection?.ranges && Array.isArray(ctx.selection.ranges)) {
          return { ranges: ctx.selection.ranges };
        }

        // Path 2: context.selection.anchor / end (single range from anchor+end)
        if (ctx.selection?.anchor) {
          const a = ctx.selection.anchor;
          const e = ctx.selection.end ?? a;
          return {
            ranges: [
              {
                startRow: Math.min(a.row, e.row),
                startCol: Math.min(a.col, e.col),
                endRow: Math.max(a.row, e.row),
                endCol: Math.max(a.col, e.col),
              },
            ],
          };
        }
      }
    } catch {
      // best-effort
    }
    return null;
  }

  const api: DevToolsConsoleAPI = {
    last(n = 10) {
      const entries = store.last(n);
      printEntries(entries);
      return entries;
    },

    print(n = 10) {
      printEntries(store.last(n));
    },

    machines() {
      printMachines(actorRecorder.machines);
    },

    machine(id: string) {
      // Try exact match first, then partial match
      let machine = actorRecorder.machines.get(id);
      if (!machine) {
        for (const [key, m] of actorRecorder.machines) {
          if (key.includes(id)) {
            machine = m;
            break;
          }
        }
      }
      printMachine(machine, id);
    },

    transitions(filter?: string) {
      const actorEvents = store
        .all()
        .map((e) => e.event)
        .filter((e): e is ActorEvent => e.type === 'actor' && e.kind === 'transition');
      printTransitions(actorEvents, filter);
    },

    events(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'eventbus') return false;
        if (filter) return e.eventType.includes(filter);
        return true;
      });
      printEntries(entries);
    },

    renders(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'render') return false;
        if (filter) return e.appId.includes(filter) || e.componentId.includes(filter);
        return true;
      });
      printEntries(entries);
    },

    slowRenders(ms = 8) {
      const entries = store.filter((e) => e.type === 'render' && e.actualDurationMs >= ms);
      printEntries(entries);
    },

    frames(n = 10) {
      const entries = store.filter((e) => e.type === 'canvas').slice(-n);
      printEntries(entries);
    },

    bridge(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'bridge') return false;
        if (filter) return e.bridgeName.includes(filter) || e.method.includes(filter);
        return true;
      });
      printEntries(entries);
    },

    bufferEvents(filter?: string) {
      printBufferEvents(store.all(), filter);
    },

    viewport(viewportId?: string) {
      if (viewportId) {
        printViewportDetail(viewportId);
      } else {
        printViewportSummary();
      }
    },

    cell(row: number, col: number, viewportId?: string) {
      printViewportCell(row, col, viewportId);
    },

    actions(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'action') return false;
        if (filter) return e.action.includes(filter);
        return true;
      });
      printEntries(entries);
    },

    receipts(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'receipt') return false;
        if (filter)
          return e.receipts.some((r) => r.domain.includes(filter) || r.action.includes(filter));
        return true;
      });
      printEntries(entries);
    },

    patches(filter?: string) {
      const entries = store.filter((e) => {
        if (e.type !== 'scenegraph') return false;
        if (filter)
          return e.patches.some(
            (p) => p.objectId.includes(filter) || (p.objectType?.includes(filter) ?? false),
          );
        return true;
      });
      printEntries(entries);
    },

    pipeline(n = 10) {
      const actionEntries = store.filter((e) => e.type === 'action').slice(-n);
      if (actionEntries.length === 0) {
        console.log('  No action events found');
        return;
      }
      for (const entry of actionEntries) {
        const evt = entry.event as import('../types').ActionDispatchEvent;
        const corrId = evt.correlationId;
        printEntries([entry]);
        if (corrId != null) {
          const correlated = store.filter(
            (e) =>
              e.correlationId === corrId &&
              (e.type === 'receipt' || e.type === 'scenegraph' || e.type === 'bridge'),
          );
          if (correlated.length > 0) {
            printEntries(correlated);
          }
        }
      }
    },

    slow(ms = 16) {
      printSlow(store.all(), ms);
    },

    timeline(ms = 1000) {
      const entries = store.since(ms);
      if (entries.length === 0) {
        console.log(`  No events in the last ${ms}ms`);
        return;
      }

      const baseTime = entries[0].event.timestamp;
      for (const entry of entries) {
        const offset = entry.event.timestamp - baseTime;
        const prefix = `T+${offset}ms`.padEnd(10);
        const evt = entry.event;

        let label = '';
        switch (evt.type) {
          case 'actor':
            label = `XSTATE    ${evt.actorId}: ${evt.fromState} \u2192 ${evt.toState}  (${evt.eventType})`;
            break;
          case 'eventbus':
            label = `EVENTBUS  ${evt.eventType}`;
            break;
          case 'render':
            label = `REACT     ${evt.appId}/${evt.componentId} ${evt.phase} ${evt.actualDurationMs.toFixed(1)}ms`;
            break;
          case 'canvas':
            label = `CANVAS    frame ${evt.totalMs.toFixed(1)}ms`;
            break;
          case 'bridge':
            label = `BRIDGE    ${evt.bridgeName}.${evt.method}() ${evt.durationMs.toFixed(1)}ms`;
            break;
          case 'viewport-buffer':
            label = `VIEWPORT  ${evt.kind}: ${evt.patchCount} cells, gen=${evt.generation} (${evt.viewportId})`;
            break;
          case 'action':
            label = `ACTION    ${evt.action} ${evt.durationMs.toFixed(1)}ms ${evt.handled ? '\u2713' : '\u2717'}${evt.receiptCount > 0 ? ` (${evt.receiptCount} receipts)` : ''}${evt.error ? ' ERROR: ' + evt.error : ''}`;
            break;
          case 'receipt':
            label = `RECEIPT   ${evt.receipts.map((r) => `${r.domain}:${r.action} ${r.id.slice(0, 12)}`).join(', ')}`;
            break;
          case 'scenegraph':
            label = `SCENE     ${evt.patches.map((p) => (p.skipped ? `SKIP(${p.skipReason})` : `${p.kind} ${p.objectType ?? '?'}`)).join(', ')}`;
            break;
        }

        console.log(`  ${prefix} ${label}`);
      }
    },

    between(tsStart: number, tsEnd: number) {
      const entries = store.filter((e) => e.timestamp >= tsStart && e.timestamp <= tsEnd);
      if (entries.length === 0) {
        console.log(
          `  No events between ${new Date(tsStart).toISOString()} and ${new Date(tsEnd).toISOString()}`,
        );
        return;
      }
      printEntries(entries);
    },

    for(actorId: string) {
      // Find all events involving this actor: direct actor events + correlated side effects
      const actorEntries = store.filter((e) => {
        if (e.type === 'actor' && e.actorId.includes(actorId)) return true;
        return false;
      });

      // Collect correlation IDs from actor events
      const corrIds = new Set<number>();
      for (const entry of actorEntries) {
        const corrId = entry.event.correlationId;
        if (corrId !== undefined) corrIds.add(corrId);
      }

      // Find all correlated events (side effects)
      const correlated =
        corrIds.size > 0
          ? store.filter((e) => {
              return e.correlationId !== undefined && corrIds.has(e.correlationId);
            })
          : [];

      // Merge and deduplicate by entry id
      const seen = new Set<number>();
      const merged: import('../types').StoreEntry[] = [];
      for (const entry of [...actorEntries, ...correlated]) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          merged.push(entry);
        }
      }
      merged.sort((a, b) => a.event.timestamp - b.event.timestamp);

      if (merged.length === 0) {
        console.log(`  No events found for actor "${actorId}"`);
        return;
      }

      console.log(
        `  ${merged.length} events for actor "${actorId}" (${corrIds.size} correlated flows):`,
      );
      printEntries(merged);
    },

    mutations() {
      printMutations(store.all());
    },

    cellHistory(row: number, col: number) {
      printCellHistory(store.all(), row, col);
    },

    flow(correlationId: number) {
      const entries = store.filter((e) => e.correlationId === correlationId);
      if (entries.length === 0) {
        console.log(`  No events found for correlation #${correlationId}`);
        return;
      }
      printFlow(entries, correlationId);
    },

    lastFlow() {
      // Find the most recent correlation ID
      const events = store.last(100);
      let latestCorrId: number | undefined;
      for (const entry of events) {
        const corrId = entry.event.correlationId;
        if (corrId !== undefined) {
          latestCorrId = corrId;
          break; // events are newest-first
        }
      }
      if (latestCorrId === undefined) {
        console.log('  No correlated events found');
        return;
      }
      const entries = store.filter((e) => e.correlationId === latestCorrId);
      printFlow(entries, latestCorrId);
    },

    getStatus(): DevToolsStatus {
      const SLOW_THRESHOLD = 16;
      const machines: DevToolsStatus['machines'] = [];
      for (const [id, m] of actorRecorder.machines) {
        machines.push({
          id,
          state: m.currentState,
          eventCount: m.eventCount,
          lastTransitionAt: m.lastTransitionAt,
        });
      }

      let slowCount = 0;
      const entries = store.all();
      for (const entry of entries) {
        const evt = entry.event;
        if (
          (evt.type === 'bridge' && evt.durationMs >= SLOW_THRESHOLD) ||
          (evt.type === 'render' && evt.actualDurationMs >= SLOW_THRESHOLD) ||
          (evt.type === 'canvas' && evt.totalMs >= SLOW_THRESHOLD)
        ) {
          slowCount++;
        }
      }

      return {
        recording: store.isEnabled,
        eventCount: store.size,
        machines,
        slowCount,
      };
    },

    toJSON() {
      // Serialize machines without circular references
      const machines: Record<string, unknown> = {};
      for (const [id, m] of actorRecorder.machines) {
        machines[id] = {
          actorId: m.actorId,
          currentState: m.currentState,
          eventCount: m.eventCount,
          lastTransitionAt: m.lastTransitionAt,
          transitions: m.transitions,
        };
      }

      // Snapshot viewport buffer states (zero instrumentation — reads through __SHELL__)
      const viewportBuffers: Record<string, unknown> = {};
      try {
        const bridge = getActiveComputeBridge();
        if (bridge) {
          const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
          if (states) {
            for (const [vpId, vpState] of states) {
              const buf = vpState?.buffer;
              if (buf?.hasBuffer?.()) {
                const startRow = buf.getStartRow?.() ?? 0;
                const startCol = buf.getStartCol?.() ?? 0;
                const rows = buf.getRows?.() ?? 0;
                const cols = buf.getCols?.() ?? 0;

                // Sample cells: 5x5 around active cell, fallback to viewport center
                const sampleCells: Array<{
                  row: number;
                  col: number;
                  displayText: string | null;
                  valueType: number;
                  format: Record<string, unknown> | null;
                }> = [];
                const accessor = bridge.getAccessorForViewport?.(vpId);
                if (accessor) {
                  // Determine sample center: active cell or viewport center
                  let anchorRow = startRow + Math.floor(rows / 2);
                  let anchorCol = startCol + Math.floor(cols / 2);
                  try {
                    const coordinator = (window as any).__COORDINATOR__;
                    const ac = coordinator?.grid?.access?.accessors?.selection?.getActiveCell?.();
                    if (ac && typeof ac.row === 'number') {
                      anchorRow = ac.row;
                      anchorCol = ac.col;
                    }
                  } catch {
                    // best-effort
                  }

                  // 5x5 around anchor
                  for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                      const r = anchorRow + dr;
                      const c = anchorCol + dc;
                      if (r < 0 || c < 0) continue;
                      if (accessor.moveTo?.(r, c)) {
                        sampleCells.push({
                          row: r,
                          col: c,
                          displayText: accessor.displayText ?? null,
                          valueType: accessor.valueType ?? 0,
                          format: readCellFormat(r, c, vpId),
                        });
                      }
                    }
                  }
                }

                viewportBuffers[vpId] = {
                  bounds: { startRow, startCol, rows, cols },
                  cellCount: buf.getCellCount?.() ?? 0,
                  generation: buf.getGeneration?.() ?? 0,
                  sampleCells,
                };
              } else {
                viewportBuffers[vpId] = {
                  bounds: null,
                  cellCount: 0,
                  generation: 0,
                  sampleCells: [],
                };
              }
            }
          }
        }
      } catch {
        // viewport inspection is best-effort — don't fail the trace export
      }

      // Use a safe serializer to handle any remaining circular refs
      const seen = new WeakSet();
      const safeReplacer = (_key: string, value: unknown) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      };

      // Round-trip through safe JSON to strip circulars
      const raw = { events: store.all(), machines, viewportBuffers };
      return JSON.parse(JSON.stringify(raw, safeReplacer));
    },

    subscribe(listener: () => void): () => void {
      return store.subscribe(listener);
    },

    enable() {
      store.enable();
      console.log('  DevTools enabled');
    },

    disable() {
      store.disable();
      console.log('  DevTools disabled');
    },

    /**
     * Dispatch an action through the spreadsheet's unified action
     * system. Routes through the wired `KeyboardCoordinator` so the
     * handler runs with the same `ActionDependencies` real keyboard
     * input would supply — exercising the production code path, not a
     * test-only shortcut.
     *
     * Use this from `page.evaluate()` in app-eval scenarios when no
     * dedicated `__dt.<helper>` exists for the action you need
     * (typically dialog-open / panel-open / one-off operations).
     * Common interactions (selection, merge, freeze, filter, group)
     * have dedicated helpers; prefer those.
     *
     * Returns the handler's `ActionResult`. A typo'd action surfaces
     * as `{handled: false, reason: 'not_found', error: '...'}` from
     * the production dispatcher (no special test-side narrowing).
     * Returns `null` if the coordinator isn't wired yet (page still
     * booting).
     */
    async dispatch(action: string, payload?: unknown): Promise<unknown> {
      const coord = (window as unknown as { __COORDINATOR__?: unknown }).__COORDINATOR__ as
        | {
            input?: {
              keyboardCoordinator?: { dispatchAction?: (a: string, p?: unknown) => unknown };
            };
          }
        | undefined;
      const kbd = coord?.input?.keyboardCoordinator;
      if (!kbd?.dispatchAction) {
        console.warn('[__dt.dispatch] keyboardCoordinator not available');
        return null;
      }
      return await kbd.dispatchAction(action, payload);
    },

    clear() {
      store.clear();
      // Preserve machine currentState/context across step boundaries so
      // assertions can read machine state even when no transition fires in
      // the current step. Per-step transition/event history is reset so the
      // flow capture only sees events from the current step.
      actorRecorder.resetStep();
      errorBuffer.length = 0;
      // pointer ring buffer is part of per-step state and
      // must be wiped alongside the event store. Reset the step-start
      // anchor too — `clearEventBuffer` in app-eval re-sets it to
      // `performance.now()` immediately after this call returns.
      pointerEvents.clear();
      stepStartedAt = 0;
      console.log('  DevTools cleared');
    },

    // ── Programmatic API ──

    getFlow(correlationId: number): ProgrammaticFlow | null {
      const entries = store.filter((e) => e.correlationId === correlationId);
      if (entries.length === 0) return null;
      return buildFlow(correlationId, entries);
    },

    getLastFlow(): ProgrammaticFlow | null {
      const events = store.last(100);
      let latestCorrId: number | undefined;
      for (const entry of events) {
        const corrId = entry.event.correlationId;
        if (corrId !== undefined) {
          latestCorrId = corrId;
          break;
        }
      }
      if (latestCorrId === undefined) return null;
      const entries = store.filter((e) => e.correlationId === latestCorrId);
      return buildFlow(latestCorrId, entries);
    },

    getCellValue(row: number, col: number, viewportId?: string) {
      return readCellValue(row, col, viewportId);
    },

    getCellsViaBridge(cells: ReadonlyArray<{ row: number; col: number }>) {
      return readCellsViaBridge(cells);
    },

    getDisplayedFormatsForCells(cells: ReadonlyArray<{ row: number; col: number }>) {
      return readDisplayedFormatsViaBridge(cells);
    },

    getResolvedNumberFormats(cells: ReadonlyArray<{ row: number; col: number }>) {
      return readResolvedNumberFormats(cells);
    },

    getDataBarRatio(row: number, col: number, viewportId?: string): number | null {
      return readDataBarRatio(row, col, viewportId);
    },

    getIconBucket(row: number, col: number, viewportId?: string): number | null {
      return readIconBucket(row, col, viewportId);
    },

    getIconSetBucket(row: number, col: number, viewportId?: string): number | null {
      return readIconBucket(row, col, viewportId);
    },

    getCellFormat(row: number, col: number, viewportId?: string) {
      const fmt = readCellFormat(row, col, viewportId);
      if (fmt) {
        // Alias fillColor ↔ backgroundColor so callers can use either name
        if ('backgroundColor' in fmt && !('fillColor' in fmt)) {
          fmt.fillColor = fmt.backgroundColor;
        } else if ('fillColor' in fmt && !('backgroundColor' in fmt)) {
          fmt.backgroundColor = fmt.fillColor;
        }
        // Alias horizontalAlign ↔ horizontalAlignment
        if ('horizontalAlign' in fmt && !('horizontalAlignment' in fmt)) {
          fmt.horizontalAlignment = fmt.horizontalAlign;
        }
        // Alias verticalAlign ↔ verticalAlignment
        if ('verticalAlign' in fmt && !('verticalAlignment' in fmt)) {
          fmt.verticalAlignment = fmt.verticalAlign;
        }
      }
      return fmt;
    },

    getMachineStates() {
      const result: Record<string, import('../types').ProgrammaticMachineState> = {};
      for (const [id, m] of actorRecorder.machines) {
        // Serialize context safely — machine contexts may contain non-serializable refs
        let safeContext: unknown = undefined;
        if (m.context !== undefined) {
          try {
            safeContext = JSON.parse(
              JSON.stringify(m.context, (_key, value) => {
                // Skip functions, symbols, and other non-serializable types
                if (typeof value === 'function' || typeof value === 'symbol') return undefined;
                // Skip DOM nodes
                if (value instanceof Node) return '[DOM Node]';
                // Convert Sets to arrays so assertions can use Array.isArray
                if (value instanceof Set) return Array.from(value);
                // Truncate very large arrays
                if (Array.isArray(value) && value.length > 100)
                  return value.slice(0, 100).concat('[...truncated]');
                return value;
              }),
            );
          } catch {
            safeContext = '[non-serializable]';
          }
        }
        result[id] = {
          actorId: m.actorId,
          currentState: m.currentState,
          context: safeContext,
          eventCount: m.eventCount,
          lastTransitionAt: m.lastTransitionAt,
        };
      }
      return result;
    },

    getActionLog(since?: number): ActionDispatchEvent[] {
      return store
        .filter((e) => {
          if (e.type !== 'action') return false;
          if (since !== undefined && e.timestamp < since) return false;
          return true;
        })
        .map((e) => e.event as ActionDispatchEvent);
    },

    getGuardRejections(since?: number): ActorEvent[] {
      return store
        .filter((e) => {
          if (e.type !== 'actor') return false;
          if ((e as ActorEvent).kind !== 'guard.reject') return false;
          if (since !== undefined && e.timestamp < since) return false;
          return true;
        })
        .map((e) => e.event as ActorEvent);
    },

    getRecentErrors(since?: number): ProgrammaticError[] {
      if (since !== undefined) {
        return errorBuffer.filter((e) => e.timestamp >= since);
      }
      return [...errorBuffer];
    },

    clearErrors(): void {
      errorBuffer.length = 0;
    },

    captureError(source: string, error: unknown): void {
      const { message, stack } = coerceError(error);
      pushError(source, message, stack);
    },

    setCaptureConsoleErrors(enabled: boolean): boolean {
      return setCaptureConsoleErrors(enabled);
    },

    // ── Mutation Helpers ──

    async applyCellStyle(name: string): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.applyCellStyle] No active workbook found.');
        return;
      }

      // Convert display name to style ID: lowercase and replace spaces with hyphens
      // so "Heading 1" → "heading-1", "Good" → "good", etc.
      const styleId = name.toLowerCase().replace(/\s+/g, '-');

      // "Normal" clears all formatting — matches Excel behavior (same as CLEAR_FORMATS action)
      if (styleId === 'normal') {
        const selection = getActiveSelection();
        if (!selection) return;
        const ws = wb.activeSheet;
        await ws.formats.clearRanges(selection.ranges);
        return;
      }

      const style = await wb.cellStyles.get(styleId);
      if (!style) {
        console.warn(`[__dt.applyCellStyle] Unknown style: "${name}"`);
        return;
      }

      const selection = getActiveSelection();
      if (!selection) {
        console.warn('[__dt.applyCellStyle] No active selection.');
        return;
      }

      const ws = wb.activeSheet;
      await ws.formats.setRanges(selection.ranges, style as Record<string, unknown>);
    },

    async setCellFormat(row: number, col: number, format: Record<string, unknown>): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.setCellFormat] No active workbook found.');
        return;
      }

      // Alias fillColor ↔ backgroundColor so callers can use either name
      const normalized = { ...format };
      if ('fillColor' in normalized && !('backgroundColor' in normalized)) {
        normalized.backgroundColor = normalized.fillColor;
      } else if ('backgroundColor' in normalized && !('fillColor' in normalized)) {
        normalized.fillColor = normalized.backgroundColor;
      }
      // Alias horizontalAlignment → horizontalAlign (internal key)
      if ('horizontalAlignment' in normalized) {
        normalized['horizontalAlign'] = normalized['horizontalAlignment'];
        delete normalized['horizontalAlignment'];
      }
      // Alias verticalAlignment → verticalAlign (internal key)
      if ('verticalAlignment' in normalized) {
        normalized['verticalAlign'] = normalized['verticalAlignment'];
        delete normalized['verticalAlignment'];
      }
      // Backwards-compat: callers/data may still pass the old raw `center`.
      // The canonical TS/API CellFormat token is now `middle`.
      if (normalized['verticalAlign'] === 'center') {
        normalized['verticalAlign'] = 'middle';
      }
      // Clamp indent to >= 0 (WASM expects u32; Excel clamps negatives to 0)
      if (typeof normalized['indent'] === 'number' && normalized['indent'] < 0) {
        normalized['indent'] = 0;
      }

      const ws = wb.activeSheet;
      const targetRange = [{ startRow: row, startCol: col, endRow: row, endCol: col }];

      // Separate null/undefined properties (explicit clears) from non-null properties (sets).
      // When a property is explicitly null, the caller wants it cleared back to default.
      const nullKeys = Object.keys(normalized).filter(
        (k) => normalized[k] === null || normalized[k] === undefined,
      );
      const nonNullFormat = Object.fromEntries(
        Object.entries(normalized).filter(([, v]) => v !== null && v !== undefined),
      );

      if (nullKeys.length > 0) {
        // Read current format, strip the null'd keys, then clear-all + re-apply survivors.
        // This is the only way to "unset" a specific property since setFormatForRanges
        // ignores null values rather than clearing them.
        try {
          const currentFmt = await ws.formats.get(row, col);
          const survivingFmt: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(currentFmt as Record<string, unknown>)) {
            if (!nullKeys.includes(k) && v !== null && v !== undefined) {
              survivingFmt[k] = v;
            }
          }
          // Merge with non-null values from the caller's format object
          Object.assign(survivingFmt, nonNullFormat);

          await ws.formats.clearRanges(targetRange);
          if (Object.keys(survivingFmt).length > 0) {
            await ws.formats.setRanges(targetRange, survivingFmt as Record<string, unknown>);
          }
        } catch {
          // Fallback: just apply non-null properties (best-effort if get() fails)
          if (Object.keys(nonNullFormat).length > 0) {
            await ws.formats.setRanges(targetRange, nonNullFormat);
          }
        }
      } else {
        await ws.formats.setRanges(targetRange, nonNullFormat);
      }

      // Auto-fit affected row when font-size or wrap-text changes (Excel behavior).
      // These format changes affect the required row height, so we trigger layout
      // immediately so that readRowHeight() returns the updated value.
      const affectsRowHeight = 'fontSize' in nonNullFormat || 'wrapText' in nonNullFormat;
      if (affectsRowHeight) {
        try {
          await ws.layout.autoFitRows([row]);
        } catch {
          // Non-fatal: row height auto-fit is best-effort
        }
      }
    },

    async mergeAcross(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.mergeAcross] No active workbook found.');
        return;
      }

      const selection = getActiveSelection();
      if (!selection || selection.ranges.length === 0) {
        console.warn('[__dt.mergeAcross] No active selection.');
        return;
      }

      const ws = wb.activeSheet;
      const range = selection.ranges[0];
      const { startRow, startCol, endRow, endCol } = range;

      if (startCol >= endCol) return; // nothing to merge across

      for (let r = startRow; r <= endRow; r++) {
        await ws.structure.merge(r, startCol, r, endCol);
      }
    },

    async mergeCells(
      explicitStartRow?: number,
      explicitStartCol?: number,
      explicitEndRow?: number,
      explicitEndCol?: number,
    ): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.mergeCells] No active workbook found.');
        return;
      }

      // Range may be supplied explicitly (harness fixtures merging a known
      // range without setting up selection first) or resolved from the
      // active selection (UI/devtools usage). The four explicit args must
      // all be present together to be honored.
      let startRow: number;
      let startCol: number;
      let endRow: number;
      let endCol: number;
      if (
        typeof explicitStartRow === 'number' &&
        typeof explicitStartCol === 'number' &&
        typeof explicitEndRow === 'number' &&
        typeof explicitEndCol === 'number'
      ) {
        startRow = explicitStartRow;
        startCol = explicitStartCol;
        endRow = explicitEndRow;
        endCol = explicitEndCol;
      } else {
        const selection = getActiveSelection();
        if (!selection || selection.ranges.length === 0) {
          console.warn('[__dt.mergeCells] No active selection.');
          return;
        }
        const range = selection.ranges[0];
        startRow = range.startRow;
        startCol = range.startCol;
        endRow = range.endRow;
        endCol = range.endCol;
      }

      if (startRow === endRow && startCol === endCol) return; // single cell

      // Unmerge any existing merges first, then merge without centering
      const ws = wb.activeSheet;
      await ws.structure.unmerge(startRow, startCol, endRow, endCol);
      await ws.structure.merge(startRow, startCol, endRow, endCol);
    },

    async getMergedRegions(): Promise<
      Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>
    > {
      try {
        const wb = getActiveWorkbook();
        if (wb) {
          const ws = wb.activeSheet;
          // Read from the authoritative compute bridge source, not the stale viewport binary cache.
          // ws.viewport.getMerges() is populated by the render pipeline and is not updated after
          // structure mutations (merge/unmerge use mutatePlain, which doesn't push a viewport buffer).
          const regions = await ws.structure.getMergedRegions();
          if (Array.isArray(regions)) {
            return regions.map((r: any) => ({
              startRow: r.startRow ?? 0,
              startCol: r.startCol ?? 0,
              endRow: r.endRow ?? 0,
              endCol: r.endCol ?? 0,
            }));
          }
        }
      } catch {
        // best-effort
      }

      return [];
    },

    // ── Filter Helpers ──

    async createAutoFilter(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.createAutoFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      const usedRange = await ws.getUsedRange();
      if (!usedRange) {
        console.warn('[__dt.createAutoFilter] Sheet has no used range.');
        return;
      }
      const existing = await ws.filters.getForRange(usedRange);
      console.log(
        '[__dt.createAutoFilter] usedRange=',
        JSON.stringify(usedRange),
        'existing=',
        existing,
      );
      if (existing) {
        console.log('[__dt.createAutoFilter] removing filter id=', existing.id);
        await ws.filters.remove(existing.id);
      } else {
        console.log('[__dt.createAutoFilter] adding filter');
        await ws.filters.add(usedRange);
      }
    },

    async toggleAutoFilter(): Promise<void> {
      return api.createAutoFilter();
    },

    async applyFilter(col: number, values: (string | number)[]): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.applyFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      await ws.filters.setColumnFilter(col, { type: 'value', values: values.map(String) });
    },

    async setFilter(col: number, values: (string | number)[]): Promise<void> {
      return api.applyFilter(col, values);
    },

    async setCustomFilter(
      col: number,
      criteria: { operator: string; value: number | string },
    ): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.setCustomFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      await ws.filters.setColumnFilter(col, {
        type: 'condition',
        conditions: [{ operator: criteria.operator, value: criteria.value }],
      } as any);
    },

    async applyCustomFilter(col: number, operator: string, value: number | string): Promise<void> {
      return api.setCustomFilter(col, { operator, value });
    },

    async applyConditionFilter(
      col: number,
      conditions: { operator: string; value?: number | string; value2?: number | string }[],
      logic: 'and' | 'or' = 'and',
    ): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.applyConditionFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      await ws.filters.setColumnFilter(col, {
        type: 'condition',
        conditions,
        conditionLogic: logic,
      } as any);
    },

    async applyDynamicFilter(col: number, rule: string): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.applyDynamicFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      if (typeof ws.filters?.applyDynamicFilter === 'function') {
        await ws.filters.applyDynamicFilter(col, rule as any);
        return;
      }
      // Fallback: write the criteria directly via setColumnFilter.
      await ws.filters.setColumnFilter(col, {
        type: 'dynamic',
        dynamicFilter: { rule },
      } as any);
    },

    async filterByColor(
      col: number,
      options: { colorType?: 'fill' | 'background' | 'font'; color: string },
    ): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.filterByColor] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      // Contract discriminator is 'fill' | 'font' (Excel/ECMA-376 vocab).
      // Accept legacy 'background' as an alias for 'fill' for backwards compat
      // with any existing harness scripts.
      const colorFilterType: 'fill' | 'font' = options.colorType === 'font' ? 'font' : 'fill';
      await ws.filters.setColumnFilter(col, {
        type: 'color',
        colorFilter: { type: colorFilterType, color: options.color },
      } as any);
    },

    async reapplyFilter(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.reapplyFilter] No active workbook found.');
        return;
      }
      const ws = wb.activeSheet;
      const filters = await ws.filters.list();
      if (filters.length === 0) {
        console.warn('[__dt.reapplyFilter] No auto-filter found.');
        return;
      }
      await ws.filters.apply(filters[0].id);
    },

    async refreshFilter(): Promise<void> {
      return api.reapplyFilter();
    },

    // ── Layout Queries ──

    async getRowHeight(row: number): Promise<number | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      const ws = wb.activeSheet;
      if (!ws?.layout?.getRowHeight) return null;
      try {
        // Rust `get_row_height_query` (`dimensions::get_row_height`) consults
        // both explicit hide (`KEY_HIDDEN_ROWS`) and outline collapse state, so
        // 0 is returned for rows in a collapsed group without a TS shim.
        return await ws.layout.getRowHeight(row);
      } catch {
        return null;
      }
    },

    // ── Invariants (Round 7 I-0) ──

    invariants(): InvariantsRunOutput {
      // Delegates to the runner installed by
      // `dev/app-eval/capture/invariants/registry.ts`. Until the
      // registry module loads, the slot returns an empty passing
      // result so callers (snapshot capture, tests) can rely on the
      // shape unconditionally.
      return runInstalledInvariants();
    },

    // ── Freeze panes ──

    async getFreezeState(): Promise<{
      frozenRows: number;
      frozenCols: number;
      applied: boolean;
    } | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      const panes = await wb.activeSheet.view.getFrozenPanes();
      // `applied` reads the renderer's actual viewport layout — the
      // canonical source for "is the freeze divider drawn at this
      // boundary on the current paint?" (app-eval / David §0.2 #130).
      // Logical zero-counts trivially mean "not applied"; with non-zero
      // counts we look for a `freeze`-type divider in the layout. If
      // the renderer hasn't published a layout yet, fall back to false
      // so the assertion fires the "freeze never applies on first
      // render" smoking gun.
      let applied = false;
      try {
        if (panes.rows > 0 || panes.cols > 0) {
          const coordinator = (window as any).__COORDINATOR__;
          const viewport = coordinator?.renderer?.getViewport?.();
          const layout = viewport?.getLayout?.();
          if (layout) {
            const dividers = Array.isArray(layout.dividers) ? layout.dividers : [];
            const headerInfo = layout.headerInfo;
            const headerHasFreeze = !!(
              headerInfo &&
              ((typeof headerInfo.frozenRows === 'number' && headerInfo.frozenRows > 0) ||
                (typeof headerInfo.frozenCols === 'number' && headerInfo.frozenCols > 0))
            );
            const dividerHasFreeze = dividers.some((d: { type?: string }) => d?.type === 'freeze');
            applied = headerHasFreeze || dividerHasFreeze;
          }
        }
      } catch {
        applied = false;
      }
      return { frozenRows: panes.rows, frozenCols: panes.cols, applied };
    },

    async freezeTopRow(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.freezeTopRow] No active workbook found.');
        return;
      }
      await wb.activeSheet.view.freezePanes(1, 0);
    },

    async freezeFirstColumn(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.freezeFirstColumn] No active workbook found.');
        return;
      }
      await wb.activeSheet.view.freezePanes(0, 1);
    },

    async freezePanes(rows: number, cols: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.freezePanes] No active workbook found.');
        return;
      }
      await wb.activeSheet.view.freezePanes(rows, cols);
    },

    async unfreezePanes(): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.unfreezePanes] No active workbook found.');
        return;
      }
      await wb.activeSheet.view.unfreeze();
    },

    // ── Hide/unhide rows & columns ──

    async hideRows(rows: number[]): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.hideRows] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.hideRows(rows);
    },

    async hideColumns(cols: number[]): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.hideColumns] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.hideColumns(cols);
    },

    async unhideRows(startRow: number, endRow: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.unhideRows] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.unhideRows(startRow, endRow);
    },

    async unhideColumns(startCol: number, endCol: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.unhideColumns] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.unhideColumns(startCol, endCol);
    },

    async isRowHidden(row: number): Promise<boolean | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      return await wb.activeSheet.layout.isRowHidden(row);
    },

    async isColumnHidden(col: number): Promise<boolean | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      return await wb.activeSheet.layout.isColumnHidden(col);
    },

    // ── Dimensions ──

    async getColWidth(col: number): Promise<number | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      const ws = wb.activeSheet;
      try {
        // Rust `get_col_width_query` (`dimensions::get_col_width`) consults
        // both explicit hide (`KEY_HIDDEN_COLS`) and outline collapse state, so
        // 0 is returned for columns in a collapsed group without a TS shim.
        return await ws.layout.getColumnWidth(col);
      } catch {
        return null;
      }
    },

    // ── Autofit ──

    async autoFitRow(row: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.autoFitRow] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.autoFitRow(row);
    },

    async autoFitColumn(col: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.autoFitColumn] No active workbook found.');
        return;
      }
      await wb.activeSheet.layout.autoFitColumn(col);
    },

    // ── Outline / Group ──

    async groupRows(startRow: number, endRow: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.groupRows] No active workbook found.');
        return;
      }
      await wb.activeSheet.outline.groupRows(startRow, endRow);
    },

    async groupColumns(startCol: number, endCol: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.groupColumns] No active workbook found.');
        return;
      }
      await wb.activeSheet.outline.groupColumns(startCol, endCol);
    },

    async ungroupRows(startRow: number, endRow: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.ungroupRows] No active workbook found.');
        return;
      }
      await wb.activeSheet.outline.ungroupRows(startRow, endRow);
    },

    async ungroupColumns(startCol: number, endCol: number): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.ungroupColumns] No active workbook found.');
        return;
      }
      await wb.activeSheet.outline.ungroupColumns(startCol, endCol);
    },

    async getOutlineLevel(axis: 'row' | 'col', index: number): Promise<number | null> {
      const wb = getActiveWorkbook();
      if (!wb) return null;
      const kernelAxis = axis === 'col' ? 'column' : 'row';
      return await wb.activeSheet.outline.getLevel(kernelAxis, index);
    },

    async toggleOutlineGroup(axis: 'row' | 'col', level: number, collapse: boolean): Promise<void> {
      const wb = getActiveWorkbook();
      if (!wb) {
        console.warn('[__dt.toggleOutlineGroup] No active workbook found.');
        return;
      }
      const state = await wb.activeSheet.outline.getState();
      let targetRow: number;
      let targetCol: number;
      if (axis === 'row') {
        targetRow = collapse ? level - 1 : level;
        targetCol = state.maxColLevel;
      } else {
        targetRow = state.maxRowLevel;
        targetCol = collapse ? level - 1 : level;
      }
      await wb.activeSheet.outline.showOutlineLevels(targetRow, targetCol);
    },

    // ── app-eval / app-eval rendered-state readback: rendered-state readbacks ──

    async getRenderedDrawings(sheetId?: string) {
      try {
        // The scene graph is the single authority for what the drawing
        // layer renders. Reading it (instead of e.g. `wb.activeSheet.drawings`
        // from the kernel) ensures parser-side drops surface as missing
        // entries here, which is the bug class app-eval needs to catch.
        //
        // The scene graph lives on the SheetView object-scene capability,
        // not on the kernel context. The `sheetId` argument is preserved
        // for forward compatibility (multi-sheet scene graphs); the
        // production renderer is per-document, so scene-graph reads
        // currently ignore it.
        const coordinator = (window as any).__COORDINATOR__;
        const sceneObjects =
          coordinator?.renderer?.getSheetView?.()?.objects?.getSceneObjectsByZOrder?.() ?? [];

        const wb = getActiveWorkbook();
        const ws = wb?.activeSheet;

        const out: import('../types').DrawingDescriptor[] = [];
        for (const obj of sceneObjects) {
          const kind = mapSceneTypeToDrawingKind(obj.type, obj);
          // Snap document-space top-left to the nearest cell. The renderer
          // already drew the drawing at obj.bounds, so the anchor is
          // derived from those bounds (not from kernel-side anchor data).
          // safeCellSnap handles all the fallbacks (worksheet method →
          // coordinator's coordinate system → null). We always call it; if
          // no resolver is reachable, we still emit a deterministic anchor
          // (0,0) so scenarios get a stable shape.
          const fromCell = safeCellSnap(ws, obj.bounds.x, obj.bounds.y);
          const toCell = safeCellSnap(
            ws,
            obj.bounds.x + obj.bounds.width,
            obj.bounds.y + obj.bounds.height,
          );
          out.push({
            id: obj.id,
            kind,
            anchor: {
              from: fromCell ?? { row: 0, col: 0 },
              ...(toCell ? { to: toCell } : {}),
            },
            boundsPx: {
              x: obj.bounds.x,
              y: obj.bounds.y,
              w: obj.bounds.width,
              h: obj.bounds.height,
            },
            visible: !!obj.visible,
            ...(extractSrc(obj) ? { src: extractSrc(obj)! } : {}),
          });
        }

        const activeSheetId =
          typeof ws?.getSheetId === 'function' ? String(ws.getSheetId()) : undefined;
        if (!sheetId || !activeSheetId || sheetId === activeSheetId) {
          const existingIds = new Set(out.map((drawing) => drawing.id));
          out.push(...getRenderedDomFormControls(ws, existingIds));
        }
        return out;
      } catch {
        return [];
      }
    },

    getRemoteCursors(): import('../types').RemoteCursorDescriptor[] {
      try {
        const shell = (window as any).__SHELL__;
        if (!shell?.documentManager) return [];

        const activeFileId = shell.store?.getState?.()?.activeFileId;
        if (!activeFileId) return [];

        const sidecar = shell.documentManager.getSidecar(activeFileId);
        if (!sidecar?.participants) return [];

        const out: import('../types').RemoteCursorDescriptor[] = [];
        for (const [participantId, state] of sidecar.participants as ReadonlyMap<string, any>) {
          if (!state.selection) continue;
          const sel = state.selection;
          out.push({
            userId: participantId,
            name: state.displayName ?? 'Unknown',
            color: state.color ?? '#888',
            activeCell: { row: sel.row, col: sel.col },
            selection:
              sel.endRow != null && sel.endCol != null
                ? [{ startRow: sel.row, startCol: sel.col, endRow: sel.endRow, endCol: sel.endCol }]
                : [{ startRow: sel.row, startCol: sel.col, endRow: sel.row, endCol: sel.col }],
            sheetId: sel.sheetId,
            isEditing: !!state.editing,
            ...(state.editing
              ? { editingCell: { row: state.editing.row, col: state.editing.col } }
              : {}),
          });
        }
        return out;
      } catch {
        return [];
      }
    },

    async getRenderedRowHeight(_sheet: string | null, row: number): Promise<number | null> {
      // Read the height the canvas drew for this row by going through the
      // SheetView geometry `getCellPageRect`. This is the same source the
      // production click-to-cell hit-tester consults, so the value here
      // matches the canvas, not whatever the kernel layout-index says.
      try {
        const coordinator = (window as any).__COORDINATOR__;
        const geometry = coordinator?.renderer?.getGeometry?.();
        if (!geometry?.getCellPageRect) return null;
        const bounds = geometry.getCellPageRect({ row, col: 0 });
        if (!bounds) return null;
        return bounds.height;
      } catch {
        return null;
      }
    },

    async getRenderedColWidth(_sheet: string | null, col: number): Promise<number | null> {
      try {
        const coordinator = (window as any).__COORDINATOR__;
        const geometry = coordinator?.renderer?.getGeometry?.();
        if (!geometry?.getCellPageRect) return null;
        const bounds = geometry.getCellPageRect({ row: 0, col });
        if (!bounds) return null;
        return bounds.width;
      } catch {
        return null;
      }
    },

    getRenderedViewportStartRow(scope: string = 'main'): number | null {
      try {
        const coordinator = (window as any).__COORDINATOR__;
        const viewport = coordinator?.renderer?.getViewport?.();
        const geometry = coordinator?.renderer?.getGeometry?.();

        if (!viewport?.getLayout || !geometry?.getVisibleRange || !geometry.getCellPageRect) {
          return null;
        }

        const layout = viewport.getLayout();
        const matchingViewport = layout?.viewports?.find((vp: any) => {
          const id = String(vp?.id ?? '');
          return id === scope || id.startsWith(`${scope}:`);
        });
        const range = matchingViewport?.cellRange ?? geometry.getVisibleRange();
        if (!range) return null;

        for (let row = range.startRow; row <= range.endRow; row++) {
          const bounds = geometry.getCellPageRect({ row, col: 0 });
          if (bounds && Number.isFinite(bounds.height) && bounds.height > 0) {
            return row;
          }
        }
        return null;
      } catch {
        return null;
      }
    },

    // ── UX-FIX explicit-format #18 — devtools accessors that retire __SHELL__ reach-throughs ──
    //
    // The fast-scroll / popover-overflow / sheet-tab-color / CF-bar / CF-icon-set
    // app-eval scenarios were walking
    // `__SHELL__.documentManager.getDocument(activeFileId).context.computeBridge`
    // to reach kernel state. That violates UX-FIX §1 (E2E real path) and
    // sneaks the kernel viewport-state map keyed by `'main:*'` into the
    // app-eval contract. These accessors expose the exact state those
    // scenarios needed via the existing `__dt` boundary that other
    // lifecycle/persistence specs already respect.

    /**
     * Active document id, as the shell sees it (no `__SHELL__` reach).
     * Used by lifecycle / refresh-persistence specs that previously read
     * `__SHELL__.store.getState().activeFileId`.
     */
    getActiveFileId(): string | null {
      try {
        const shell = (window as any).__SHELL__;
        return shell?.store?.getState?.()?.activeFileId ?? null;
      } catch {
        return null;
      }
    },

    /**
     * Per-viewport state snapshots from the active document's compute
     * bridge. Returned as a plain `Record` keyed by viewport scope (e.g.
     * `'main:0'`, `'frozen-row:0'`, `'frozen-col:0'`). When `scopePrefix`
     * is supplied, only entries whose key starts with that prefix are
     * returned. Empty object on any failure.
     *
     * Replaces the
     * `__SHELL__.documentManager.getDocument(...).context.computeBridge.getPerViewportStates()`
     * walk used by `popover-overflow/_helpers.ts`,
     * `cf-data-bar.spec.ts`, `cf-icon-set.spec.ts`.
     */
    getViewportStates(scopePrefix?: string): Record<string, unknown> {
      try {
        const shell = (window as any).__SHELL__;
        const fileId = shell?.store?.getState?.()?.activeFileId;
        const handle = shell?.documentManager?.getDocument?.(fileId);
        const bridge = handle?.context?.computeBridge;
        const map: Map<string, unknown> | null | undefined = bridge?.getPerViewportStates?.();
        if (!map) return {};
        const out: Record<string, unknown> = {};
        for (const [k, v] of map) {
          const key = String(k);
          if (scopePrefix && !key.startsWith(scopePrefix)) continue;
          out[key] = v;
        }
        return out;
      } catch {
        return {};
      }
    },

    /**
     * Convenience: top-of-viewport row index for a given scope.
     * `scope` defaults to `'main'` and matches the prefix in the
     * `'main:0'` / `'main:1'` map keys; the first matching scope's
     * `lastVisibleBounds.startRow` is returned. `null` when no viewport
     * matches the scope.
     */
    getViewportStartRow(scope: string = 'main'): number | null {
      try {
        const shell = (window as any).__SHELL__;
        const fileId = shell?.store?.getState?.()?.activeFileId;
        const handle = shell?.documentManager?.getDocument?.(fileId);
        const bridge = handle?.context?.computeBridge;
        const map: Map<string, unknown> | null | undefined = bridge?.getPerViewportStates?.();
        if (!map) return null;
        for (const [k, v] of map) {
          if (String(k).startsWith(`${scope}:`)) {
            const startRow = (v as any)?.lastVisibleBounds?.startRow;
            return typeof startRow === 'number' ? startRow : null;
          }
        }
        return null;
      } catch {
        return null;
      }
    },

    /**
     * Force a full-viewport recompute on the active doc's compute
     * bridge. Used by CF specs (cf-data-bar / cf-icon-set) where
     * data-bar fill ratios live in the full viewport binary; cell-value
     * mutations only produce patches, so the in-memory ratio cache
     * stays stale until the next full reload. Calling this flushes the
     * Rust CF cache into the TS viewport buffer.
     *
     * Returns once the refresh promise resolves (or the bridge isn't
     * available; the call is a no-op then).
     */
    async forceRefreshViewports(): Promise<void> {
      try {
        const shell = (window as any).__SHELL__;
        const fileId = shell?.store?.getState?.()?.activeFileId;
        const handle = fileId ? shell?.documentManager?.getDocument?.(fileId) : null;
        const bridge = handle?.context?.computeBridge;
        await bridge?.forceRefreshAllViewports?.();
      } catch {
        // best-effort
      }
    },

    /**
     * Tab color for a given sheet, read from the active document's
     * compute bridge tab-color query. `sheet` may be either the
     * SheetId (preferred) or the sheet's display name (resolved through
     * the active workbook). Returns `null` when the sheet has no tab
     * color set or the bridge isn't reachable.
     *
     * Replaces the `ctx.computeBridge.getTabColorQuery(...)` walk in
     * `sheet-tab-color.spec.ts` (sheet-ops + sheet-ops-deep).
     */
    async getActiveSheetTabColor(sheet: string): Promise<string | null> {
      try {
        // Use the same workbook reference the app already holds — avoids
        // passing display names directly to the WASM (which only accepts
        // numeric/UUID SheetIds). ws.view.getTabColor() internally calls
        // getTabColorQuery(this.sheetId) with the pre-resolved numeric ID.
        const wb = getActiveWorkbook();
        if (!wb) return null;
        const sheets = await wb.getSheets();
        for (const ws of sheets) {
          if (ws.name === sheet || ws.getSheetId?.() === sheet) {
            const tabColor = await ws.view.getTabColor();
            return typeof tabColor === 'string' && tabColor !== '' ? tabColor : null;
          }
        }
        return null;
      } catch {
        return null;
      }
    },

    // ── structural readbacks ──

    async getOutlineGutter(sheet: string): Promise<{
      rows: { row: number; level: number; collapsed: boolean }[];
      cols: { col: number; level: number; collapsed: boolean }[];
    } | null> {
      // Returns the canonical kernel-state outline groups for `sheet` (matched
      // by name or SheetId). Returns null when the sheet has no row OR column
      // groups — i.e., when the OutlineToggleOverlay would not mount.
      //
      // Why kernel state and not DOM toggles: the renderer's
      // `OutlineToggleOverlay` only emits toggle <button>s for groups whose
      // anchor cell sits inside the *visible viewport* (see
      // `computeOutlineRects` in OutlineToggleOverlay.tsx — it bails on
      // `coords.cellToViewport(...)` returning null). For the LBO Sample
      // sheet's 15 row groups spanning rows 5..108, only the 1-2 groups whose
      // end-row lands in the initial viewport draw a toggle — the rest are
      // architecturally correct (off-screen) but invisible to a DOM
      // querySelector. Tests that verify *parser/import fidelity* want the
      // 15 groups, not the 1-2 currently rendered. So this readback queries
      // the kernel, which is the parser's destination and the renderer's
      // single source of truth.
      try {
        const wb = getActiveWorkbook();
        if (!wb) return null;
        const sheets = await wb.getSheets();
        let ws: any = null;
        for (const candidate of sheets) {
          if (candidate.name === sheet || candidate.getSheetId?.() === sheet) {
            ws = candidate;
            break;
          }
        }
        if (!ws?.outline?.getState) return null;
        const state = await ws.outline.getState();
        const rowGroups: ReadonlyArray<{ start: number; level: number; collapsed: boolean }> =
          state.rowGroups ?? [];
        const columnGroups: ReadonlyArray<{
          start: number;
          level: number;
          collapsed: boolean;
        }> = state.columnGroups ?? [];
        // Mirror the OutlineToggleOverlay mount-gate: null when neither axis
        // has any groups — kernel says "no gutter would be drawn here."
        if (rowGroups.length === 0 && columnGroups.length === 0) return null;
        const rows = rowGroups
          .map((g) => ({ row: g.start, level: g.level, collapsed: g.collapsed }))
          .sort((a, b) => a.row - b.row);
        const cols = columnGroups
          .map((g) => ({ col: g.start, level: g.level, collapsed: g.collapsed }))
          .sort((a, b) => a.col - b.col);
        return { rows, cols };
      } catch {
        return null;
      }
    },

    gridlinesVisible(_sheetId: string): boolean {
      // Read the renderer's `sheetAdapter.showGridlines` flag. The
      // `BackgroundLayer.render` method consults this same field — so a
      // `true` here means the next paint WILL stroke gridlines and a
      // `false` here means it WON'T. Reading from the kernel snapshot
      // would miss the "snapshot says hidden, first paint draws default-
      // true" race the plan calls out.
      try {
        const coordinator = (window as any).__COORDINATOR__;
        const gridRenderer = coordinator?.renderer?.getRenderer?.();
        if (!gridRenderer) return false;
        // `sheetAdapter` is private on the GridRenderer class but reachable
        // by name in JS. We accept the structural-typing risk here because
        // the alternative (adding a public getter just for tests) would
        // bloat the canvas API surface; this is what `__dt` is for.
        const adapter = (gridRenderer as { sheetAdapter?: { showGridlines?: boolean } })
          .sheetAdapter;
        if (!adapter) return false;
        return adapter.showGridlines === true;
      } catch {
        return false;
      }
    },

    getFormulaBarText(): { text: string; isArrayMember: boolean } | null {
      // Read the formula-bar input element's `.value` directly. The
      // formula bar is identified by `data-testid="formula-bar"`
      // (FormulaBar.tsx); inside it lives either an `<input>` (single
      // line) or a `<textarea>` (expanded multi-line). Return whichever
      // is currently mounted.
      try {
        const doc =
          (typeof document !== 'undefined' ? document : null) ??
          (globalThis as { window?: { document?: Document } }).window?.document ??
          null;
        if (!doc) return null;
        const root = doc.querySelector('[data-testid="formula-bar"]');
        if (!root) return null;
        const inputEl = root.querySelector('input, textarea') as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (!inputEl) return null;
        const text = inputEl.value ?? '';
        // Read array-membership directly off the active cell's
        // `metadata.region` via the active-cell cache populated by
        // `refreshActiveCell`.
        //
        // The production bar's brace policy is `region.kind` ∈
        // {`cseArray`, `dataTable`}; `arraySpill` does NOT brace-wrap.
        // For the readback flag we want "is this cell inside any
        // region?" — that's `region != null && !region.isAnchor` for
        // body/member positions, and `region != null` for anchors.
        // The scenario asserts on body cells where braces fire, so the
        // discriminant is "any region kind that brace-wraps" — same
        // policy the formula bar uses.
        const bridge = (() => {
          const shell = (globalThis as { window?: { __SHELL__?: unknown } }).window?.__SHELL__ as
            | {
                store?: { getState?: () => { activeFileId?: string } };
                documentManager?: {
                  getDocument?: (id: string) => {
                    context?: { computeBridge?: { getActiveCellData?: () => unknown } };
                  };
                };
              }
            | undefined;
          const fileId = shell?.store?.getState?.()?.activeFileId;
          if (!shell || !fileId) return null;
          return shell.documentManager?.getDocument?.(fileId)?.context?.computeBridge ?? null;
        })();
        let isArrayMember = false;
        if (bridge?.getActiveCellData) {
          const active = bridge.getActiveCellData() as {
            metadata?: { region?: { kind?: string; isAnchor?: boolean } | null };
          } | null;
          const region = active?.metadata?.region;
          if (region != null) {
            // Brace policy mirrors the formula bar (D5): `cseArray` and
            // `dataTable` brace; `arraySpill` does not. For Data Tables,
            // every cell (anchor + members) wears braces because the
            // master holds `=TABLE(...)` and members hold the same
            // synthesized text. For CSE, every member + anchor wear
            // braces. Matching what the bar renders.
            isArrayMember = region.kind === 'cseArray' || region.kind === 'dataTable';
          }
        }
        return { text, isArrayMember };
      } catch {
        return null;
      }
    },

    async getCanvasSnapshot(
      region?: import('../types').PixelRect,
    ): Promise<import('../types').CanvasSnapshot> {
      // Take the topmost rendered canvas and pull either the full image
      // or the requested region. Returning a Uint8Array forces callers to
      // pass through page.evaluate's serialization layer carefully — the
      // accessor stays simple; pixel-diff lives at the assertion layer.
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        return { png: new Uint8Array(), dpr: 1 };
      }
      const dpr = (window as any).devicePixelRatio ?? 1;
      let target: HTMLCanvasElement = canvas;
      if (region) {
        const cropped = document.createElement('canvas');
        cropped.width = Math.max(0, Math.floor(region.w * dpr));
        cropped.height = Math.max(0, Math.floor(region.h * dpr));
        const cctx = cropped.getContext('2d');
        if (cctx) {
          cctx.drawImage(
            canvas,
            region.x * dpr,
            region.y * dpr,
            region.w * dpr,
            region.h * dpr,
            0,
            0,
            cropped.width,
            cropped.height,
          );
        }
        target = cropped;
      }
      const dataUrl = target.toDataURL('image/png');
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const binStr = atob(base64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      return { png: bytes, dpr };
    },

    // ── app-eval / app-eval input-mode readback (Richard §0.1, §0.2) ──
    //
    // DOM/global readbacks for input-mode + lifecycle scenarios. Each
    // routes through user-visible state (activeElement, getBoundingClientRect,
    // a global flag) — never through kernel state.

    getCellEditorBuffer(): string | null {
      try {
        const doc =
          (typeof document !== 'undefined' ? document : null) ??
          (globalThis as { window?: { document?: Document } }).window?.document ??
          null;
        if (!doc) return null;
        // Query the editor by test-id rather than checking activeElement.
        // The InlineCellEditor only mounts when the cell is in edit mode,
        // so "not in DOM" unambiguously means "no leak possible" → return ''.
        // Returning null is reserved for "__dt unavailable" so callers can
        // distinguish "no editor" (empty string) from "bridge absent" (null).
        const editor = doc.querySelector('[data-testid="inline-cell-editor"]') as
          | HTMLTextAreaElement
          | HTMLInputElement
          | null;
        if (!editor) return '';
        return editor.value ?? '';
      } catch {
        return null;
      }
    },

    getOverlayBounds(overlayId: import('../types').OverlayId) {
      try {
        const doc =
          (typeof document !== 'undefined' ? document : null) ??
          (globalThis as { window?: { document?: Document } }).window?.document ??
          null;
        if (!doc) return null;
        // Resolve the overlay element. Prefer a stable test-id; fall
        // back to a generic data-overlay-id attribute so legacy mounts
        // are still observable.
        const el =
          (doc.querySelector(`[data-testid="overlay-${overlayId}"]`) as HTMLElement | null) ??
          (doc.querySelector(`[data-overlay-id="${overlayId}"]`) as HTMLElement | null);
        if (!el) return null;
        const rectToPixelRect = (r: DOMRect): import('../types').PixelRect => ({
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        });
        const domRect = rectToPixelRect(el.getBoundingClientRect());
        // Walk parents to find the nearest clipping container.
        let clippedToContainer: import('../types').PixelRect | null = null;
        const win =
          (globalThis as { window?: Window }).window ??
          (typeof window !== 'undefined' ? window : undefined);
        let parent: HTMLElement | null = el.parentElement;
        while (parent && parent !== doc.body) {
          let style: CSSStyleDeclaration | null = null;
          try {
            style = win?.getComputedStyle?.(parent) ?? null;
          } catch {
            style = null;
          }
          const clipping =
            style != null &&
            (['auto', 'scroll', 'hidden'].includes(style.overflow) ||
              ['auto', 'scroll', 'hidden'].includes(style.overflowX) ||
              ['auto', 'scroll', 'hidden'].includes(style.overflowY));
          if (clipping) {
            clippedToContainer = rectToPixelRect(parent.getBoundingClientRect());
            break;
          }
          parent = parent.parentElement;
        }
        // Compute allChildrenVisible — every direct child must intersect
        // either the clipping container's rect or the viewport.
        const containerRect: import('../types').PixelRect = clippedToContainer ?? {
          x: 0,
          y: 0,
          w: typeof win?.innerWidth === 'number' ? win.innerWidth : 0,
          h: typeof win?.innerHeight === 'number' ? win.innerHeight : 0,
        };
        const intersects = (
          a: import('../types').PixelRect,
          b: import('../types').PixelRect,
        ): boolean =>
          a.w > 0 &&
          a.h > 0 &&
          b.w > 0 &&
          b.h > 0 &&
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        let allChildrenVisible = true;
        const children = Array.from(el.children) as HTMLElement[];
        if (children.length === 0) {
          // No children — fall back to the overlay itself; if it doesn't
          // intersect the container, the overlay is fully clipped.
          allChildrenVisible = intersects(domRect, containerRect);
        } else {
          for (const child of children) {
            const childRect = rectToPixelRect(child.getBoundingClientRect());
            if (!intersects(childRect, containerRect)) {
              allChildrenVisible = false;
              break;
            }
          }
        }
        return { domRect, clippedToContainer, allChildrenVisible };
      } catch {
        return null;
      }
    },

    // ── Debug Recording ──

    startRecording(): void {
      getDebugRecorder().start();
    },
    stopRecording(): unknown | null {
      return getDebugRecorder().stop();
    },
    getRecording(): unknown {
      return getDebugRecorder();
    },
    isRecording(): boolean {
      return getDebugRecorder().isRecording;
    },

    // `persistenceEnabled` is a getter declared via `Object.defineProperty`
    // below. Shell replaces it with the full lifecycle gate through
    // `@mog/devtools/shell-persistence` once shell bootstrap has live readers.
    // The placeholder property here keeps the typed surface satisfied.
    persistenceEnabled: false,
  };

  // ── Debug Recorder (debug-recorder plan) ──
  //
  // Lazily created DebugRecorder instance. The recorder wraps the existing
  // EventStore + ActorRecorder + console API to produce self-contained JSON
  // bundles for agent-driven bug reproduction.
  let debugRecorder: DebugRecorder | null = null;

  function getDebugRecorder(): DebugRecorder {
    if (!debugRecorder) {
      debugRecorder = new DebugRecorder(store, actorRecorder, api);
    }
    return debugRecorder;
  }

  // ── persistence flag ──
  //
  // `persistenceEnabled` starts as a conservative getter that reads the
  // legacy `window.__SHELL__.persistenceEnabled` flag. Shell bootstrap
  // replaces this property with the full live lifecycle gate through
  // `@mog/devtools/shell-persistence`.
  //
  // We override the placeholder literal value with a real getter via
  // defineProperty, so the public type sees a `boolean` but the runtime
  // returns the live shell value.
  Object.defineProperty(api, 'persistenceEnabled', {
    enumerable: true,
    configurable: true,
    get() {
      try {
        const win =
          (globalThis as { window?: { __SHELL__?: { persistenceEnabled?: unknown } } }).window ??
          (typeof window !== 'undefined'
            ? (window as unknown as {
                __SHELL__?: { persistenceEnabled?: unknown };
              })
            : undefined);
        const flag = win?.__SHELL__?.persistenceEnabled;
        return flag === true;
      } catch {
        return false;
      }
    },
  });

  // ── attach private pointer-capture slots ──
  // Underscore prefix marks these as internal (not in DevToolsConsoleAPI).
  // app-eval reads them via getLastFlow merge (via `dt._pointerEvents`)
  // and writes `_stepStartedAt` from `clearEventBuffer`.
  const apiRef = api as DevToolsConsoleAPI & {
    _pointerEvents: PointerRingBuffer;
    _stepStartedAt: number;
  };
  Object.defineProperty(apiRef, '_pointerEvents', {
    value: pointerEvents,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  // `_stepStartedAt` is mutable: app-eval writes it directly after
  // `dt.clear()`. Use a getter/setter pair so the closure-local
  // `stepStartedAt` (which `clear()` resets) stays in sync.
  Object.defineProperty(apiRef, '_stepStartedAt', {
    get() {
      return stepStartedAt;
    },
    set(v: number) {
      stepStartedAt = typeof v === 'number' ? v : 0;
    },
    enumerable: false,
    configurable: true,
  });

  return api;

  /** Build a structured ProgrammaticFlow from correlated store entries */
  function buildFlow(
    correlationId: number,
    entries: import('../types').StoreEntry[],
  ): ProgrammaticFlow {
    // Schema v2 (O-1) — every entry carries source/kind/tSinceStepStart.
    // The store-level events already have `source` and `tSinceStepStart`
    // populated by the global hook; we project those + a freshly synthesized
    // `kind` onto each flow sub-array entry.
    const flow: ProgrammaticFlow = {
      schemaVersion: 2,
      correlationId,
      action: null,
      actions: [],
      transitions: [],
      receipts: [],
      bridgeCalls: [],
      viewportUpdates: [],
      guardRejections: [],
    };

    for (const entry of entries) {
      const evt = entry.event;
      switch (evt.type) {
        case 'action': {
          const action = evt as ActionDispatchEvent;
          // O-D: harness-helper actions get `kind: 'harness.helper'`;
          // every other dispatched action keeps `kind: 'action.dispatch'`.
          const source = action.source ?? 'keyboard';
          const kind = source === 'harness' ? 'harness.helper' : 'action.dispatch';
          const record = {
            name: action.action,
            handled: action.handled,
            durationMs: action.durationMs,
            error: action.error,
            receiptCount: action.receiptCount,
            payload: action.payload,
            source,
            kind,
            tSinceStepStart: action.tSinceStepStart ?? 0,
          };
          flow.actions.push(record);
          // Keep `flow.action` as the first record we encountered for
          // backwards compatibility with classify.ts / hint.ts / inspect.ts
          // / probe.ts / report.ts (all of which read `flow.action` directly).
          if (flow.action == null) flow.action = record;
          break;
        }
        case 'actor': {
          const actor = evt as ActorEvent;
          if (actor.kind === 'transition') {
            flow.transitions.push({
              machineId: actor.actorId,
              fromState: actor.fromState ?? '',
              toState: actor.toState ?? '',
              eventType: actor.eventType ?? '',
              durationMs: actor.durationMs,
              source: actor.source ?? 'internal',
              kind: 'machine.transition',
              tSinceStepStart: actor.tSinceStepStart ?? 0,
            });
          } else if (actor.kind === 'guard.reject') {
            flow.guardRejections.push({
              machineId: actor.actorId,
              eventType: actor.eventType ?? '',
              source: actor.source ?? 'internal',
              kind: 'machine.guard.reject',
              tSinceStepStart: actor.tSinceStepStart ?? 0,
            });
          }
          break;
        }
        case 'receipt': {
          const receipt = evt as ReceiptEvent;
          for (const r of receipt.receipts) {
            flow.receipts.push({
              domain: r.domain,
              action: r.action,
              id: r.id,
              source: receipt.source ?? 'internal',
              kind: 'action.receipt',
              tSinceStepStart: receipt.tSinceStepStart ?? 0,
            });
          }
          break;
        }
        case 'bridge': {
          const bridge = evt as BridgeCallEvent;
          flow.bridgeCalls.push({
            bridge: bridge.bridgeName,
            method: bridge.method,
            durationMs: bridge.durationMs,
            mutationMeta: bridge.mutationMeta
              ? {
                  changedCellCount: bridge.mutationMeta.changedCellCount,
                  recalcedCellCount: bridge.mutationMeta.recalcedCellCount,
                }
              : undefined,
            source: bridge.source ?? 'internal',
            // O-B will refine this to 'bridge.read'/'bridge.write'/'bridge.lifecycle'
            // by joining against the manifest from O-0. Until then, surface
            // 'bridge.call' so the schema-v2 contract holds.
            kind: 'bridge.call',
            tSinceStepStart: bridge.tSinceStepStart ?? 0,
          });
          break;
        }
        case 'viewport-buffer': {
          const vp = evt as ViewportBufferEvent;
          // `viewportUpdates.kind` predates schema v2 and already carries the
          // buffer-event kind ('mutation-applied' / 'full-refresh' /
          // 'delta-applied'). Keep that semantics here — the schema-v2 `kind`
          // contract permits any classifier string per entry-type.
          flow.viewportUpdates.push({
            kind: vp.kind,
            patchCount: vp.patchCount,
            source: vp.source ?? 'internal',
            tSinceStepStart: vp.tSinceStepStart ?? 0,
          });
          break;
        }
      }
    }

    // O-D: keyboard + harness actions merged in `tSinceStepStart` order so
    // a step that mixes both (e.g. `keyboard.pressKey` emits a synthetic
    // `harness` record alongside the real `keyboard` dispatch) shows them
    // in chronological order.
    flow.actions.sort((a, b) => (a.tSinceStepStart ?? 0) - (b.tSinceStepStart ?? 0));
    flow.action = flow.actions[0] ?? null;

    return flow;
  }
}
