import type {
  AppId,
  AuditEventType,
  AuditQueryOptions,
  AuditStats,
  CapabilityAuditEntry,
  CapabilityType,
  ICapabilityAuditLog,
} from '@mog-sdk/kernel/security';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'granted',
  'revoked',
  'revoked-all',
  'used',
  'denied',
  'expired',
  'check-passed',
  'check-failed',
  'auto-granted',
  'auto-granted-migration',
];

export interface ShellCapabilityAuditOptions {
  readonly retentionMs?: number;
  readonly maxEntries?: number;
  readonly autoPrune?: boolean;
  readonly pruneIntervalMs?: number;
}

export interface ShellCapabilityAuditLog extends ICapabilityAuditLog {
  query(options?: AuditQueryOptions): readonly CapabilityAuditEntry[];
  getStats(): AuditStats;
  exportToJSON(options?: AuditQueryOptions): string;
  exportToCSV(options?: AuditQueryOptions): string;
  dispose(): void;
}

export class InMemoryShellCapabilityAuditLog implements ShellCapabilityAuditLog {
  private entries: CapabilityAuditEntry[] = [];
  private nextId = 1;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private pruneIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options?: ShellCapabilityAuditOptions) {
    this.retentionMs = options?.retentionMs ?? DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;

    if (options?.autoPrune ?? true) {
      this.pruneExpired();
      this.pruneIntervalId = setInterval(
        () => this.pruneExpired(),
        options?.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
      );
    }
  }

  log(entry: Omit<CapabilityAuditEntry, 'id' | 'timestamp'>): void {
    this.entries.push({
      ...entry,
      id: `audit-${this.nextId++}`,
      timestamp: Date.now(),
    });

    if (this.entries.length > this.maxEntries) {
      const targetSize = Math.floor(this.maxEntries * 0.9);
      this.entries.splice(0, this.entries.length - targetSize);
    }
  }

  query(options: AuditQueryOptions = {}): readonly CapabilityAuditEntry[] {
    let filtered = [...this.entries];

    if (options.appId !== undefined) {
      filtered = filtered.filter((entry) => entry.appId === options.appId);
    }
    if (options.capability !== undefined) {
      filtered = filtered.filter((entry) => entry.capability === options.capability);
    }
    if (options.eventTypes && options.eventTypes.length > 0) {
      const eventTypes = new Set(options.eventTypes);
      filtered = filtered.filter((entry) => eventTypes.has(entry.eventType));
    }
    if (options.since !== undefined) {
      filtered = filtered.filter((entry) => entry.timestamp >= options.since!);
    }
    if (options.until !== undefined) {
      filtered = filtered.filter((entry) => entry.timestamp <= options.until!);
    }
    if (options.operation !== undefined) {
      filtered = filtered.filter((entry) => entry.operation === options.operation);
    }
    if (options.resourceType !== undefined) {
      filtered = filtered.filter((entry) => entry.resourceType === options.resourceType);
    }
    if (options.resourceId !== undefined) {
      filtered = filtered.filter((entry) => entry.resourceId === options.resourceId);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    const offset = options.offset ?? 0;
    const limit = options.limit ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  getEntries(
    appId: AppId,
    options?: {
      limit?: number;
      offset?: number;
      eventTypes?: AuditEventType[];
      since?: number;
    },
  ): readonly CapabilityAuditEntry[] {
    return this.query({ appId, ...options });
  }

  getAllEntries(options?: {
    limit?: number;
    offset?: number;
    eventTypes?: AuditEventType[];
    since?: number;
  }): readonly CapabilityAuditEntry[] {
    return this.query(options ?? {});
  }

  prune(olderThan: number): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.timestamp >= olderThan);
    return before - this.entries.length;
  }

  pruneExpired(): number {
    return this.prune(Date.now() - this.retentionMs);
  }

  clear(): void {
    this.entries = [];
  }

  getStats(): AuditStats {
    const byEventType = Object.fromEntries(
      AUDIT_EVENT_TYPES.map((eventType) => [eventType, 0]),
    ) as Record<AuditEventType, number>;
    const byApp = new Map<AppId, number>();
    const byCapability = new Map<CapabilityType, number>();
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    let denialCount = 0;

    for (const entry of this.entries) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;
      byApp.set(entry.appId, (byApp.get(entry.appId) ?? 0) + 1);
      byCapability.set(entry.capability, (byCapability.get(entry.capability) ?? 0) + 1);
      oldestTimestamp =
        oldestTimestamp === null ? entry.timestamp : Math.min(oldestTimestamp, entry.timestamp);
      newestTimestamp =
        newestTimestamp === null ? entry.timestamp : Math.max(newestTimestamp, entry.timestamp);
      if (entry.eventType === 'denied') denialCount++;
    }

    return {
      totalEntries: this.entries.length,
      byEventType,
      byApp,
      byCapability,
      oldestTimestamp,
      newestTimestamp,
      denialCount,
      estimatedSizeBytes: this.entries.length * 200,
    };
  }

  exportToJSON(options?: AuditQueryOptions): string {
    return JSON.stringify(options ? this.query(options) : this.entries, null, 2);
  }

  exportToCSV(options?: AuditQueryOptions): string {
    const entries = (options ? this.query(options) : [...this.entries])
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    const rows = entries.map((entry) =>
      [
        entry.id,
        String(entry.timestamp),
        new Date(entry.timestamp).toISOString(),
        entry.appId,
        entry.capability,
        entry.eventType,
        entry.operation ?? '',
        entry.resourceType ?? '',
        entry.resourceId ?? '',
        entry.metadata ? JSON.stringify(entry.metadata) : '',
      ]
        .map(escapeCsv)
        .join(','),
    );

    return [
      'id,timestamp,datetime,appId,capability,eventType,operation,resourceType,resourceId,metadata',
      ...rows,
    ].join('\n');
  }

  dispose(): void {
    if (this.pruneIntervalId !== null) {
      clearInterval(this.pruneIntervalId);
      this.pruneIntervalId = null;
    }
  }
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function createShellCapabilityAuditLog(
  options?: ShellCapabilityAuditOptions,
): ShellCapabilityAuditLog {
  return new InMemoryShellCapabilityAuditLog(options);
}
