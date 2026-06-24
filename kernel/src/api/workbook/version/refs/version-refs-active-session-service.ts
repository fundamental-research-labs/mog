import type { DocumentContext } from '../../../../context';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type ActiveCheckoutSessionReadableService = {
  readonly readActiveCheckoutSession?: () => MaybePromise<unknown>;
  readonly getActiveCheckoutSession?: () => MaybePromise<unknown>;
};

export function getActiveCheckoutSessionReader(
  ctx: DocumentContext,
  service: unknown,
): (() => MaybePromise<unknown>) | null {
  const serviceReader =
    bindMethod(service, 'readActiveCheckoutSession') ??
    bindMethod(service, 'getActiveCheckoutSession');
  if (serviceReader) return () => serviceReader();

  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services,
  ]) {
    const reader =
      bindMethod(candidate, 'readActiveCheckoutSession') ??
      bindMethod(candidate, 'getActiveCheckoutSession');
    if (reader) return () => reader();
  }
  return null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function getAttachedVersionServices(
  ctx: DocumentContext,
): Readonly<Record<string, unknown>> | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
