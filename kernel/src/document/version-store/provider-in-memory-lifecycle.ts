import type { VersionStoreCloseReason } from './provider-types';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

export async function closeInMemoryVersionStoreProvider(
  state: InMemoryVersionStoreProviderState,
  _reason: VersionStoreCloseReason = 'workbook-close',
): Promise<void> {
  if (state.lifecycleState === 'closed' || state.lifecycleState === 'disposed') return;
  if (state.lifecycleState === 'disposing') return;
  state.lifecycleState = 'closing';
  state.lifecycleState = 'closed';
}

export async function disposeInMemoryVersionStoreProvider(
  state: InMemoryVersionStoreProviderState,
  _reason: VersionStoreCloseReason = 'dispose',
): Promise<void> {
  if (state.lifecycleState === 'disposed') return;
  if (state.lifecycleState === 'open') {
    await closeInMemoryVersionStoreProvider(state, 'dispose');
  }
  state.lifecycleState = 'disposing';
  state.lifecycleState = 'disposed';
}
