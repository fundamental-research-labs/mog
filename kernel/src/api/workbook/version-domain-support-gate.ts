import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import {
  validateDomainSupportManifest,
  type DomainSupportManifestDiagnostic,
  type DomainSupportManifestValidationOptions,
} from '../../document/version-store/domain-support-manifest-validator';
import {
  isMaterializableMergeDomainReference,
  unsupportedDetectedMergeDomainDiagnostic,
} from './version-merge-materializer-support';

type MaybePromise<T> = T | Promise<T>;
type VersionDomainSupportManifestGateOperation =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'export';

type MaybeDomainSupportManifestContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedDomainSupportManifestGate = {
  readonly hasManifestSource: boolean;
  readonly manifest?: unknown;
  readonly readManifest?: () => MaybePromise<unknown>;
  readonly options?: DomainSupportManifestValidationOptions;
};

export async function validateVersionDomainSupportManifestGate(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const gate = getAttachedDomainSupportManifestGate(ctx);
  if (!gate) {
    return isVersionDomainSupportManifestRequired(ctx, operation)
      ? [domainSupportManifestMissingDiagnostic(operation)]
      : [];
  }

  let manifest: unknown;
  if (gate.readManifest) {
    try {
      manifest = await gate.readManifest();
    } catch {
      return [domainSupportManifestReadFailedDiagnostic(operation)];
    }
  } else if (gate.hasManifestSource) {
    manifest = gate.manifest;
  }

  if (manifest === undefined || manifest === null) {
    return [domainSupportManifestMissingDiagnostic(operation)];
  }

  const {
    domainPolicyRegistry: callerDomainPolicyRegistry,
    requiredCapabilityKeys: _ignoredCallerCapabilityKeys,
    ...callerOptions
  } = gate.options ?? {};
  const options: DomainSupportManifestValidationOptions = {
    ...callerOptions,
    domainPolicyRegistry:
      operation === 'export' && callerDomainPolicyRegistry
        ? callerDomainPolicyRegistry
        : PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
    now: gate.options?.now instanceof Date ? gate.options.now : new Date(),
    operation,
  };
  const validation = validateDomainSupportManifest(manifest, options);
  if (validation.ok) return mergeDetectedDomainDiagnostics(operation, options);

  return validation.diagnostics.map((diagnostic) =>
    domainSupportManifestInvalidDiagnostic(operation, diagnostic),
  );
}

function mergeDetectedDomainDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  options: DomainSupportManifestValidationOptions | undefined,
): readonly VersionStoreDiagnostic[] {
  if (operation !== 'merge' && operation !== 'applyMerge') return [];
  if (!Array.isArray(options?.detectorRows)) return [];

  const diagnostics: VersionStoreDiagnostic[] = [];
  options.detectorRows.forEach((row, itemIndex) => {
    if (!row.present) return;
    if (!isMaterializableMergeDomainReference(row)) {
      diagnostics.push(unsupportedDetectedMergeDomainDiagnostic(operation, itemIndex, row));
    }
  });
  return diagnostics;
}

function getAttachedDomainSupportManifestGate(
  ctx: DocumentContext,
): AttachedDomainSupportManifestGate | null {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  for (const candidate of [runtime.versioning, runtime.versionStore, runtime.version, ctx]) {
    const gate = gateFromRecord(candidate);
    if (gate) return gate;
  }
  return null;
}

function isVersionDomainSupportManifestRequired(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): boolean {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return false;

  switch (operation) {
    case 'commit':
      return hasCommitService(services);
    case 'checkout':
      return hasCheckoutService(services);
    case 'merge':
      return hasMergeService(services);
    case 'applyMerge':
      return hasApplyMergeService(services) || hasMergeService(services);
    case 'export':
      return hasVersionOperationService(services);
  }
}

