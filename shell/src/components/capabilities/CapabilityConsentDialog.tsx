/**
 * CapabilityConsentDialog - Permission consent dialog
 *
 * Beautiful, clear consent dialog that shows:
 * - App name and icon
 * - Lists required capabilities with descriptions
 * - Lists optional capabilities (user can toggle)
 * - Risk level indicators (Low/Medium/High/Critical)
 * - "Allow" and "Deny" buttons
 * - "Remember my choice" checkbox
 * - Special warning styling for sensitive capabilities
 *
 */

import React, { useCallback, useMemo, useState } from 'react';

import { CAPABILITY_REGISTRY, getCapabilityInfo } from '@mog-sdk/kernel/security';
import type {
  AppManifestWithCapabilities,
  CapabilityInfo,
  CapabilityType,
} from '@mog-sdk/contracts/capabilities';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/radix/Checkbox';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/radix/Dialog';
import { CapabilityItem } from './CapabilityItem';

// =============================================================================
// Types
// =============================================================================

export interface ConsentDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog should close */
  onClose: () => void;
  /** The app requesting capabilities */
  appManifest: AppManifestWithCapabilities;
  /** Required capabilities (app won't launch without these) */
  requiredCapabilities: readonly CapabilityInfo[];
  /** Optional capabilities (app works without, user can toggle) */
  optionalCapabilities: ReadonlyArray<{
    info: CapabilityInfo;
    capability: CapabilityType;
    reason: string;
  }>;
  /** Called when user allows the capabilities */
  onAllow: (grantedCapabilities: CapabilityType[]) => void;
  /** Called when user denies */
  onDeny: () => void;
  /** Whether this is a runtime request (vs launch-time) */
  isRuntimeRequest?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if any capabilities are sensitive (critical risk).
 */
function hasSensitiveCapabilities(capabilities: readonly CapabilityInfo[]): boolean {
  return capabilities.some((cap) => cap.riskLevel === 'critical' || cap.requiresAuth === true);
}

/**
 * Get capability type from info.
 */
function findCapabilityType(info: CapabilityInfo): CapabilityType {
  for (const [type, capInfo] of Object.entries(CAPABILITY_REGISTRY)) {
    if (capInfo.name === info.name && capInfo.description === info.description) {
      return type as CapabilityType;
    }
  }
  // Fallback - should not happen in practice
  return 'cells:read' as CapabilityType;
}

// =============================================================================
// Component
// =============================================================================

/**
 * CapabilityConsentDialog - Permission consent dialog.
 *
 * @example
 * ```tsx
 * <CapabilityConsentDialog
 *   open={showConsent}
 *   onClose={() => setShowConsent(false)}
 *   appManifest={manifest}
 *   requiredCapabilities={required}
 *   optionalCapabilities={optional}
 *   onAllow={handleAllow}
 *   onDeny={handleDeny}
 * />
 * ```
 */
