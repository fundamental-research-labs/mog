import type { VersionRevertInput, VersionRevertOptions } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { isRecord, type MaybePromise } from './version-revert-provider-shape';

type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionRevertService = {
  readonly revert: (
    input: VersionRevertInput,
    options?: VersionRevertOptions,
  ) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly revertService?: unknown;
  readonly versionRevertService?: unknown;
  readonly publicService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
};

export function getAttachedVersionRevertService(
  ctx: DocumentContext,
): AttachedVersionRevertService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.revertService,
    services.versionRevertService,
    services.publicService,
    services.writeService,
    services.commitService,
    services,
  ]) {
    const service = toRevertService(candidate);
    if (service) return service;
  }

  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function toRevertService(value: unknown): AttachedVersionRevertService | null {
  const revert =
    bindMethod(value, 'revert') ??
    bindMethod(value, 'revertVersion') ??
    bindMethod(value, 'revertCommit') ??
    bindMethod(value, 'revertCommits');
  return revert ? { revert: (input, options) => revert(input, options) } : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
