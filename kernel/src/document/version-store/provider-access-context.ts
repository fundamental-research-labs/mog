import { normalizeVersionStoreString } from './registry';
import type { VersionAccessContext } from './provider-types';

export function normalizeVersionAccessContext(
  accessContext: VersionAccessContext | undefined,
): VersionAccessContext {
  if (accessContext === undefined) return Object.freeze({});
  return Object.freeze({
    ...(accessContext.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeVersionStoreString(
            accessContext.principalScope,
            'accessContext.principalScope',
          ),
        }),
    ...(accessContext.capabilityIds === undefined
      ? {}
      : {
          capabilityIds: Object.freeze(
            [...accessContext.capabilityIds].map((capabilityId, index) =>
              normalizeVersionStoreString(capabilityId, `accessContext.capabilityIds[${index}]`),
            ),
          ),
        }),
    ...(accessContext.diagnosticsAllowed === undefined
      ? {}
      : { diagnosticsAllowed: Boolean(accessContext.diagnosticsAllowed) }),
  });
}
