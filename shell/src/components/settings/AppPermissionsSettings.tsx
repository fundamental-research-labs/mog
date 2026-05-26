/**
 * AppPermissionsSettings - Settings panel for managing app permissions
 *
 * Features:
 * - List of installed apps
 * - Per-app capability list with toggles
 * - "Revoke All" button per app
 * - Shows last used timestamp per capability
 * - Link to audit log
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';
import { appId as createAppId, getCapabilityInfo, isFirstPartyApp } from '@mog-sdk/kernel/security';
import type {
  AppId,
  AppManifestWithCapabilities,
  CapabilityGrant,
  CapabilityType,
} from '@mog-sdk/contracts/capabilities';

import { RiskBadge } from '../capabilities/CapabilityItem';
import { Button } from '../ui/Button';
import { PermissionHistory, type PermissionHistoryProps } from './PermissionHistory';

// =============================================================================
// Types
// =============================================================================

export interface AppPermissionsSettingsProps {
  /** The capability registry */
  registry: ICapabilityRegistry;
  /** App manifests for display info */
  appManifests: ReadonlyMap<string, AppManifestWithCapabilities>;
  /** Optional audit logger for permission history */
  auditLogger?: PermissionHistoryProps['auditLogger'];
  /** Called when permissions change */
  onPermissionsChange?: () => void;
}

interface AppPermissionEntry {
  appId: string;
  manifest: AppManifestWithCapabilities | null;
  grants: readonly CapabilityGrant[];
  isFirstParty: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a timestamp as relative time.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  return 'Just now';
}

// =============================================================================
// App Permission Card
// =============================================================================

interface AppPermissionCardProps {
  entry: AppPermissionEntry;
  onRevokeCapability: (appId: AppId, capability: CapabilityType) => void;
  onRevokeAll: (appId: AppId) => void;
}

