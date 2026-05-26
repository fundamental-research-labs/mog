import { MogClient } from '../client/index';
import type { MogEmbedConfig, MogEmbedEffectiveState, MogEmbedHostPolicy } from '../config';
import { assertValidMogEmbedConfig } from '../config';
import {
  canRequestExportFromEffectiveState,
  canRequestSaveFromEffectiveState,
} from './effective-state-gates';

export {
  canRequestExportFromEffectiveState,
  canRequestSaveFromEffectiveState,
} from './effective-state-gates';

type SaveState = MogEmbedEffectiveState['saveState'];

export interface SamePageEmbedHostResult {
  readonly client: MogClient;
  resolveEffectiveState(dirty: boolean, saveState?: SaveState): Promise<MogEmbedEffectiveState>;
  canRequestSave(state: MogEmbedEffectiveState | null): state is MogEmbedEffectiveState;
  canRequestExport(state: MogEmbedEffectiveState | null): state is MogEmbedEffectiveState;
  requestSave(state: MogEmbedEffectiveState): Promise<boolean>;
  requestExport(format: string, state: MogEmbedEffectiveState): Promise<Blob | null>;
  dispose(): void;
}

export async function createSamePageEmbedHost(
  config: MogEmbedConfig,
  hostPolicy: MogEmbedHostPolicy,
  sheet?: number | string,
): Promise<SamePageEmbedHostResult> {
  assertValidMogEmbedConfig(config);
  const resolvedSource = await Promise.resolve(hostPolicy.resolveSource(config));
  const client = new MogClient({
    sourceBytes: resolvedSource.bytes,
    sheet: config.sheet ?? sheet,
  });

  let disposed = false;

  const resolveEffectiveState = async (
    dirty: boolean,
    saveState: SaveState = 'idle',
  ): Promise<MogEmbedEffectiveState> => {
    const resolved = await Promise.resolve(hostPolicy.resolveEffectiveState(config));
    return {
      ...resolved,
      capabilities: [...resolved.capabilities],
      deniedCapabilities: [...resolved.deniedCapabilities],
      dirty,
      saveState,
    };
  };

  return {
    client,
    resolveEffectiveState,
    canRequestSave: canRequestSaveFromEffectiveState,
    canRequestExport: canRequestExportFromEffectiveState,
    async requestSave(state: MogEmbedEffectiveState): Promise<boolean> {
      if (!canRequestSaveFromEffectiveState(state) || !hostPolicy.requestSave) {
        return false;
      }
      return Promise.resolve(hostPolicy.requestSave(state));
    },
    async requestExport(format: string, state: MogEmbedEffectiveState): Promise<Blob | null> {
      if (!canRequestExportFromEffectiveState(state) || !hostPolicy.requestExport) {
        return null;
      }
      return Promise.resolve(hostPolicy.requestExport(format, state));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      client.dispose();
    },
  };
}
