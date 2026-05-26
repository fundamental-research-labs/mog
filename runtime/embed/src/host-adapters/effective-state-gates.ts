import type { MogEmbedEffectiveState } from '../config';

export function canRequestSaveFromEffectiveState(
  state: MogEmbedEffectiveState | null,
): state is MogEmbedEffectiveState {
  if (!state) return false;
  if (!state.capabilities.includes('save')) return false;
  if (state.savePolicy !== 'host-callback' && state.savePolicy !== 'autosave') return false;
  if (state.collaboration === 'live' && state.savePolicy !== 'autosave') return false;
  return true;
}

export function canRequestExportFromEffectiveState(
  state: MogEmbedEffectiveState | null,
): state is MogEmbedEffectiveState {
  if (!state) return false;
  if (!state.capabilities.includes('export')) return false;
  return state.savePolicy !== 'none';
}
