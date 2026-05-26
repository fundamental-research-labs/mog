/**
 * App Launcher - Handles app launch with capability consent flow
 *
 * Responsible for:
 * 1. Checking required capabilities against grants
 * 2. Showing consent dialog for missing capabilities
 * 3. Blocking launch if user denies required capabilities
 * 4. Constructing gated API with granted capabilities
 *
 */

import {
  appId,
  expandCapabilities,
  getCapabilityInfo,
  isFirstPartyApp,
} from '@mog-sdk/kernel/security';
import type {
  AppId,
  AppManifestWithCapabilities,
  CapabilityInfo,
  CapabilityType,
  GrantOptions,
  IGatedAppKernelAPI,
} from '@mog-sdk/contracts/capabilities';

import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of launching an app.
 */
export interface AppLaunchResult {
  /** Whether the launch was successful */
  success: boolean;
  /** The gated API (if successful) */
  gatedApi?: IGatedAppKernelAPI;
  /**
   * Map of managed table names to their IDs.
   * @deprecated Table setup is now handled by AppLoader's setup flow via createManagedTables.
   * This field is no longer populated by launchApp.
   */
  managedTableIds?: Map<string, string>;
  /** Capabilities that were denied (if not successful) */
  deniedCapabilities?: CapabilityType[];
  /** Whether the app is a first-party trusted app */
  isFirstParty?: boolean;
  /** Error message (if not successful) */
  error?: string;
}

/**
 * Request for showing consent dialog.
 */
export interface ConsentRequest {
  /** The app manifest */
  appManifest: AppManifestWithCapabilities;
  /** Required capabilities that need consent */
  requiredCapabilities: CapabilityInfo[];
  /** Optional capabilities the app requests */
  optionalCapabilities: Array<{
    info: CapabilityInfo;
    capability: CapabilityType;
    reason: string;
  }>;
  /** Whether any capabilities are sensitive */
  hasSensitive: boolean;
}

/**
 * Result from consent dialog.
 */
export interface ConsentResult {
  /** User's decision */
  decision: 'allow' | 'deny' | 'cancel';
  /** Which capabilities were granted (for partial grants) */
  grantedCapabilities?: CapabilityType[];
  /** Whether to remember this decision */
  remember?: boolean;
}

/**
 * Callback to show consent dialog.
 */
export type ShowConsentDialogFn = (request: ConsentRequest) => Promise<ConsentResult>;

/**
 * Function to create the gated API.
 */
export type CreateGatedApiFn = (
  appId: AppId,
  capabilities: readonly CapabilityType[],
  options?: { managedTableIds?: ReadonlySet<string> },
) => IGatedAppKernelAPI;

/**
 * Options for launching an app.
 */
