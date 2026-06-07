import type { BridgeTransport } from '@rust-bridge/client';
import { createCaseNormalizingTransport } from './case-normalize';
import { createTimeInjectingTransport } from './time-injection';
import type { TransportConfig } from './types';
import { getWasmModule, loadWasmModule } from './wasm-loader.host';
import { createWasmTransport } from './wasm-transport';

export async function createTransport(config?: TransportConfig): Promise<BridgeTransport> {
  const getUserTimezone = config?.getUserTimezone ?? (() => 'UTC');

  if (config?.explicitRuntime && config.explicitRuntime !== 'wasm') {
    throw new Error(`[transport] WASM SDK entry cannot create ${config.explicitRuntime} transport`);
  }

  await loadWasmModule({ initFns: config?.wasmInitFns, wasmModule: config?.wasmModule });

  const computeBase = createWasmTransport(() => getWasmModule()!);
  const computeTimed = createTimeInjectingTransport(
    computeBase,
    () => getWasmModule()!,
    getUserTimezone,
  );
  return createCaseNormalizingTransport(computeTimed);
}