function hasVersionOperationService(services: Readonly<Record<string, unknown>>): boolean {
  if (
    hasCommitService(services) ||
    hasCheckoutService(services) ||
    hasMergeService(services) ||
    hasApplyMergeService(services)
  ) {
    return true;
  }

  for (const candidate of [
    services.provider,
    services.readService,
    services.refService,
    services.refsService,
    services.branchService,
    services.publicService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (isRawGraphStore(candidate)) return true;
    if (
      hasMethod(candidate, 'getHead') ||
      hasMethod(candidate, 'listCommits') ||
      hasMethod(candidate, 'listRefs') ||
      hasMethod(candidate, 'readCommit') ||
      hasMethod(candidate, 'readCommitClosure') ||
      hasMethod(candidate, 'getCommit')
    ) {
      return true;
    }
  }

  return false;
}

function hasCommitService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.writeService,
    services.commitService,
    services.versionWriteService,
    services.publicService,
    services.graphService,
    services,
  ]) {
    if (isRawGraphStore(candidate)) continue;
    if (hasMethod(candidate, 'commit') || hasMethod(candidate, 'commitVersion')) return true;
  }
  return false;
}

function hasCheckoutService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    if (hasMethod(candidate, 'planCheckout') || hasMethod(candidate, 'checkout')) return true;
  }
  return false;
}

function hasMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.mergeService,
    services.versionMergeService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (
      hasMethod(candidate, 'merge') ||
      hasMethod(candidate, 'mergeVersions') ||
      hasMethod(candidate, 'mergeCommits')
    ) {
      return true;
    }
  }
  return false;
}

function hasApplyMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
    services,
  ]) {
    if (
      hasMethod(candidate, 'mergeCommit') ||
      hasMethod(candidate, 'applyMerge') ||
      hasMethod(candidate, 'applyMergeVersion') ||
      hasMethod(candidate, 'applyMergeCommit') ||
      hasMethod(candidate, 'fastForwardMerge') ||
      hasMethod(candidate, 'fastForward') ||
      hasMethod(candidate, 'fastForwardApplyMerge') ||
      hasMethod(candidate, 'applyMergeFastForward') ||
      hasMethod(candidate, 'applyFastForwardMerge')
    ) {
      return true;
    }
  }
  return false;
}

function gateFromRecord(value: unknown): AttachedDomainSupportManifestGate | null {
  if (!isRecord(value)) return null;

  const hasManifestSource = Object.prototype.hasOwnProperty.call(value, 'domainSupportManifest');
  const readManifest =
    bindManifestReader(value, 'readDomainSupportManifest') ??
    bindManifestReader(value, 'getDomainSupportManifest');
  const required = value.requireDomainSupportManifest === true;

  if (!hasManifestSource && !readManifest && !required) return null;

  return {
    hasManifestSource,
    manifest: value.domainSupportManifest,
    ...(readManifest ? { readManifest } : {}),
    ...(isRecord(value.domainSupportManifestOptions)
      ? { options: value.domainSupportManifestOptions as DomainSupportManifestValidationOptions }
      : {}),
  };
}

function bindManifestReader(
  value: Readonly<Record<string, unknown>>,
  name: string,
): (() => MaybePromise<unknown>) | null {
  const method = value[name];
  if (typeof method !== 'function') return null;
  return () => Reflect.apply(method, value, []) as MaybePromise<unknown>;
}

function hasMethod(value: unknown, name: string): boolean {
  return isRecord(value) && typeof value[name] === 'function';
}

function isRawGraphStore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.commit === 'function' &&
    typeof value.initializeGraph === 'function' &&
    typeof value.readCommitClosure === 'function'
  );
}

function domainSupportManifestMissingDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
    'A required document domain support manifest is not attached for this durable version operation.',
    {},
  );
}

function domainSupportManifestReadFailedDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_READ_FAILED',
    'The document domain support manifest could not be read before the durable version operation.',
    {},
    'retry',
  );
}

function domainSupportManifestInvalidDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  diagnostic: DomainSupportManifestDiagnostic,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
    'The document domain support manifest is invalid for durable version operations.',
    {
      diagnosticCode: diagnostic.code,
      ...(diagnostic.matrixRowId ? { matrixRowId: diagnostic.matrixRowId } : {}),
      ...(diagnostic.domainId ? { domainId: diagnostic.domainId } : {}),
      ...(diagnostic.capabilityKey ? { capabilityKey: diagnostic.capabilityKey } : {}),
      ...(diagnostic.capabilityState ? { capabilityState: diagnostic.capabilityState } : {}),
      ...(diagnostic.policyField ? { policyField: diagnostic.policyField } : {}),
      ...(diagnostic.policyValue ? { policyValue: diagnostic.policyValue } : {}),
    },
  );
}

function publicDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  issueCode: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
  recoverability: VersionStoreDiagnostic['recoverability'] = 'none',
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability,
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: {
      operation,
      ...payload,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
