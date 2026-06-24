import type {
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getVersionMergeCapabilityDecision,
  versionMergeCapabilityDisabledDiagnostic,
} from './version/merge/version-merge-capability';
import { publicMergeBaseGateResult } from './version-merge-base-gate';
import { validateVersionDomainSupportManifestGate } from './version/domain-support/version-domain-support-gate';
import { blockedMergeResult, mapMergeResult } from './version/merge/version-merge-result-mapping';
import {
  mergeUnavailableDiagnostic,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-merge-public-diagnostics';
import { validateMergeRequest } from './version-merge-validation';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionMergeService = {
  merge: (input: VersionMergeInput, options?: VersionMergeOptions) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly mergeService?: unknown;
  readonly versionMergeService?: unknown;
  readonly publicService?: unknown;
  readonly readService?: unknown;
  readonly graphService?: unknown;
  readonly graphStore?: unknown;
  readonly graph?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export async function mergeWorkbookVersion(
  ctx: DocumentContext,
  input: VersionMergeInput,
  options: VersionMergeOptions = {},
): Promise<VersionMergeResult> {
  const capability = getVersionMergeCapabilityDecision(ctx, 'version:mergePreview');
  if (!capability.enabled) {
    return blockedMergeResult(null, null, null, [
      versionMergeCapabilityDisabledDiagnostic('merge', capability),
    ]);
  }

  const validated = validateMergeRequest(input, options);
  if (!validated.ok) {
    return blockedMergeResult(
      validated.base,
      validated.ours,
      validated.theirs,
      validated.diagnostics,
    );
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'merge');
  if (gateDiagnostics.length > 0) {
    return blockedMergeResult(
      validated.input.base,
      validated.input.ours,
      validated.input.theirs,
      gateDiagnostics,
    );
  }

  const services = getAttachedVersionServices(ctx);
  if (!services) {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      serviceUnavailableDiagnostic(),
    ]);
  }

  const mergeService = getAttachedVersionMergeService(services);
  if (!mergeService) {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      mergeUnavailableDiagnostic(),
    ]);
  }

  const mergeBaseGateResult = await publicMergeBaseGateResult(services, validated.input);
  if (mergeBaseGateResult) return mergeBaseGateResult;

  try {
    const result = await mergeService.merge(validated.input, validated.options);
    return mapMergeResult(result, validated.input);
  } catch {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      providerErrorDiagnostic(),
    ]);
  }
}

export function hasAttachedVersionMergeService(ctx: DocumentContext): boolean {
  const services = getAttachedVersionServices(ctx);
  return Boolean(services && getAttachedVersionMergeService(services));
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedVersionMergeService(
  services: AttachedVersionServices,
): AttachedVersionMergeService | null {
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
    const mergeService = toMergeService(candidate);
    if (mergeService) return mergeService;
  }

  return null;
}

function toMergeService(value: unknown): AttachedVersionMergeService | null {
  const merge =
    bindMethod(value, 'merge') ??
    bindMethod(value, 'mergeVersions') ??
    bindMethod(value, 'mergeCommits');
  if (!merge) return null;

  return {
    merge: (input, options) => merge(input, options),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
