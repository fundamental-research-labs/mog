import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';

import type { DocumentContext } from '../../context';

export function bindWorkbookFeatureGates(
  ctx: DocumentContext,
  readFeatureGates: () => FeatureGates | undefined,
): DocumentContext {
  return new Proxy(ctx as DocumentContext & { featureGates?: FeatureGates }, {
    get(target, prop, receiver) {
      if (prop === 'featureGates' || prop === 'hostFeatureGates') {
        return readFeatureGates();
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (prop === 'featureGates' || prop === 'hostFeatureGates') {
        return readFeatureGates() !== undefined || Reflect.has(target, prop);
      }
      return Reflect.has(target, prop);
    },
  });
}
