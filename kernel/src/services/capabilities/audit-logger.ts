/**
 * Capability Audit Logger
 *
 * Full implementation of ICapabilityAuditLog with:
 * - Comprehensive query methods
 * - Time-based and count-based retention
 * - Statistics
 * - Export to JSON and CSV
 *
 */

import type { CapabilityType } from './cap-types';
import type { AppId } from './grants';

import type { AuditEventType, CapabilityAuditEntry, ICapabilityAuditLog } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Default retention period: 30 days */
const DEFAULT_RETENTION_DAYS = 30;

/** Hard cap: 100,000 events */
const DEFAULT_MAX_ENTRIES = 100_000;

/** Prune interval: 1 hour */
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the audit logger.
 */
export interface AuditLoggerOptions {
  /** Retention period in milliseconds (default: 30 days) */
  readonly retentionMs?: number;

  /** Maximum number of entries (default: 100,000) */
  readonly maxEntries?: number;

  /** Enable automatic periodic pruning (default: true) */
  readonly autoPrune?: boolean;

  /** Prune interval in milliseconds (default: 1 hour) */
  readonly pruneIntervalMs?: number;
}

/**
 * Query options for filtering audit entries.
 */
export interface AuditQueryOptions {
  /** Filter by app ID */
  readonly appId?: AppId;
  /** Filter by capability */
  readonly capability?: CapabilityType;
  /** Filter by event types */
  readonly eventTypes?: readonly AuditEventType[];
  /** Filter entries since timestamp (Unix ms) */
  readonly since?: number;
  /** Filter entries until timestamp (Unix ms) */
  readonly until?: number;
  /** Filter by operation name */
  readonly operation?: string;
  /** Filter by resource type */
  readonly resourceType?: string;
  /** Filter by resource ID */
  readonly resourceId?: string;
  /** Maximum number of results (default: unlimited) */
  readonly limit?: number;
  /** Offset for pagination (default: 0) */
  readonly offset?: number;
}

/**
 * Statistics about audit log entries.
 */
export interface AuditStats {
  /** Total number of entries */
  readonly totalEntries: number;
  /** Count of entries by event type */
  readonly byEventType: Readonly<Record<AuditEventType, number>>;
  /** Count of entries by app (top N) */
  readonly byApp: ReadonlyMap<AppId, number>;
  /** Count of entries by capability (top N) */
  readonly byCapability: ReadonlyMap<CapabilityType, number>;
  /** Oldest entry timestamp */
  readonly oldestTimestamp: number | null;
  /** Newest entry timestamp */
  readonly newestTimestamp: number | null;
  /** Number of denials */
  readonly denialCount: number;
  /** Storage estimate in bytes */
  readonly estimatedSizeBytes: number;
}

// =============================================================================
// Capability Audit Logger
// =============================================================================

/**
 * In-memory capability audit logger.
 *
 * Stores audit entries in memory with automatic pruning based on:
 * - Time-based retention (default: 30 days)
 * - Hard cap (default: 100,000 entries)
 *
 * Features:
 * - Rich query methods with filtering
 * - Automatic periodic pruning
 * - Export to JSON and CSV
 * - Comprehensive statistics
 */
