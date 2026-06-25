import type { DocumentContext } from '../../../../context';
import type {
  BoundMethod,
  DeleteCapableVersionRefLifecycleService,
  MaybePromise,
} from './version-refs-delete-types';
import { isRecord, type MaybeVersionRuntimeContext } from './version-refs-delete-types';

export function getDeleteCapableVersionRefLifecycleService(
  ctx: DocumentContext,
): DeleteCapableVersionRefLifecycleService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.refLifecycleService,
    services.branchService,
    services.branchRefService,
    services.versionRefService,
    services.publicRefService,
    services.refService,
    services,
  ]) {
    const refService = toDeleteCapableVersionRefLifecycleService(candidate);
    if (refService) return refService;
  }

  return null;
}

export function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function toDeleteCapableVersionRefLifecycleService(
  value: unknown,
): DeleteCapableVersionRefLifecycleService | null {
  const deleteBranch = bindMethod(value, 'deleteBranch') ?? bindMethod(value, 'deleteRef');
  if (!deleteBranch) return null;
  const readBranch = bindMethod(value, 'readBranch');
  const listBranches = bindMethod(value, 'listBranches');
  const readRef = bindMethod(value, 'readRef');
  const getHead = bindMethod(value, 'getHead');
  const readHead = bindMethod(value, 'readHead');
  const readActiveCheckoutSession =
    bindMethod(value, 'readActiveCheckoutSession') ?? bindMethod(value, 'getActiveCheckoutSession');
  return {
    deleteBranch: (input) => deleteBranch(input),
    ...(readBranch ? { readBranch: (input) => readBranch(input) } : {}),
    ...(listBranches ? { listBranches: (input) => listBranches(input) } : {}),
    ...(readRef ? { readRef: (name) => readRef(name) } : {}),
    ...(getHead ? { getHead: () => getHead() } : {}),
    ...(readHead ? { readHead: () => readHead() } : {}),
    ...(readActiveCheckoutSession
      ? { readActiveCheckoutSession: () => readActiveCheckoutSession() }
      : {}),
  };
}

function getAttachedVersionServices(
  ctx: DocumentContext,
): Readonly<Record<string, unknown>> | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}
