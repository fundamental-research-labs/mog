import type { DocumentContext } from '../../../../context';
import type {
  BoundMethod,
  MaybePromise,
  MaybeVersionRuntimeContext,
  PendingRemotePromotionServiceLike,
} from './remote-types';
import { isRecord } from './remote-utils';

export function hasAttachedPendingRemotePromotionService(ctx: DocumentContext): boolean {
  return getAttachedPendingRemotePromotionService(ctx) !== null;
}

export function getAttachedPendingRemotePromotionService(
  ctx: DocumentContext,
): PendingRemotePromotionServiceLike | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [services.pendingRemotePromotionService, services]) {
    const service = toPendingRemotePromotionService(candidate);
    if (service) return service;
  }
  return null;
}

function toPendingRemotePromotionService(value: unknown): PendingRemotePromotionServiceLike | null {
  const promotePendingRemoteSegments = bindMethod(value, 'promotePendingRemoteSegments');
  return promotePendingRemoteSegments
    ? { promotePendingRemoteSegments: () => promotePendingRemoteSegments() }
    : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