export class CapabilityAuditLogger implements ICapabilityAuditLog {
  private entries: CapabilityAuditEntry[] = [];
  private nextId = 1;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private pruneIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options?: AuditLoggerOptions) {
    this.retentionMs = options?.retentionMs ?? DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;

    // Set up automatic pruning if enabled
    const autoPrune = options?.autoPrune ?? true;
    const pruneIntervalMs = options?.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;

    if (autoPrune) {
      // Prune on startup
      this.pruneExpired();

      // Set up periodic pruning
      this.pruneIntervalId = setInterval(() => {
        this.pruneExpired();
      }, pruneIntervalMs);
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose of the audit logger, cleaning up intervals.
   */
  dispose(): void {
    if (this.pruneIntervalId !== null) {
      clearInterval(this.pruneIntervalId);
      this.pruneIntervalId = null;
    }
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  log(entry: Omit<CapabilityAuditEntry, 'id' | 'timestamp'>): void {
    const fullEntry: CapabilityAuditEntry = {
      ...entry,
      id: `audit-${this.nextId++}`,
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    // Prune if over hard cap
    if (this.entries.length > this.maxEntries) {
      // Remove oldest entries to get back to 90% of cap
      const targetSize = Math.floor(this.maxEntries * 0.9);
      const removeCount = this.entries.length - targetSize;
      this.entries.splice(0, removeCount);
    }
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Query audit entries with flexible filtering.
   */
  query(options: AuditQueryOptions = {}): readonly CapabilityAuditEntry[] {
    let filtered = [...this.entries];

    // Apply filters
    if (options.appId !== undefined) {
      filtered = filtered.filter((e) => e.appId === options.appId);
    }

    if (options.capability !== undefined) {
      filtered = filtered.filter((e) => e.capability === options.capability);
    }

    if (options.eventTypes && options.eventTypes.length > 0) {
      const types = new Set(options.eventTypes);
      filtered = filtered.filter((e) => types.has(e.eventType));
    }

    if (options.since !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= options.since!);
    }

    if (options.until !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= options.until!);
    }

    if (options.operation !== undefined) {
      filtered = filtered.filter((e) => e.operation === options.operation);
    }

    if (options.resourceType !== undefined) {
      filtered = filtered.filter((e) => e.resourceType === options.resourceType);
    }

    if (options.resourceId !== undefined) {
      filtered = filtered.filter((e) => e.resourceId === options.resourceId);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
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
    return this.query({
      appId,
      ...options,
    });
  }

  getAllEntries(options?: {
    limit?: number;
    offset?: number;
    eventTypes?: AuditEventType[];
    since?: number;
  }): readonly CapabilityAuditEntry[] {
    return this.query(options ?? {});
  }

  /**
   * Get audit entries for a specific app.
   */
  getByApp(appId: AppId, limit?: number): readonly CapabilityAuditEntry[] {
    return this.query({ appId, limit });
  }

  /**
   * Get audit entries for a specific capability.
   */
  getByCapability(capability: CapabilityType, limit?: number): readonly CapabilityAuditEntry[] {
    return this.query({ capability, limit });
  }

  /**
   * Get all denial events.
   */
  getDenials(since?: Date): readonly CapabilityAuditEntry[] {
    return this.query({
      eventTypes: ['denied'],
      since: since?.getTime(),
    });
  }

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  prune(olderThan: number): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.timestamp >= olderThan);
    return before - this.entries.length;
  }

  /**
   * Prune entries older than the retention period.
   * @returns Number of entries pruned
   */
  pruneExpired(): number {
    const cutoff = Date.now() - this.retentionMs;
    return this.prune(cutoff);
  }

  clear(): void {
    this.entries = [];
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  /**
   * Get the total number of entries.
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Get the count of entries by event type.
   */
  getCountByType(): Record<AuditEventType, number> {
    const counts: Record<string, number> = {};
    for (const entry of this.entries) {
      counts[entry.eventType] = (counts[entry.eventType] ?? 0) + 1;
    }
    return counts as Record<AuditEventType, number>;
  }

  /**
   * Get the count of entries by app.
   */
  getCountByApp(): Map<AppId, number> {
    const counts = new Map<AppId, number>();
    for (const entry of this.entries) {
      counts.set(entry.appId, (counts.get(entry.appId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Get comprehensive statistics about the audit log.
   */
  getStats(): AuditStats {
    const byEventType = this.getCountByType();
    const byApp = this.getCountByApp();
    const byCapability = new Map<CapabilityType, number>();

    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    let denialCount = 0;

    for (const entry of this.entries) {
      // Track capability counts
      byCapability.set(entry.capability, (byCapability.get(entry.capability) ?? 0) + 1);

      // Track timestamps
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (newestTimestamp === null || entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }

      // Count denials
      if (entry.eventType === 'denied') {
        denialCount++;
      }
    }

    // Estimate storage size (rough calculation)
    const estimatedSizeBytes = this.entries.length * 200; // ~200 bytes per entry

    return {
      totalEntries: this.entries.length,
      byEventType,
      byApp,
      byCapability,
      oldestTimestamp,
      newestTimestamp,
      denialCount,
      estimatedSizeBytes,
    };
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  /**
   * Export audit log entries to JSON.
   * @param options Optional query options to filter exported entries
   */
  exportToJSON(options?: AuditQueryOptions): string {
    const entries = options ? this.query(options) : this.entries;
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Export audit log entries to CSV.
   * @param options Optional query options to filter exported entries
   */
  exportToCSV(options?: AuditQueryOptions): string {
    const entries = options ? this.query(options) : [...this.entries];

    // Sort by timestamp ascending for CSV export (chronological order)
    const sortedEntries = entries.slice().sort((a, b) => a.timestamp - b.timestamp);

    // CSV header
    const headers = [
      'id',
      'timestamp',
      'datetime',
      'appId',
      'capability',
      'eventType',
      'operation',
      'resourceType',
      'resourceId',
      'metadata',
    ];

    // Build CSV rows
    const rows = sortedEntries.map((entry) => {
      const datetime = new Date(entry.timestamp).toISOString();
      return [
        escapeCSV(entry.id),
        String(entry.timestamp),
        datetime,
        escapeCSV(entry.appId),
        escapeCSV(entry.capability),
        escapeCSV(entry.eventType),
        escapeCSV(entry.operation ?? ''),
        escapeCSV(entry.resourceType ?? ''),
        escapeCSV(entry.resourceId ?? ''),
        escapeCSV(entry.metadata ? JSON.stringify(entry.metadata) : ''),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Escape a value for CSV output.
 */
function escapeCSV(value: string): string {
  // If value contains comma, quotes, or newlines, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new capability audit logger.
 */
export function createCapabilityAuditLogger(options?: AuditLoggerOptions): CapabilityAuditLogger {
  return new CapabilityAuditLogger(options);
}
