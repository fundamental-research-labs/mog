/**
 * Extension Tabs
 *
 * Tab bar component for switching between installed extensions.
 * Shows extension icons, names, and status indicators.
 *
 * Uses Radix Tabs (via shell wrapper) for:
 * - Arrow Left/Right keyboard navigation between tabs
 * - Home/End to jump to first/last tab
 * - Proper ARIA tablist/tab/tabpanel semantics
 * - Roving tabindex for correct Tab key behavior
 *
 * @module extensions/components/ExtensionTabs
 */

import type { Tab } from '@mog/shell';
import { Tabs } from '@mog/shell';
import { useMemo } from 'react';

import type { ExtensionInstance, ExtensionLifecycleState } from '../types';

// =============================================================================
// Types
// =============================================================================

interface ExtensionTabsProps {
  /** List of extension instances to display */
  extensions: ExtensionInstance[];
  /** Currently active extension ID */
  activeExtensionId: string | null;
  /** Callback when an extension tab is clicked */
  onSelectExtension: (extensionId: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function getStatusColorClass(state: ExtensionLifecycleState): string {
  switch (state) {
    case 'ready':
      return 'bg-ss-success';
    case 'loading':
    case 'handshaking':
      return 'bg-ss-warning';
    case 'error':
      return 'bg-ss-error';
    case 'disconnected':
      return 'bg-ss-text-disabled';
    case 'idle':
    default:
      return 'bg-ss-border';
  }
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// =============================================================================
// Component
// =============================================================================

export function ExtensionTabs({
  extensions,
  activeExtensionId,
  onSelectExtension,
}: ExtensionTabsProps) {
  const tabs: Tab[] = useMemo(
    () =>
      extensions.map((ext) => {
        const statusColorClass = getStatusColorClass(ext.state);

        return {
          id: ext.manifest.id,
          label: (
            <>
              {/* Icon */}
              {ext.manifest.icon ? (
                <img
                  src={`${ext.baseUrl}${ext.manifest.icon.replace(/^\.\//, '')}`}
                  alt=""
                  className="w-4 h-4 rounded object-contain flex-shrink-0"
                  onError={(e) => {
                    // Hide broken images
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="w-4 h-4 rounded bg-ss-surface-hover flex items-center justify-center text-ribbon-compact font-semibold text-ss-text-secondary flex-shrink-0">
                  {getInitials(ext.manifest.name)}
                </span>
              )}

              {/* Name */}
              <span className="overflow-hidden text-ellipsis">{ext.manifest.name}</span>

              {/* Status dot */}
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColorClass}`}
                aria-label={`Status: ${ext.state}`}
              />
            </>
          ),
          title: `${ext.manifest.name} (${ext.state})`,
          className:
            'flex items-center gap-1.5 rounded-ss-md whitespace-nowrap min-w-0 data-[state=active]:bg-ss-surface data-[state=active]:shadow-ss-sm data-[state=inactive]:hover:bg-ss-surface-tertiary',
        };
      }),
    [extensions],
  );

  if (extensions.length === 0) {
    return (
      <div className="flex flex-row items-center gap-0.5 px-2 py-1 border-b border-ss-border-light bg-ss-surface-secondary overflow-x-auto min-h-[36px]">
        <div className="flex items-center justify-center px-4 py-2 text-ss-text-disabled text-caption italic">
          No extensions installed
        </div>
      </div>
    );
  }

  return (
    <Tabs
      tabs={tabs}
      activeTab={activeExtensionId ?? ''}
      onTabChange={onSelectExtension}
      className="flex-row items-center gap-0.5 px-2 py-1 border-ss-border-light bg-ss-surface-secondary overflow-x-auto min-h-[36px]"
      ariaLabel="Extensions"
      size="sm"
    />
  );
}
