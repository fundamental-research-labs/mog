/**
 * Package Registry Service
 *
 * Instance-owned registry for app and plugin packages. Each shell host
 * creates its own PackageRegistryService; there is no shared global state.
 *
 */

import type {
  AppManifest,
  AppLoader,
  PackageState,
  PackageSource,
  PackageInstallationRecord,
  ValidationResult,
  RuntimeHostMode,
} from './types';
import { validateAppManifest } from './validation';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PackageRegistryEntry {
  readonly packageId: string;
  readonly manifest: AppManifest;
  readonly loader: AppLoader;
  readonly installationRecord: PackageInstallationRecord;
  readonly state: PackageState;
  readonly runtimeHost: RuntimeHostMode;
}

export interface EnableResult {
  readonly success: boolean;
  readonly issues?: readonly { path: string; message: string; severity: string }[];
}

export interface PackageRegistrySnapshot {
  readonly entries: readonly PackageRegistryEntry[];
  readonly timestamp: number;
}

export interface IPackageRegistryService {
  // Registration
  registerBuiltInPackage(manifest: AppManifest, loader: AppLoader): void;
  registerLocalDevPackage(manifest: AppManifest, loader: AppLoader): void;

  // Queries
  getPackage(packageId: string): PackageRegistryEntry | undefined;
  listPackages(): readonly PackageRegistryEntry[];
  getPackageState(packageId: string): PackageState;

  // State transitions
  enablePackage(packageId: string): EnableResult;
  disablePackage(packageId: string): void;

  // Validation
  validateCompatibility(manifest: AppManifest): ValidationResult;

  // Snapshot for testing/diagnostics
  snapshot(): PackageRegistrySnapshot;
}

// ---------------------------------------------------------------------------
// Internal mutable entry
// ---------------------------------------------------------------------------

interface MutablePackageEntry {
  packageId: string;
  manifest: AppManifest;
  loader: AppLoader;
  installationRecord: PackageInstallationRecord;
  state: PackageState;
  runtimeHost: RuntimeHostMode;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PackageRegistryService implements IPackageRegistryService {
  private readonly entries = new Map<string, MutablePackageEntry>();

  // ---- Registration -------------------------------------------------------

  registerBuiltInPackage(manifest: AppManifest, loader: AppLoader): void {
    this.registerPackage(manifest, loader, 'built-in', 'same-realm-first-party');
  }

  registerLocalDevPackage(manifest: AppManifest, loader: AppLoader): void {
    this.registerPackage(manifest, loader, 'local-dev', 'same-realm-first-party');
  }

  private registerPackage(
    manifest: AppManifest,
    loader: AppLoader,
    source: PackageSource,
    runtimeHost: RuntimeHostMode,
  ): void {
    const packageId = String(manifest.id);

    // Structural validation
    const validation = validateAppManifest(manifest);
    if (!validation.valid) {
      const messages = validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid manifest for package '${packageId}': ${messages}`);
    }

    // Duplicate check
    if (this.entries.has(packageId)) {
      throw new Error(`Package '${packageId}' is already registered`);
    }

    const installationRecord: PackageInstallationRecord = {
      packageId,
      version: manifest.version,
      source,
      installedAt: Date.now(),
    };

    this.entries.set(packageId, {
      packageId,
      manifest,
      loader,
      installationRecord,
      state: 'installed',
      runtimeHost,
    });
  }

  // ---- Queries ------------------------------------------------------------

  getPackage(packageId: string): PackageRegistryEntry | undefined {
    const entry = this.entries.get(packageId);
    return entry ? this.freeze(entry) : undefined;
  }

  listPackages(): readonly PackageRegistryEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => a.packageId.localeCompare(b.packageId))
      .map((e) => this.freeze(e));
  }

  getPackageState(packageId: string): PackageState {
    const entry = this.entries.get(packageId);
    if (!entry) {
      throw new Error(`Package '${packageId}' is not registered`);
    }
    return entry.state;
  }

  // ---- State transitions --------------------------------------------------

  enablePackage(packageId: string): EnableResult {
    const entry = this.entries.get(packageId);
    if (!entry) {
      return {
        success: false,
        issues: [
          {
            path: 'packageId',
            message: `Package '${packageId}' is not registered`,
            severity: 'error',
          },
        ],
      };
    }

    // only same-realm-first-party is supported
    if (entry.runtimeHost !== 'same-realm-first-party') {
      entry.state = 'incompatible';
      return {
        success: false,
        issues: [
          {
            path: 'runtimeHost',
            message: `Runtime host '${entry.runtimeHost}' is not supported in current implementation`,
            severity: 'error',
          },
        ],
      };
    }

    // Compatibility validation
    const compat = this.validateCompatibility(entry.manifest);
    if (!compat.valid) {
      entry.state = 'incompatible';
      return {
        success: false,
        issues: compat.issues,
      };
    }

    entry.state = 'enabled';
    return { success: true };
  }

  disablePackage(packageId: string): void {
    const entry = this.entries.get(packageId);
    if (!entry) {
      throw new Error(`Package '${packageId}' is not registered`);
    }
    entry.state = 'disabled';
  }

  // ---- Validation ---------------------------------------------------------

  validateCompatibility(manifest: AppManifest): ValidationResult {
    // Structural validation is the baseline; more checks can be added later
    // (e.g., host API semver range, compatibility profiles)
    return validateAppManifest(manifest);
  }

  // ---- Snapshot -----------------------------------------------------------

  snapshot(): PackageRegistrySnapshot {
    return {
      entries: this.listPackages(),
      timestamp: Date.now(),
    };
  }

  // ---- Internal -----------------------------------------------------------

  private freeze(entry: MutablePackageEntry): PackageRegistryEntry {
    return {
      packageId: entry.packageId,
      manifest: entry.manifest,
      loader: entry.loader,
      installationRecord: entry.installationRecord,
      state: entry.state,
      runtimeHost: entry.runtimeHost,
    };
  }
}