export function CapabilityConsentDialog({
  open,
  onClose,
  appManifest,
  requiredCapabilities,
  optionalCapabilities,
  onAllow,
  onDeny,
  isRuntimeRequest = false,
}: ConsentDialogProps): React.JSX.Element {
  // Track which optional capabilities are selected
  const [selectedOptional, setSelectedOptional] = useState<Set<CapabilityType>>(
    () => new Set(optionalCapabilities.map((o) => o.capability)),
  );
  const [rememberChoice, setRememberChoice] = useState(true);

  // Check for sensitive capabilities
  const hasSensitive = useMemo(
    () => hasSensitiveCapabilities(requiredCapabilities),
    [requiredCapabilities],
  );

  // Handle optional capability toggle
  const handleOptionalToggle = useCallback((capability: CapabilityType, selected: boolean) => {
    setSelectedOptional((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(capability);
      } else {
        next.delete(capability);
      }
      return next;
    });
  }, []);

  // Handle allow button
  const handleAllow = useCallback(() => {
    const granted: CapabilityType[] = [];

    // Add all required capabilities
    for (const info of requiredCapabilities) {
      granted.push(findCapabilityType(info));
    }

    // Add selected optional capabilities
    for (const cap of selectedOptional) {
      granted.push(cap);
    }

    onAllow(granted);
    onClose();
  }, [requiredCapabilities, selectedOptional, onAllow, onClose]);

  // Handle deny button
  const handleDeny = useCallback(() => {
    onDeny();
    onClose();
  }, [onDeny, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width="lg">
      <DialogHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          {/* App icon */}
          {appManifest.icon && (
            <div className="w-10 h-10 rounded-ss-md bg-ss-surface-secondary flex items-center justify-center text-2xl">
              {appManifest.icon}
            </div>
          )}
          <div>
            <span className="font-semibold">{appManifest.name}</span>
            <span className="text-ss-text-secondary font-normal"> wants access</span>
          </div>
        </div>
      </DialogHeader>

      <DialogBody noPadding>
        <div className="max-h-[60vh] overflow-auto">
          {/* Warning banner for sensitive capabilities */}
          {hasSensitive && (
            <div className="px-5 py-3 bg-red-50 border-b border-red-200">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-red-100 rounded-full">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-red-800">Sensitive permissions requested</p>
                  <p className="text-body-sm text-red-600 mt-0.5">
                    This app is requesting access to sensitive data or actions. Only allow if you
                    trust this app.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Required capabilities section */}
          {requiredCapabilities.length > 0 && (
            <div className="p-5 border-b border-ss-border">
              <h3 className="text-body font-medium text-text mb-3 flex items-center gap-2">
                <span>Required permissions</span>
                <span className="text-caption text-ss-text-secondary font-normal">
                  ({requiredCapabilities.length})
                </span>
              </h3>
              <div className="space-y-2">
                {requiredCapabilities.map((info) => {
                  const capType = findCapabilityType(info);
                  return <CapabilityItem key={capType} capability={capType} compact />;
                })}
              </div>
              <p className="text-caption text-ss-text-tertiary mt-3">
                {isRuntimeRequest
                  ? 'This permission is required for the requested action.'
                  : 'The app cannot run without these permissions.'}
              </p>
            </div>
          )}

          {/* Optional capabilities section */}
          {optionalCapabilities.length > 0 && (
            <div className="p-5">
              <h3 className="text-body font-medium text-text mb-3 flex items-center gap-2">
                <span>Optional permissions</span>
                <span className="text-caption text-ss-text-secondary font-normal">
                  ({optionalCapabilities.length})
                </span>
              </h3>
              <div className="space-y-2">
                {optionalCapabilities.map(({ info: _info, capability, reason }) => (
                  <CapabilityItem
                    key={capability}
                    capability={capability}
                    reason={reason}
                    isOptional
                    isSelected={selectedOptional.has(capability)}
                    onSelectionChange={(selected) => handleOptionalToggle(capability, selected)}
                    compact
                  />
                ))}
              </div>
              <p className="text-caption text-ss-text-tertiary mt-3">
                These are optional. The app will work without them but some features may be limited.
              </p>
            </div>
          )}

          {/* About this app */}
          {appManifest.description && (
            <div className="px-5 py-3 bg-ss-surface-secondary border-t border-ss-border">
              <p className="text-caption text-ss-text-secondary">
                <span className="font-medium">About:</span> {appManifest.description}
              </p>
              {appManifest.author && (
                <p className="text-caption text-ss-text-tertiary mt-1">
                  By {appManifest.author} - v{appManifest.version}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <Checkbox
          checked={rememberChoice}
          onChange={setRememberChoice}
          label="Remember my choice"
          labelClassName="text-body-sm text-ss-text-secondary"
        />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleDeny}>
            Deny
          </Button>
          <Button variant={hasSensitive ? 'danger' : 'primary'} onClick={handleAllow}>
            {hasSensitive ? 'Allow Anyway' : 'Allow'}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Simplified Consent Dialog for Runtime Requests
// =============================================================================

export interface RuntimeConsentDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog closes */
  onClose: () => void;
  /** App name */
  appName: string;
  /** App icon */
  appIcon?: string;
  /** The capability being requested */
  capability: CapabilityType;
  /** User-facing reason */
  reason: string;
  /** Called when user allows */
  onAllow: () => void;
  /** Called when user denies */
  onDeny: () => void;
}

/**
 * RuntimeConsentDialog - Simplified dialog for single capability requests.
 */
export function RuntimeConsentDialog({
  open,
  onClose,
  appName,
  appIcon,
  capability,
  reason,
  onAllow,
  onDeny,
}: RuntimeConsentDialogProps): React.JSX.Element {
  const info = getCapabilityInfo(capability);
  const [rememberChoice, setRememberChoice] = useState(true);

  const handleAllow = useCallback(() => {
    onAllow();
    onClose();
  }, [onAllow, onClose]);

  const handleDeny = useCallback(() => {
    onDeny();
    onClose();
  }, [onDeny, onClose]);

  const isSensitive = info.riskLevel === 'critical' || info.requiresAuth === true;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width="md">
      <DialogHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          {appIcon && (
            <div className="w-8 h-8 rounded-ss-md bg-ss-surface-secondary flex items-center justify-center text-xl">
              {appIcon}
            </div>
          )}
          <span className="font-semibold">{appName}</span>
        </div>
      </DialogHeader>

      <DialogBody>
        {isSensitive && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-ss-md">
            <div className="flex items-center gap-2 text-red-800">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="font-medium">Sensitive permission</span>
            </div>
          </div>
        )}

        <CapabilityItem capability={capability} reason={reason} />

        <p className="text-body-sm text-ss-text-secondary mt-4">
          {appName} is requesting this permission to {reason.toLowerCase()}.
        </p>
      </DialogBody>

      <DialogFooter layout="between">
        <Checkbox
          checked={rememberChoice}
          onChange={setRememberChoice}
          label="Remember my choice"
          labelClassName="text-body-sm text-ss-text-secondary"
        />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleDeny}>
            Deny
          </Button>
          <Button variant={isSensitive ? 'danger' : 'primary'} onClick={handleAllow}>
            Allow
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
