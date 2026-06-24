import type { DocumentContext } from '../../../../context';
import { isRecord } from './version-refs-values';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionRefLifecycleService = {
  createBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readBranch?: (input: Readonly<Record<string, unknown>> | string) => MaybePromise<unknown>;
  listBranches?: (input?: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  fastForwardBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function getAttachedVersionRefLifecycleService(
  ctx: DocumentContext,
): AttachedVersionRefLifecycleService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.refLifecycleService,
    services.branchService,
    services.branchRefService,
    services.versionRefService,
    services.publicRefService,
    services.refService,
    services,
  ]) {
    const refService = toRefLifecycleService(candidate);
    if (refService) return refService;
  }

  return null;
}

function toRefLifecycleService(value: unknown): AttachedVersionRefLifecycleService | null {
  const createBranch = bindMethod(value, 'createBranch');
  const getHead = bindMethod(value, 'getHead');
  const readBranch = bindMethod(value, 'readBranch');
  const listBranches = bindMethod(value, 'listBranches');
  const fastForwardBranch =
    bindMethod(value, 'fastForwardBranch') ?? bindMethod(value, 'updateBranch');

  if (!createBranch && !getHead && !readBranch && !listBranches && !fastForwardBranch) {
    return null;
  }

  const service: AttachedVersionRefLifecycleService = {};
  if (createBranch) service.createBranch = (input) => createBranch(input);
  if (getHead) service.getHead = () => getHead();
  if (readBranch) service.readBranch = (input) => readBranch(input);
  if (listBranches) service.listBranches = (input) => listBranches(input);
  if (fastForwardBranch) service.fastForwardBranch = (input) => fastForwardBranch(input);
  return service;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
