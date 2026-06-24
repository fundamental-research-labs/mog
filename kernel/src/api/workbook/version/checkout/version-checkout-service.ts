import type { DocumentContext } from '../../../../context';
import type { CheckoutMaterializationRequest } from '../../../../document/version-store/checkout-service';
import { isRecord } from './version-checkout-shared';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedCheckoutMaterializationService = {
  planCheckout?: (request: CheckoutMaterializationRequest) => MaybePromise<unknown>;
  checkout?: (request: CheckoutMaterializationRequest) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function hasAttachedVersionCheckoutService(ctx: DocumentContext): boolean {
  return getAttachedCheckoutMaterializationService(ctx) !== null;
}

export function getAttachedCheckoutMaterializationService(
  ctx: DocumentContext,
): AttachedCheckoutMaterializationService | null {
  const services = getAttachedVersionRuntimeServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    const service = toCheckoutMaterializationService(candidate);
    if (service) return service;
  }

  return null;
}

function getAttachedVersionRuntimeServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function toCheckoutMaterializationService(
  value: unknown,
): AttachedCheckoutMaterializationService | null {
  const planCheckout = bindMethod(value, 'planCheckout');
  const checkout = bindMethod(value, 'checkout');
  if (!planCheckout && !checkout) return null;

  return {
    ...(planCheckout
      ? { planCheckout: (request: CheckoutMaterializationRequest) => planCheckout(request) }
      : {}),
    ...(checkout
      ? { checkout: (request: CheckoutMaterializationRequest) => checkout(request) }
      : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
