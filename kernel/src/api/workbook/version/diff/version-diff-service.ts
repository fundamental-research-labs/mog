import type { DocumentContext } from '../../../../context';
import type {
  AttachedVersionDiffService,
  AttachedVersionServices,
  BoundMethod,
  MaybePromise,
} from './version-diff-types';
import { isRecord } from './version-diff-utils';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

export function getAttachedVersionDiffService(
  services: AttachedVersionServices,
): AttachedVersionDiffService | null {
  for (const candidate of [
    services.diffService,
    services.versionDiffService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    const diffService = toDiffService(candidate);
    if (diffService) return diffService;
  }
  return null;
}

function toDiffService(value: unknown): AttachedVersionDiffService | null {
  const diff =
    bindMethod(value, 'diff') ??
    bindMethod(value, 'diffVersions') ??
    bindMethod(value, 'diffCommits');
  if (!diff) return null;
  return {
    diff: (base, target, options) => diff(base, target, options),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