export interface LaunchAppOptions {
  /** The app manifest with capabilities */
  appManifest: AppManifestWithCapabilities;
  /** The capability registry */
  registry: ICapabilityRegistry;
  /** Function to show consent dialog */
  showConsentDialog: ShowConsentDialogFn;
  /** Function to create the gated API */
  createGatedApi: CreateGatedApiFn;
  /** Skip consent for first-party apps (auto-grant) */
  autoGrantFirstParty?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Set of trusted first-party app IDs.
 * These apps have required capabilities auto-granted on first launch.
 */
export const TRUSTED_FIRST_PARTY_APPS = new Set([
  'spreadsheet',
  'crm',
  'analytics',
  'finance',
  'bug-tracker',
  'form-builder',
]);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if an app is a trusted first-party app.
 */
function isTrustedFirstParty(appIdStr: string): boolean {
  return TRUSTED_FIRST_PARTY_APPS.has(appIdStr) || isFirstPartyApp(appIdStr);
}

/**
 * Get missing capabilities that need consent.
 */
function getMissingCapabilities(
  registry: ICapabilityRegistry,
  targetAppId: AppId,
  capabilities: readonly CapabilityType[],
): CapabilityType[] {
  const missing: CapabilityType[] = [];

  for (const cap of capabilities) {
    if (!registry.hasCapability(targetAppId, cap)) {
      missing.push(cap);
    }
  }

  return missing;
}

/**
 * Check if a capability is sensitive.
 */
function isSensitiveCapability(capability: CapabilityType): boolean {
  const info = getCapabilityInfo(capability);
  return info.riskLevel === 'critical' || info.requiresAuth === true;
}

// =============================================================================
// Main Launch Function
// =============================================================================

/**
 * Launch an app with capability consent flow.
 *
 * Flow:
 * 1. Expand all capabilities (including composites and dependencies)
 * 2. Check which capabilities the app already has
 * 3. If first-party app: auto-grant missing required capabilities
 * 4. If missing required: show consent dialog
 * 5. If user denies required: block launch
 * 6. Show optional capabilities (user can skip)
 * 7. Construct gated API with granted capabilities
 *
 * @param options - Launch options
 * @returns Launch result with gated API or error
 */
export async function launchApp(options: LaunchAppOptions): Promise<AppLaunchResult> {
  const {
    appManifest,
    registry,
    showConsentDialog,
    createGatedApi,
    autoGrantFirstParty = true,
  } = options;

  const targetAppId = appId(appManifest.id);
  const isFirstParty = isTrustedFirstParty(appManifest.id);

  // Step 1: Expand all required capabilities
  const expandedRequired = expandCapabilities(appManifest.capabilities.required);

  // Step 2: Check what's missing
  const missingRequired = getMissingCapabilities(registry, targetAppId, expandedRequired);

  // Step 3: Handle first-party apps
  if (isFirstParty && autoGrantFirstParty && missingRequired.length > 0) {
    // Auto-grant required capabilities for first-party apps
    console.log(
      `[LaunchApp] Auto-granting ${missingRequired.length} capabilities to first-party app "${appManifest.id}"`,
    );

    const grantOptions: GrantOptions = {
      source: 'auto',
    };

    registry.grantBatch(targetAppId, missingRequired, grantOptions);

    // After auto-grant, nothing should be missing
    const stillMissing = getMissingCapabilities(registry, targetAppId, expandedRequired);
    if (stillMissing.length > 0) {
      return {
        success: false,
        error: `Failed to auto-grant capabilities: ${stillMissing.join(', ')}`,
        deniedCapabilities: stillMissing,
        isFirstParty,
      };
    }
  }

  // Step 4: Check if we still need consent for required capabilities
  const needsConsent = getMissingCapabilities(registry, targetAppId, expandedRequired);

  if (needsConsent.length > 0) {
    // Build consent request
    const requiredInfos = needsConsent.map((cap) => getCapabilityInfo(cap));
    const hasSensitive = needsConsent.some(isSensitiveCapability);

    // Build optional capabilities info
    const optionalCapabilities: ConsentRequest['optionalCapabilities'] = [];
    if (appManifest.capabilities.optional) {
      for (const opt of appManifest.capabilities.optional) {
        const expandedOpt = expandCapabilities([opt.capability]);
        for (const cap of expandedOpt) {
          if (!registry.hasCapability(targetAppId, cap)) {
            optionalCapabilities.push({
              info: getCapabilityInfo(cap),
              capability: cap,
              reason: opt.reason,
            });
          }
        }
      }
    }

    const consentRequest: ConsentRequest = {
      appManifest,
      requiredCapabilities: requiredInfos,
      optionalCapabilities,
      hasSensitive,
    };

    // Show consent dialog
    const result = await showConsentDialog(consentRequest);

    if (result.decision === 'deny' || result.decision === 'cancel') {
      return {
        success: false,
        deniedCapabilities: needsConsent,
        isFirstParty,
        error: 'User denied required capabilities',
      };
    }

    // Grant the capabilities
    const toGrant = result.grantedCapabilities ?? needsConsent;
    const grantOptions: GrantOptions = {
      source: 'user',
    };

    registry.grantBatch(targetAppId, toGrant, grantOptions);

    // Verify all required are now granted
    const finalMissing = getMissingCapabilities(registry, targetAppId, expandedRequired);
    if (finalMissing.length > 0) {
      return {
        success: false,
        deniedCapabilities: finalMissing,
        isFirstParty,
        error: `Missing required capabilities: ${finalMissing.join(', ')}`,
      };
    }
  }

  // Step 5: Construct the gated API
  // Note: Table setup is now handled by AppLoader's setup flow via createManagedTables.
  // See the app data binding model for the new binding system.
  const effectiveCapabilities = registry.getEffectiveCapabilities(targetAppId);
  const gatedApi = createGatedApi(targetAppId, effectiveCapabilities);

  return {
    success: true,
    gatedApi,
    isFirstParty,
  };
}

// =============================================================================
// Check Launch Feasibility
// =============================================================================

/**
 * Check if an app can be launched without showing a consent dialog.
 *
 * Useful for UI to show "needs permission" badge.
 */
export function canLaunchWithoutConsent(
  registry: ICapabilityRegistry,
  appManifest: AppManifestWithCapabilities,
  autoGrantFirstParty = true,
): boolean {
  const targetAppId = appId(appManifest.id);
  const isFirstParty = isTrustedFirstParty(appManifest.id);

  if (isFirstParty && autoGrantFirstParty) {
    // First-party apps will auto-grant, so no consent needed
    return true;
  }

  const expandedRequired = expandCapabilities(appManifest.capabilities.required);
  const missing = getMissingCapabilities(registry, targetAppId, expandedRequired);

  return missing.length === 0;
}

/**
 * Get the capabilities that would require consent to launch an app.
 */
export function getCapabilitiesRequiringConsent(
  registry: ICapabilityRegistry,
  appManifest: AppManifestWithCapabilities,
): CapabilityType[] {
  const targetAppId = appId(appManifest.id);
  const expandedRequired = expandCapabilities(appManifest.capabilities.required);
  return getMissingCapabilities(registry, targetAppId, expandedRequired);
}
