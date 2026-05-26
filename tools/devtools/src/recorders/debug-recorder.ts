import type { EventStore } from '../event-store';
import type { ActorRecorder } from './actor-recorder';
import type { ActorEvent, DevToolsConsoleAPI, MachineSnapshot, StoreEntry } from '../types';
import type {
  AppStateSnapshot,
  BugReport,
  DebugRecordingBundle,
  LogEntry,
  StateTransition,
} from './debug-recorder-types';

/**
 * Debug Recorder — thin layer on top of EventStore + ActorRecorder that
 * accumulates events, console logs, and state transitions during a
 * user-driven recording session. Produces a self-contained JSON bundle
 * for agent consumption.
 */
export class DebugRecorder {
  private _recording = false;
  private _startedAt: string | null = null;
  private _startTimestamp = 0;
  private _startSnapshot: AppStateSnapshot | null = null;
  private _startEventId = 0;
  private _storeWasEnabled = false;

  // Buffers accumulated during recording
  private _logs: LogEntry[] = [];
  private _stateTransitions: StateTransition[] = [];

  // Console interception
  private _originals: Record<string, (...args: unknown[]) => void> = {};

  // Store subscription
  private _unsubscribe: (() => void) | null = null;
  private _lastProcessedId = 0;

  // Change listeners (for UI reactivity)
  private _listeners = new Set<() => void>();

  constructor(
    private store: EventStore,
    private actorRecorder: ActorRecorder,
    private api: DevToolsConsoleAPI,
  ) {}

  get isRecording(): boolean {
    return this._recording;
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }

  start(): void {
    if (this._recording) return;

    // Track whether we're the ones enabling the store (for cleanup on stop/discard)
    this._storeWasEnabled = this.store.isEnabled;

    // Enable the event store if not already enabled
    this.store.enable();

    this._recording = true;
    this._startedAt = new Date().toISOString();
    this._startTimestamp = Date.now();
    this._startEventId = this.store.currentId;
    this._logs = [];
    this._stateTransitions = [];
    this._lastProcessedId = 0;

    // Capture start snapshot
    this._startSnapshot = captureAppState(this.api, this.actorRecorder);

    // Intercept console methods
    this._interceptConsole();

    // Subscribe to store events to capture state transitions
    this._unsubscribe = this.store.subscribe(() => {
      this._processNewEvents();
    });

    this.notify();
  }

  stop(): DebugRecordingBundle | null {
    if (!this._recording) return null;

    this._recording = false;
    const stoppedAt = new Date().toISOString();
    const durationMs = Date.now() - this._startTimestamp;

    // Capture end snapshot
    const endSnapshot = captureAppState(this.api, this.actorRecorder);

    // Process any remaining events
    this._processNewEvents();

    // Restore console
    this._restoreConsole();

    // Unsubscribe from store
    this._unsubscribe?.();
    this._unsubscribe = null;

    // If we were the ones that enabled the store, disable it to prevent memory leaks
    if (!this._storeWasEnabled) {
      this.store.disable();
    }

    // Build the devtools dump — only events from the recording window
    const dtJson = this.api.toJSON();
    const scopedEvents = this.store.allSince(this._startEventId);

    // Collect errors scoped to the recording window
    const errors = this.api.getRecentErrors(this._startTimestamp);

    // Get last flow
    const lastFlow = this.api.getLastFlow();

    const bundle: Omit<DebugRecordingBundle, 'bugReport'> & { bugReport: null } = {
      version: 1,
      metadata: {
        recordedAt: this._startedAt!,
        stoppedAt,
        durationMs,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        url: typeof location !== 'undefined' ? location.href : 'unknown',
        appVersion: getAppVersion(),
      },
      bugReport: null as any,
      stateSnapshots: {
        start: { timestamp: this._startedAt!, state: this._startSnapshot! },
        end: { timestamp: stoppedAt, state: endSnapshot },
      },
      devtools: {
        events: scopedEvents,
        machines: dtJson.machines as Record<string, MachineSnapshot>,
        stateTransitions: this._stateTransitions,
        viewportBuffers: dtJson.viewportBuffers ?? {},
        logs: this._logs,
        errors,
        lastFlow,
      },
      diagnostics: {
        duplicateEventCount: scopedEvents.filter((e) => e.event.isDuplicate).length,
      },
    };

    this.notify();

    // Return without bugReport — caller attaches it before download
    return bundle as any;
  }

  /** Discard the current recording without producing a bundle. */
  discard(): void {
    if (!this._recording) return;
    this._recording = false;
    this._restoreConsole();
    this._unsubscribe?.();
    this._unsubscribe = null;

    // If we were the ones that enabled the store, disable it to prevent memory leaks
    if (!this._storeWasEnabled) {
      this.store.disable();
    }

    this._logs = [];
    this._stateTransitions = [];
    this.notify();
  }

