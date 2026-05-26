/**
 * PermissionHistory - Audit log viewer for capability usage
 *
 * Shows capability audit log with:
 * - Filterable by app, capability, event type
 * - Time range selector
 * - Export buttons (JSON, CSV)
 * - Pagination for large logs
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AuditEventType,
  AuditQueryOptions,
  AuditStats,
  CapabilityAuditEntry,
  ICapabilityAuditLog,
} from '@mog-sdk/kernel/security';
import type { AppId, CapabilityType } from '@mog-sdk/contracts/capabilities';

import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { AuditLogEntry } from './AuditLogEntry';

// =============================================================================
// Types
// =============================================================================

export interface PermissionHistoryProps {
  /** The audit logger instance to query */
  auditLogger: ICapabilityAuditLog & {
    query(options?: AuditQueryOptions): readonly CapabilityAuditEntry[];
    getStats(): AuditStats;
    exportToJSON(options?: AuditQueryOptions): string;
    exportToCSV(options?: AuditQueryOptions): string;
  };
  /** Apps to show in filter (if not provided, extracted from log) */
  apps?: readonly AppId[];
  /** Capabilities to show in filter (if not provided, all capabilities shown) */
  capabilities?: readonly CapabilityType[];
  /** Maximum entries to show per page */
  pageSize?: number;
}

type TimeRange = 'all' | '1h' | '24h' | '7d' | '30d';

// =============================================================================
// Constants
// =============================================================================

const EVENT_TYPES: { value: AuditEventType; label: string }[] = [
  { value: 'granted', label: 'Granted' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'used', label: 'Used' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
  { value: 'auto-granted', label: 'Auto-granted' },
  { value: 'auto-granted-migration', label: 'Migration' },
  { value: 'check-passed', label: 'Check Passed' },
  { value: 'check-failed', label: 'Check Failed' },
  { value: 'revoked-all', label: 'Revoked All' },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: '1h', label: 'Last Hour' },
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert time range to milliseconds since.
 */
function getTimeSince(range: TimeRange): number | undefined {
  if (range === 'all') return undefined;

  const now = Date.now();
  switch (range) {
    case '1h':
      return now - 60 * 60 * 1000;
    case '24h':
      return now - 24 * 60 * 60 * 1000;
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

/**
 * Download a string as a file.
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// Component
// =============================================================================

/**
 * PermissionHistory - View and filter capability audit log.
 *
 * @example
 * ```tsx
 * const auditLogger = createCapabilityAuditLogger();
 *
 * <PermissionHistory
 *   auditLogger={auditLogger}
 *   pageSize={50}
 * />
 * ```
 */
export function PermissionHistory({
  auditLogger,
  apps,
  capabilities,
  pageSize = 50,
}: PermissionHistoryProps): React.JSX.Element {
  // Filter state
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [selectedCapability, setSelectedCapability] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  // Pagination state
  const [page, setPage] = useState(0);

  // Expanded entry state
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Build query options from filters
  const queryOptions = useMemo<AuditQueryOptions>(() => {
    const since = getTimeSince(timeRange);

    return {
      limit: pageSize,
      offset: page * pageSize,
      ...(selectedApp && { appId: selectedApp as AppId }),
      ...(selectedCapability && { capability: selectedCapability as CapabilityType }),
      ...(selectedEventType && { eventTypes: [selectedEventType as AuditEventType] }),
      ...(since !== undefined && { since }),
    };
  }, [selectedApp, selectedCapability, selectedEventType, timeRange, page, pageSize]);

  // Query entries
  const entries = useMemo(() => {
    return auditLogger.query(queryOptions);
  }, [auditLogger, queryOptions]);

  // Get stats for summary
  const stats = useMemo(() => {
    return auditLogger.getStats();
  }, [auditLogger]);

  // Get unique apps from stats
  const appOptions = useMemo(() => {
    if (apps) {
      return apps.map((a) => ({ value: a, label: a }));
    }
    return Array.from(stats.byApp.keys()).map((a) => ({ value: a, label: a }));
  }, [apps, stats.byApp]);

  // Get unique capabilities from stats
  const capabilityOptions = useMemo(() => {
    if (capabilities) {
      return capabilities.map((c) => ({ value: c, label: c }));
    }
    return Array.from(stats.byCapability.keys()).map((c) => ({ value: c, label: c }));
  }, [capabilities, stats.byCapability]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [selectedApp, selectedCapability, selectedEventType, timeRange]);

  // Export handlers
  const handleExportJSON = useCallback(() => {
    const content = auditLogger.exportToJSON(queryOptions);
    const filename = `permission-history-${new Date().toISOString().split('T')[0]}.json`;
    downloadFile(content, filename, 'application/json');
  }, [auditLogger, queryOptions]);

  const handleExportCSV = useCallback(() => {
    const content = auditLogger.exportToCSV(queryOptions);
    const filename = `permission-history-${new Date().toISOString().split('T')[0]}.csv`;
    downloadFile(content, filename, 'text/csv');
  }, [auditLogger, queryOptions]);

  // Toggle entry expansion
  const handleEntryClick = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Check if there are more entries
  const hasMore = entries.length === pageSize;
  const hasPrev = page > 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="text-caption text-ss-text-secondary">
          <span className="font-medium">{stats.totalEntries.toLocaleString()}</span> total entries
          {stats.denialCount > 0 && (
            <>
              {' '}
              &middot; <span className="text-red-600 font-medium">{stats.denialCount}</span> denials
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleExportJSON}>
            Export JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportCSV}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {/* Time range */}
        <div className="flex-1 min-w-[120px]">
          <Select
            size="sm"
            options={TIME_RANGES}
            value={timeRange}
            onChange={(value) => setTimeRange(value as TimeRange)}
          />
        </div>

        {/* App filter */}
        <div className="flex-1 min-w-[120px]">
          <Select
            size="sm"
            options={[{ value: '', label: 'All Apps' }, ...appOptions]}
            value={selectedApp}
            onChange={(value) => setSelectedApp(value)}
          />
        </div>

        {/* Event type filter */}
        <div className="flex-1 min-w-[120px]">
          <Select
            size="sm"
            options={[{ value: '', label: 'All Events' }, ...EVENT_TYPES]}
            value={selectedEventType}
            onChange={(value) => setSelectedEventType(value)}
          />
        </div>

        {/* Capability filter */}
        <div className="flex-1 min-w-[150px]">
          <Select
            size="sm"
            options={[{ value: '', label: 'All Capabilities' }, ...capabilityOptions]}
            value={selectedCapability}
            onChange={(value) => setSelectedCapability(value)}
          />
        </div>
      </div>

      {/* Entries list */}
      <div className="border border-ss-border rounded-ss-md bg-white overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-ss-surface-secondary flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9aa0a6"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-body-sm text-ss-text-secondary mb-1">No entries found</p>
            <p className="text-caption text-ss-text-tertiary">
              Try adjusting your filters or time range
            </p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-auto">
            {entries.map((entry) => (
              <AuditLogEntry
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onClick={() => handleEntryClick(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {(hasPrev || hasMore) && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={!hasPrev}
          >
            Previous
          </Button>
          <span className="text-caption text-ss-text-secondary">Page {page + 1}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