function AppPermissionCard({
  entry,
  onRevokeCapability,
  onRevokeAll,
}: AppPermissionCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const appIdObj = createAppId(entry.appId);

  const handleRevoke = useCallback(
    (capability: CapabilityType) => {
      onRevokeCapability(appIdObj, capability);
    },
    [appIdObj, onRevokeCapability],
  );

  const handleRevokeAll = useCallback(() => {
    if (window.confirm(`Revoke all permissions for ${entry.manifest?.name ?? entry.appId}?`)) {
      onRevokeAll(appIdObj);
    }
  }, [appIdObj, entry.appId, entry.manifest?.name, onRevokeAll]);

  const grantCount = entry.grants.length;
  const displayName = entry.manifest?.name ?? entry.appId;
  const icon = entry.manifest?.icon;

  return (
    <div className="border border-ss-border rounded-ss-md overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 hover:bg-ss-surface-hover transition-colors text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* App icon */}
        <div className="w-10 h-10 rounded-ss-md bg-ss-surface-secondary flex items-center justify-center text-xl flex-shrink-0">
          {icon ?? displayName.charAt(0).toUpperCase()}
        </div>

        {/* App info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text">{displayName}</span>
            {entry.isFirstParty && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-700 border border-green-200">
                First-party
              </span>
            )}
          </div>
          <p className="text-caption text-ss-text-secondary">
            {grantCount} permission{grantCount === 1 ? '' : 's'}
          </p>
        </div>

        {/* Expand indicator */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-ss-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-ss-border">
          {entry.grants.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-body-sm text-ss-text-secondary">
                No permissions granted to this app.
              </p>
            </div>
          ) : (
            <>
              {/* Permission list */}
              <div className="divide-y divide-ss-border-light">
                {entry.grants.map((grant) => {
                  const info = getCapabilityInfo(grant.capability);
                  return (
                    <div
                      key={grant.capability}
                      className="flex items-center justify-between p-3 hover:bg-ss-surface-hover"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-body-sm text-text">{info.name}</span>
                          <RiskBadge riskLevel={info.riskLevel} compact />
                          {grant.sessionOnly && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600">
                              Session
                            </span>
                          )}
                        </div>
                        <p className="text-caption text-ss-text-tertiary mt-0.5">
                          Granted {formatRelativeTime(grant.grantedAt)} via {grant.grantedBy}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(grant.capability)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        Revoke
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Footer with Revoke All */}
              <div className="p-3 bg-ss-surface-secondary border-t border-ss-border flex justify-end">
                <Button variant="danger" size="sm" onClick={handleRevokeAll}>
                  Revoke All
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * AppPermissionsSettings - Manage app permissions.
 *
 * @example
 * ```tsx
 * <AppPermissionsSettings
 *   registry={capabilityRegistry}
 *   appManifests={manifestsMap}
 *   auditLogger={auditLogger}
 * />
 * ```
 */
export function AppPermissionsSettings({
  registry,
  appManifests,
  auditLogger,
  onPermissionsChange,
}: AppPermissionsSettingsProps): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false);
  const [entries, setEntries] = useState<AppPermissionEntry[]>([]);

  // Build entries from registry
  const buildEntries = useCallback(() => {
    const appsWithGrants = new Set<string>();

    // Get all apps from manifests
    for (const [appId] of appManifests) {
      appsWithGrants.add(appId);
    }

    // Build entries
    const newEntries: AppPermissionEntry[] = [];
    for (const appId of appsWithGrants) {
      const appIdObj = createAppId(appId);
      const grants = registry.getGrants(appIdObj);
      const manifest = appManifests.get(appId) ?? null;

      newEntries.push({
        appId,
        manifest,
        grants,
        isFirstParty: isFirstPartyApp(appId),
      });
    }

    // Sort: first-party first, then by name
    newEntries.sort((a, b) => {
      if (a.isFirstParty !== b.isFirstParty) {
        return a.isFirstParty ? -1 : 1;
      }
      const nameA = a.manifest?.name ?? a.appId;
      const nameB = b.manifest?.name ?? b.appId;
      return nameA.localeCompare(nameB);
    });

    setEntries(newEntries);
  }, [appManifests, registry]);

  // Build entries on mount and when deps change
  useEffect(() => {
    buildEntries();
  }, [buildEntries]);

  // Subscribe to registry changes
  useEffect(() => {
    const unsubscribe = registry.subscribeToAll(() => {
      buildEntries();
      onPermissionsChange?.();
    });
    return unsubscribe;
  }, [registry, buildEntries, onPermissionsChange]);

  // Handle revoke capability
  const handleRevokeCapability = useCallback(
    (appId: AppId, capability: CapabilityType) => {
      registry.revoke(appId, capability);
    },
    [registry],
  );

  // Handle revoke all
  const handleRevokeAll = useCallback(
    (appId: AppId) => {
      registry.revokeAll(appId);
    },
    [registry],
  );

  // Count total grants
  const totalGrants = useMemo(
    () => entries.reduce((sum, e) => sum + e.grants.length, 0),
    [entries],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-body font-medium text-text">App Permissions</h3>
          <p className="text-caption text-ss-text-secondary mt-0.5">
            {entries.length} app{entries.length === 1 ? '' : 's'} with {totalGrants} permission
            {totalGrants === 1 ? '' : 's'}
          </p>
        </div>
        {auditLogger && (
          <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide History' : 'View History'}
          </Button>
        )}
      </div>

      {/* Permission History (if enabled) */}
      {showHistory && auditLogger && (
        <div className="border border-ss-border rounded-ss-md p-4">
          <h4 className="text-body-sm font-medium text-text mb-3">Permission History</h4>
          <PermissionHistory auditLogger={auditLogger} pageSize={20} />
        </div>
      )}

      {/* App list */}
      {entries.length === 0 ? (
        <div className="border border-ss-border rounded-ss-md p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-ss-surface-secondary flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9aa0a6"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p className="text-body-sm text-ss-text-secondary mb-1">No apps installed</p>
          <p className="text-caption text-ss-text-tertiary">
            Apps will appear here once you install them
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <AppPermissionCard
              key={entry.appId}
              entry={entry}
              onRevokeCapability={handleRevokeCapability}
              onRevokeAll={handleRevokeAll}
            />
          ))}
        </div>
      )}

      {/* Info section */}
      <div className="p-4 bg-ss-surface-secondary rounded-ss-md">
        <h4 className="text-body-sm font-medium text-text mb-2">About Permissions</h4>
        <ul className="space-y-1 text-caption text-ss-text-secondary list-disc list-inside">
          <li>First-party apps have their required permissions auto-granted on first launch</li>
          <li>You can revoke permissions at any time - the app may lose some functionality</li>
          <li>Sensitive permissions (critical risk) are highlighted in red</li>
          <li>Session-only permissions expire when you close the app</li>
        </ul>
      </div>
    </div>
  );
}

// =============================================================================
// Exports
// =============================================================================

export type { AppPermissionEntry };
