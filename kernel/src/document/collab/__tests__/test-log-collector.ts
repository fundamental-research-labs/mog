/**
 * CollabTestLog — merges server logs + sidecar event logs into a unified
 * timeline. Dumps on test failure, discards on success.
 */

import type { EventLog, MessageStats, SidecarStatus } from '../event-log';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CollabDiagnostics {
  timeline: string;
  sidecarStats: Record<string, MessageStats>;
  sidecarStatus: Record<string, SidecarStatus>;
}

export interface CollabTestLog {
  addSidecar(label: string, log: EventLog, getStatus: () => SidecarStatus): void;
  addServerLine(line: string): void;
  dump(): string;
  diagnostics(): CollabDiagnostics;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface TimestampedLine {
  t: number;
  source: string;
  text: string;
}

export function createCollabTestLog(): CollabTestLog {
  const sidecars = new Map<string, { log: EventLog; getStatus: () => SidecarStatus }>();
  const serverLines: TimestampedLine[] = [];
  const startTime = Date.now();

  return {
    addSidecar(label, log, getStatus) {
      sidecars.set(label, { log, getStatus });
    },

    addServerLine(line) {
      serverLines.push({
        t: Date.now() - startTime,
        source: 'server',
        text: line.trimEnd(),
      });
    },

    dump() {
      const merged: TimestampedLine[] = [...serverLines];

      for (const [label, { log }] of sidecars) {
        const events = log.events();
        if (events.length === 0) continue;
        for (const e of events) {
          const detailStr = e.detail
            ? ' ' +
              Object.entries(e.detail)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')
            : '';
          merged.push({
            // Convert monotonic performance.now() to relative ms from test start.
            // This is approximate but good enough for timeline ordering.
            t: e.t,
            source: label,
            text: `${e.type}${detailStr}`,
          });
        }
      }

      // Sort by timestamp (stable sort preserves insertion order for same-ts events)
      merged.sort((a, b) => a.t - b.t);

      if (merged.length === 0) return '(no events)';

      const t0 = merged[0].t;
      const maxSourceLen = Math.max(...merged.map((l) => l.source.length));
      return merged
        .map((l) => {
          const rel = ((l.t - t0) / 1000).toFixed(3);
          return `[+${rel}] ${l.source.padEnd(maxSourceLen)} | ${l.text}`;
        })
        .join('\n');
    },

    diagnostics() {
      const sidecarStats: Record<string, MessageStats> = {};
      const sidecarStatus: Record<string, SidecarStatus> = {};

      for (const [label, { log, getStatus }] of sidecars) {
        sidecarStats[label] = log.stats();
        sidecarStatus[label] = getStatus();
      }

      return {
        timeline: this.dump(),
        sidecarStats,
        sidecarStatus,
      };
    },

    clear() {
      for (const [, { log }] of sidecars) {
        log.clear();
      }
      sidecars.clear();
      serverLines.length = 0;
    },
  };
}
