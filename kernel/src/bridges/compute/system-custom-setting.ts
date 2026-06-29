import type { ComputeBridge } from './compute-bridge';
import type { MutationResult } from './compute-types.gen';

export function setSystemCustomSetting(
  bridge: ComputeBridge,
  key: string,
  value: string | null,
): Promise<MutationResult> {
  bridge.core.ensureInitialized();
  return bridge.core.mutateSystem('compute_set_custom_setting', () =>
    bridge.core.transport.call<[Uint8Array, MutationResult]>('compute_set_custom_setting', {
      docId: bridge.core.docId,
      key,
      value,
    }),
  );
}
