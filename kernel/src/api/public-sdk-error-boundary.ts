import type { Workbook } from '@mog-sdk/contracts/api';

import { toMogSdkError } from '../errors/mog-sdk-error';

type BoundaryValue = object | ((...args: never[]) => unknown);

const wrappedByTargetAndOperation = new WeakMap<BoundaryValue, Map<string, BoundaryValue>>();
const wrappedProxyMetadata = new WeakMap<
  BoundaryValue,
  { readonly target: BoundaryValue; readonly operation: string }
>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isCallablePlainObject(value: object): boolean {
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (
      typeof descriptor.value === 'function' ||
      typeof descriptor.get === 'function' ||
      typeof descriptor.set === 'function'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * API objects are class instances or callable object-literal namespaces.
 * Result records, arrays, byte buffers, maps, and other data values deliberately
 * remain unproxied so callers keep their original identity and runtime shape.
 */
function isApiSurface(value: unknown): value is BoundaryValue {
  if (typeof value === 'function') return true;
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) {
    return isCallablePlainObject(value);
  }
  return true;
}

function operationSegment(property: PropertyKey): string {
  if (typeof property === 'symbol') {
    return property.description ?? property.toString();
  }
  return String(property);
}

function childOperation(parent: string, property: PropertyKey): string {
  return `${parent}.${operationSegment(property)}`;
}

function normalizeResult<T>(result: T, operation: string, resultOperation: string): T {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      (value) => withPublicSdkErrorBoundary(value, resultOperation),
      (error: unknown) => {
        throw toMogSdkError(error, operation);
      },
    ) as T;
  }
  return withPublicSdkErrorBoundary(result, resultOperation);
}

/**
 * Execute one stable SDK operation and normalize both synchronous throws and
 * asynchronous rejections. Successful API objects are recursively bounded;
 * plain data is returned exactly as supplied.
 */
export function callWithPublicSdkErrorBoundary<T>(
  operation: string,
  invoke: () => T,
  resultOperation = operation,
): T {
  try {
    return normalizeResult(invoke(), operation, resultOperation);
  } catch (error) {
    throw toMogSdkError(error, operation);
  }
}

/**
 * Install the stable public SDK error contract on an API surface.
 *
 * A target is wrapped once per operation route. Repeated access through the
 * same route preserves referential equality, while aliases such as activeSheet
 * and getSheet(...) receive distinct proxies so errors report the route the
 * caller actually invoked. Method functions are cached per routed proxy too.
 */
export function withPublicSdkErrorBoundary<T>(value: T, operation = 'sdk'): T {
  if (!isApiSurface(value)) return value;
  const proxyMetadata = wrappedProxyMetadata.get(value);
  if (proxyMetadata) {
    if (proxyMetadata.operation === operation) return value;
    return withPublicSdkErrorBoundary(proxyMetadata.target, operation) as T;
  }

  let wrappedByOperation = wrappedByTargetAndOperation.get(value);
  const existing = wrappedByOperation?.get(operation);
  if (existing) return existing as T;

  const methodCache = new Map<
    PropertyKey,
    { readonly source: unknown; readonly wrapped: unknown }
  >();
  const proxy = new Proxy(value, {
    get(target, property) {
      const memberOperation = childOperation(operation, property);
      let member: unknown;
      try {
        // Use the original target as the receiver so class accessors with private
        // fields and internal `this` checks continue to work.
        member = Reflect.get(target, property, target);
      } catch (error) {
        throw toMogSdkError(error, memberOperation);
      }

      if (typeof member !== 'function') {
        return withPublicSdkErrorBoundary(member, memberOperation);
      }

      const cached = methodCache.get(property);
      if (cached?.source === member) return cached.wrapped;

      const wrapped = (...args: unknown[]) =>
        callWithPublicSdkErrorBoundary(memberOperation, () => Reflect.apply(member, target, args));
      methodCache.set(property, { source: member, wrapped });
      return wrapped;
    },

    set(target, property, newValue) {
      const memberOperation = childOperation(operation, property);
      return callWithPublicSdkErrorBoundary(memberOperation, () =>
        Reflect.set(target, property, newValue, target),
      );
    },

    apply(target, thisArgument, argumentsList) {
      return callWithPublicSdkErrorBoundary(operation, () =>
        Reflect.apply(target as (...args: unknown[]) => unknown, thisArgument, argumentsList),
      );
    },
  });

  if (!wrappedByOperation) {
    wrappedByOperation = new Map();
    wrappedByTargetAndOperation.set(value, wrappedByOperation);
  }
  wrappedByOperation.set(operation, proxy);
  wrappedProxyMetadata.set(proxy, { target: value, operation });
  return proxy as T;
}

export function withPublicWorkbookErrorBoundary(workbook: Workbook): Workbook {
  return withPublicSdkErrorBoundary(workbook, 'workbook');
}
