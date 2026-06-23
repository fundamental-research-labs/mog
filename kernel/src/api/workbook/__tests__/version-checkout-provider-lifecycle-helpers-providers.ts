import type {
  VersionGraphRegistry,
  VersionStoreProvider,
} from '../../../document/version-store/provider';

export function providerWithFailingRegistryRead<T extends VersionStoreProvider>(
  provider: T,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
} {
  let openGraphCalls = 0;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          throw new Error('registry unavailable during checkout admission');
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
  };
}

export function providerWithStaleRegistryRead<T extends VersionStoreProvider>(
  provider: T,
  registry: VersionGraphRegistry,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
  readonly useStaleRegistryAfterLiveReads: (count: number) => void;
} {
  let openGraphCalls = 0;
  let liveRegistryReadsBeforeStale = Number.POSITIVE_INFINITY;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          if (liveRegistryReadsBeforeStale > 0) {
            liveRegistryReadsBeforeStale -= 1;
            return target.readGraphRegistry();
          }
          return {
            status: 'ok' as const,
            registry,
            diagnostics: [],
          };
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
    useStaleRegistryAfterLiveReads: (count: number) => {
      liveRegistryReadsBeforeStale = count;
    },
  };
}
