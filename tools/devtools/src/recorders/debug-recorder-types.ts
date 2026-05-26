import type { MachineSnapshot, ProgrammaticError, ProgrammaticFlow, StoreEntry } from '../types';

// ── App state snapshot (captured at recording boundaries) ──

export interface AppStateSnapshot {
  activeCell: { row: number; col: number } | null;
  selectionRanges: Array<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  }>;
  editor: {
    state: string;
    mode: string | null;
    cellValue: string | null;
  };
  machines: Record<string, { state: string; context: Record<string, unknown>; eventCount: number }>;
  cellValues: Record<string, { displayText: string | null; valueType: number }>;
  cellFormats: Record<string, Record<string, unknown>>;
}

// ── Log entry captured during recording ──

export interface LogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info';
  args: unknown[];
}

// ── State transition captured during recording ──

export interface StateTransition {
  timestamp: number;
  actorId: string;
  fromState: string;
  toState: string;
  eventType: string;
  snapshotBefore?: unknown;
  snapshotAfter?: unknown;
}

// ── Bug report metadata ──

export interface BugReport {
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: 'critical' | 'major' | 'minor' | 'cosmetic';
}

// ── The full debug recording bundle ──

export interface DebugRecordingBundle {
  version: 1;
  metadata: {
    recordedAt: string;
    stoppedAt: string;
    durationMs: number;
    userAgent: string;
    url: string;
    appVersion: string;
  };
  bugReport: BugReport;
  stateSnapshots: {
    start: { timestamp: string; state: AppStateSnapshot };
    end: { timestamp: string; state: AppStateSnapshot };
  };
  devtools: {
    events: StoreEntry[];
    machines: Record<string, MachineSnapshot>;
    stateTransitions: StateTransition[];
    viewportBuffers: Record<string, unknown>;
    logs: LogEntry[];
    errors: ProgrammaticError[];
    lastFlow: ProgrammaticFlow | null;
  };
  diagnostics?: {
    duplicateEventCount: number;
  };
}