  private _interceptConsole(): void {
    if (typeof console === 'undefined') return;

    const levels: Array<'log' | 'warn' | 'error' | 'info'> = ['log', 'warn', 'error', 'info'];
    for (const level of levels) {
      this._originals[level] = console[level].bind(console);
      console[level] = ((...args: unknown[]) => {
        if (this._recording) {
          this._logs.push({
            timestamp: Date.now(),
            level,
            args: safeSerializeArgs(args),
          });
        }
        this._originals[level]?.(...args);
      }) as typeof console.log;
    }
  }

  private _restoreConsole(): void {
    for (const [level, orig] of Object.entries(this._originals)) {
      (console as any)[level] = orig;
    }
    this._originals = {};
  }

  private _processNewEvents(): void {
    const newEntries = this.store.allSince(
      this._lastProcessedId > 0 ? this._lastProcessedId + 1 : this._startEventId,
    );
    for (const entry of newEntries) {
      this._lastProcessedId = entry.id;

      // Capture state transitions with before/after snapshots
      if (entry.event.type === 'actor') {
        const actor = entry.event as ActorEvent;
        if (actor.kind === 'transition') {
          this._stateTransitions.push({
            timestamp: actor.timestamp,
            actorId: actor.actorId,
            fromState: actor.fromState ?? '',
            toState: actor.toState ?? '',
            eventType: actor.eventType ?? '',
          });
        }
      }
    }
  }
}

// ── Helpers ──

function safeSerializeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return { __type: 'Error', message: arg.message, stack: arg.stack };
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        JSON.stringify(arg);
        return arg;
      } catch {
        return String(arg);
      }
    }
    return arg;
  });
}

function getAppVersion(): string {
  try {
    // Try reading from meta tag or global
    const meta = document?.querySelector?.('meta[name="app-version"]');
    if (meta) return meta.getAttribute('content') ?? 'unknown';
    if ((window as any).__APP_VERSION__) return (window as any).__APP_VERSION__;
  } catch {
    // best-effort
  }
  return 'unknown';
}

/**
 * Capture a snapshot of app state at the current moment. Reuses patterns
 * from `dev/app-eval/capture/state.ts` but runs synchronously in-browser.
 */
export function captureAppState(
  api: DevToolsConsoleAPI,
  actorRecorder: ActorRecorder,
): AppStateSnapshot {
  const snapshot: AppStateSnapshot = {
    activeCell: null,
    selectionRanges: [],
    editor: { state: 'inactive', mode: null, cellValue: null },
    machines: {},
    cellValues: {},
    cellFormats: {},
  };

  try {
    const coordinator = (window as any).__COORDINATOR__;
    if (coordinator) {
      // Active cell
      const selAccessors = coordinator.grid?.access?.accessors?.selection;
      if (selAccessors) {
        const ac = selAccessors.getActiveCell?.();
        if (ac && typeof ac.row === 'number') {
          snapshot.activeCell = { row: ac.row, col: ac.col };
        }
        const ranges = selAccessors.getRanges?.();
        if (ranges) {
          for (const r of ranges) {
            snapshot.selectionRanges.push({
              startRow: r.startRow ?? r.start?.row ?? 0,
              startCol: r.startCol ?? r.start?.col ?? 0,
              endRow: r.endRow ?? r.end?.row ?? 0,
              endCol: r.endCol ?? r.end?.col ?? 0,
            });
          }
        }
      }

      // Editor state
      const editorAccessors = coordinator.grid?.access?.accessors?.editor;
      if (editorAccessors) {
        if (editorAccessors.isFormulaEditing?.()) snapshot.editor.state = 'formulaEditing';
        else if (editorAccessors.isRichTextEditing?.()) snapshot.editor.state = 'richTextEditing';
        else if (editorAccessors.isEditing?.()) snapshot.editor.state = 'editing';
        if (editorAccessors.isEnterMode?.()) snapshot.editor.mode = 'enterMode';
        else if (editorAccessors.isEditMode?.()) snapshot.editor.mode = 'editMode';
        if (typeof editorAccessors.getValue === 'function') {
          snapshot.editor.cellValue = editorAccessors.getValue() ?? null;
        }
      }
    }
  } catch {
    // best-effort
  }

  // Machine states
  try {
    const ms = api.getMachineStates();
    for (const [id, m] of Object.entries(ms)) {
      let ctx: Record<string, unknown> = {};
      if (m.context && typeof m.context === 'object' && !Array.isArray(m.context)) {
        ctx = m.context as Record<string, unknown>;
      }
      snapshot.machines[id] = { state: m.currentState, context: ctx, eventCount: m.eventCount };
    }
  } catch {
    // best-effort
  }

  // Sample cell values and formats around the active cell
  if (snapshot.activeCell) {
    const { row, col } = snapshot.activeCell;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0) continue;
        const key = `${r},${c}`;
        const cell = api.getCellValue(r, c);
        if (cell) {
          snapshot.cellValues[key] = {
            displayText: cell.displayText,
            valueType: cell.valueType,
          };
        }
        const fmt = api.getCellFormat(r, c);
        if (fmt) {
          snapshot.cellFormats[key] = fmt;
        }
      }
    }
  }

  return snapshot;
}
