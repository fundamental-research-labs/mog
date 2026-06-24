import type { VersionResult } from '@mog-sdk/contracts/api';

import { targetUnavailable } from './proposal-provider-accept-service-results';
import type { AgentProposalMetadataStore } from './proposal-store';

export async function openProposalStore(
  openStore: () => Promise<AgentProposalMetadataStore>,
): Promise<
  | { readonly ok: true; readonly value: AgentProposalMetadataStore }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  try {
    return { ok: true, value: await openStore() };
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_PROVIDER_ERROR',
        'Version proposal metadata store could not be opened.',
      ),
    };
  }
}
