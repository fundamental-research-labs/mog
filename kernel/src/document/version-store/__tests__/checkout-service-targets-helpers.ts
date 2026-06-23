import { jest } from '@jest/globals';

import {
  createCheckoutMaterializationService,
  type CheckoutMaterializationServiceOptions,
} from '../checkout-service';

import type { Stores } from './checkout-service-test-helpers';

type CheckoutTargetServiceOverrides = Partial<
  Pick<
    CheckoutMaterializationServiceOptions,
    'commitReader' | 'dependencyReader' | 'headReader' | 'refReader'
  >
>;

export function createTargetCheckoutService(
  stores: Stores,
  overrides: CheckoutTargetServiceOverrides = {},
) {
  const defaultDependencyReader: CheckoutMaterializationServiceOptions['dependencyReader'] = {
    hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
  };

  return createCheckoutMaterializationService({
    commitReader: overrides.commitReader ?? stores.commitStore,
    dependencyReader: overrides.dependencyReader ?? defaultDependencyReader,
    ...(overrides.headReader === undefined ? {} : { headReader: overrides.headReader }),
    ...(overrides.refReader === undefined ? {} : { refReader: overrides.refReader }),
  });
}

export function createTrackedCommitReader(stores: Stores) {
  const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));

  return {
    commitReader: { readCommit },
    readCommit,
  };
}
