/**
 * Structured in-memory event log for WsSidecar observability.
 *
 * Opt-in: only test harnesses create and pass an EventLog.
 * Production sidecars don't use this — zero overhead.
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type SidecarEventType =
  | 'ws_connect'
  | 'ws_close'
  | 'ws_error'
  | 'join_req'
  | 'join_res'
  | 'resume_req'
  | 'resume_res'
  | 'presence_notify'
  | 'presence_notify_error'
  | 'awareness_recv'
  | 'awareness_skip_self'
  | 'awareness_remove'
  | 'awareness_set'
  | 'sync_apply'
  | 'sync_diff'
  | 'sync_sv'
  | 'flush_presence_skip'
  | 'flush_presence_send'
  | 'flush_start'
  | 'flush_push'
  | 'flush_skip'
  | 'flush_error'
  | 'nudge_recv'
  | 'pull_req'
  | 'pull_res'
  | 'push_res'
  | 'update_v1'
  | 'status_change'
  | 'reconnect_schedule'
  | 'setPresence'
  | 'detach';

export interface SidecarEvent {
  /** Monotonic timestamp (performance.now() or Date.now() fallback). */
  t: number;
  type: SidecarEventType;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MessageStats (derived from events)
// ---------------------------------------------------------------------------

export interface MessageStatEntry {
  count: number;
  bytes: number;
  lastTs: number;
}

export interface MessageStats {
  sent: Record<string, MessageStatEntry>;
  received: Record<string, MessageStatEntry>;
  totalBytesSent: number;
  totalBytesReceived: number;
}

// ---------------------------------------------------------------------------
// EventLog interface
// ---------------------------------------------------------------------------

export interface EventLog {
  push(type: SidecarEventType, detail?: Record<string, unknown>): void;
  events(): readonly SidecarEvent[];
  clear(): void;
  dump(): string;
  stats(): MessageStats;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_EVENTS = 500;

interface ProtocolStatMapping {
  dir: 'sent' | 'received';
  msg: string;
  bytesField?: string;
}

// Protocol message events only. Diagnostic lifecycle/presence logs stay out of wire stats.
const STAT_MAP: Partial<Record<SidecarEventType, ProtocolStatMapping>> = {
  flush_push: { dir: 'sent', msg: 'PUSH', bytesField: 'diff' },
  join_req: { dir: 'sent', msg: 'JOIN_REQUEST' },
  resume_req: { dir: 'sent', msg: 'RESUME_REQUEST' },
  pull_req: { dir: 'sent', msg: 'PULL_REQUEST', bytesField: 'localSv' },
  join_res: { dir: 'received', msg: 'JOIN_RESPONSE', bytesField: 'fullState' },
  resume_res: { dir: 'received', msg: 'RESUME_RESPONSE', bytesField: 'fullState' },
  nudge_recv: { dir: 'received', msg: 'BROADCAST_NUDGE', bytesField: 'serverSv' },
  pull_res: { dir: 'received', msg: 'PULL_RESPONSE', bytesField: 'diff' },
  push_res: { dir: 'received', msg: 'PUSH_RESPONSE', bytesField: 'serverDiff' },
};

function now(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}

export function createEventLog(maxEvents = DEFAULT_MAX_EVENTS): EventLog {
  const buffer: SidecarEvent[] = [];

  return {
    push(type, detail) {
      const event: SidecarEvent = { t: now(), type };
      if (detail) event.detail = detail;
      buffer.push(event);
      if (buffer.length > maxEvents) {
        buffer.splice(0, buffer.length - maxEvents);
      }
    },

    events() {
      return buffer;
    },

    clear() {
      buffer.length = 0;
    },

    dump() {
      if (buffer.length === 0) return '(no events)';
      const t0 = buffer[0].t;
      return buffer
        .map((e) => {
          const rel = ((e.t - t0) / 1000).toFixed(3);
          const detailStr = e.detail
            ? ' ' +
              Object.entries(e.detail)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')
            : '';
          return `+${rel}  ${e.type.padEnd(20)}${detailStr}`;
        })
        .join('\n');
    },

    stats() {
      const sent: Record<string, MessageStatEntry> = {};
      const received: Record<string, MessageStatEntry> = {};
      let totalBytesSent = 0;
      let totalBytesReceived = 0;

      for (const event of buffer) {
        const mapping = STAT_MAP[event.type];
        if (!mapping) continue;

        const bucket = mapping.dir === 'sent' ? sent : received;
        if (!bucket[mapping.msg]) {
          bucket[mapping.msg] = { count: 0, bytes: 0, lastTs: 0 };
        }
        const entry = bucket[mapping.msg];
        entry.count++;
        entry.lastTs = event.t;

        const byteVal =
          mapping.bytesField && event.detail ? parseBytes(event.detail[mapping.bytesField]) : 0;
        entry.bytes += byteVal;

        if (mapping.dir === 'sent') totalBytesSent += byteVal;
        else totalBytesReceived += byteVal;
      }

      return { sent, received, totalBytesSent, totalBytesReceived };
    },
  };
}

/** Parse a byte count from detail values like "1284B" or plain numbers. */
function parseBytes(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}
