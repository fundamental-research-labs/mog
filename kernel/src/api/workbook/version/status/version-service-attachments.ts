import type { DocumentContext } from '../../../../context';

type MaybePromise<T> = T | Promise<T>;

type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionReadService = {
  readHead?: () => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
};

export type AttachedVersionServices = AttachedVersionReadService & {
  readonly objectStore?: unknown;
  readonly refStore?: unknown;
  readonly graphStore?: unknown;
  readonly graphService?: unknown;
  readonly graph?: unknown;
  readonly readService?: unknown;
  readonly headService?: unknown;
  readonly provenanceAdmissionService?: unknown;
  readonly provenanceTruthService?: unknown;
  readonly provenanceStatusService?: unknown;
};

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

export function getAttachedVersionReadService(
  ctx: DocumentContext,
): AttachedVersionReadService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.graphStore,
    services.graphService,
    services.graph,
    services.readService,
    services.headService,
    services,
  ]) {
    const readService = toReadService(candidate);
    if (readService) return readService;
  }

  return null;
}

export function hasCompleteVc09ProvenanceTruth(services: AttachedVersionServices | null): boolean {
  if (!services) return false;
  return [
    services.provenanceAdmissionService,
    services.provenanceTruthService,
    services.provenanceStatusService,
    services,
  ].some(hasExplicitCompleteVc09ProvenanceTruth);
}

function toReadService(value: unknown): AttachedVersionReadService | null {
  const readHead = bindMethod(value, 'readHead');
  const getHead = bindMethod(value, 'getHead');
  const readRef = bindMethod(value, 'readRef');

  if (!readHead && !getHead && !readRef) return null;

  const service: AttachedVersionReadService = {};
  if (readHead) service.readHead = () => readHead();
  if (getHead) service.getHead = () => getHead();
  if (readRef) service.readRef = (name) => readRef(name);
  return service;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function hasExplicitCompleteVc09ProvenanceTruth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.vc09ProvenanceTruthComplete === true ||
    value.completeVc09ProvenanceAdmission === true ||
    hasExplicitCompleteVc09ProvenanceTruth(value.vc09ProvenanceTruth) ||
    hasExplicitCompleteVc09ProvenanceTruth(value.provenanceAdmissionTruth)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
