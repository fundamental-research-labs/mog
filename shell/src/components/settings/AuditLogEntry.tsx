/**
 * AuditLogEntry - Single audit entry display component
 *
 * Displays a single capability audit log entry with:
 * - Timestamp
 * - App ID
 * - Capability
 * - Event type with color coding
 * - Optional details (operation, resource, metadata)
 *
 * Color coding:
 * - granted/auto-granted: green
 * - denied: red
 * - revoked: orange
 * - used/check-passed: blue
 * - expired: gray
 * - check-failed: yellow
 *
 */

import React from 'react';

import type { AuditEventType, CapabilityAuditEntry } from '@mog-sdk/kernel/security';

// =============================================================================
// Types
// =============================================================================

export interface AuditLogEntryProps {
  /** The audit entry to display */
  entry: CapabilityAuditEntry;
  /** Whether to show expanded details */
  expanded?: boolean;
  /** Callback when entry is clicked */
  onClick?: () => void;
}

// =============================================================================
// Event Type Styling
// =============================================================================

interface EventStyle {
  bg: string;
  text: string;
  label: string;
}

const EVENT_STYLES: Record<AuditEventType, EventStyle> = {
  granted: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    label: 'Granted',
  },
  'auto-granted': {
    bg: 'bg-green-50',
    text: 'text-green-600',
    label: 'Auto-granted',
  },
  'auto-granted-migration': {
    bg: 'bg-green-50',
    text: 'text-green-600',
    label: 'Migration',
  },
  revoked: {
    bg: 'bg-orange-100',
    text: 'text-orange-700',
    label: 'Revoked',
  },
  'revoked-all': {
    bg: 'bg-orange-100',
    text: 'text-orange-700',
    label: 'Revoked All',
  },
  used: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    label: 'Used',
  },
  denied: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    label: 'Denied',
  },
  expired: {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    label: 'Expired',
  },
  'check-passed': {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    label: 'Check OK',
  },
  'check-failed': {
    bg: 'bg-yellow-100',
    text: 'text-yellow-700',
    label: 'Check Failed',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a timestamp to a human-readable string.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  // Less than 1 minute ago
  if (diff < 60 * 1000) {
    return 'Just now';
  }

  // Less than 1 hour ago
  if (diff < 60 * 60 * 1000) {
    const mins = Math.floor(diff / (60 * 1000));
    return `${mins}m ago`;
  }

  // Less than 24 hours ago
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }

  // Same year: show date without year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Different year: show full date
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format the full timestamp for tooltip.
 */
function formatFullTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

// =============================================================================
// Component
// =============================================================================

/**
 * AuditLogEntry - Display a single audit log entry.
 *
 * @example
 * ```tsx
 * <AuditLogEntry
 *   entry={{
 *     id: 'audit-1',
 *     timestamp: Date.now(),
 *     appId: 'spreadsheet' as AppId,
 *     capability: 'cells:write',
 *     eventType: 'granted',
 *   }}
 * />
 * ```
 */
export function AuditLogEntry({
  entry,
  expanded = false,
  onClick,
}: AuditLogEntryProps): React.JSX.Element {
  const style = EVENT_STYLES[entry.eventType];

  return (
    <div
      className={[
        'border-b border-ss-border last:border-b-0',
        'py-2 px-3',
        onClick ? 'cursor-pointer hover:bg-ss-surface-hover' : '',
        'transition-colors duration-ss-fast',
      ].join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Event type badge */}
        <span
          className={[
            'px-2 py-0.5 rounded text-caption font-medium',
            style.bg,
            style.text,
            'min-w-[72px] text-center',
          ].join(' ')}
        >
          {style.label}
        </span>

        {/* Capability */}
        <span className="text-body-sm font-mono text-ss-text">{entry.capability}</span>

        {/* App ID */}
        <span className="text-caption text-ss-text-tertiary">{entry.appId}</span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Timestamp */}
        <span
          className="text-caption text-ss-text-tertiary"
          title={formatFullTimestamp(entry.timestamp)}
        >
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pl-[84px] text-caption text-ss-text-secondary space-y-1">
          {entry.operation && (
            <div>
              <span className="text-ss-text-tertiary">Operation:</span>{' '}
              <span className="font-mono">{entry.operation}</span>
            </div>
          )}
          {entry.resourceType && (
            <div>
              <span className="text-ss-text-tertiary">Resource:</span>{' '}
              <span className="font-mono">
                {entry.resourceType}
                {entry.resourceId ? `:${entry.resourceId}` : ''}
              </span>
            </div>
          )}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div>
              <span className="text-ss-text-tertiary">Details:</span>{' '}
              <span className="font-mono">{JSON.stringify(entry.metadata)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
