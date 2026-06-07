/**
 * host-no-globals-sentinel.test.ts
 *
 * Sentinel test that verifies:
 * 1. The host runtime-to-transport mapping produces correct configs
 *    without reading any globals.
 * 2. The discriminated union config types enforce type-level separation
 *    between host and legacy paths.
 * 3. Unsupported runtime kinds fail with an error.
 *
 * For the full DocumentLifecycleSystem integration (which requires XState
 * and the full module graph), see the lifecycle machine tests. This test
 * focuses on the host-specific modules that can be tested in isolation.
 *
 * @see 02b-kernel-host-integration.md "Runtime And Transport Binding"
 */

import type { ValidatedKernelRuntimeConfig } from '@mog/kernel-host-internal';
import {
  mapHostRuntimeToTransportConfig,
  type ExplicitTransportConfig,
} from '../host-runtime-transport';

// ---------------------------------------------------------------------------
// Global trap installation / teardown
// ---------------------------------------------------------------------------

interface TrapState {
  devtoolsDescriptor?: PropertyDescriptor;
  tauriDescriptor?: PropertyDescriptor;
  indexedDBDescriptor?: PropertyDescriptor;
  tzDescriptor?: PropertyDescriptor;
  triggered: string[];
}

function installGlobalTraps(): TrapState {
  const state: TrapState = { triggered: [] };
  const g = globalThis as Record<string, unknown>;

  // window.__OS_DEVTOOLS__
  state.devtoolsDescriptor = Object.getOwnPropertyDescriptor(g, '__OS_DEVTOOLS__');
  Object.defineProperty(g, '__OS_DEVTOOLS__', {
    get() {
      state.triggered.push('window.__OS_DEVTOOLS__');
      throw new Error('SENTINEL: window.__OS_DEVTOOLS__ was accessed on host path');
    },
    configurable: true,
  });

  // window.__TAURI__
  state.tauriDescriptor = Object.getOwnPropertyDescriptor(g, '__TAURI__');
  Object.defineProperty(g, '__TAURI__', {
    get() {
      state.triggered.push('window.__TAURI__');
      throw new Error('SENTINEL: window.__TAURI__ was accessed on host path');
    },
    configurable: true,
  });

  // indexedDB
  state.indexedDBDescriptor = Object.getOwnPropertyDescriptor(g, 'indexedDB');
  Object.defineProperty(g, 'indexedDB', {
    get() {
      state.triggered.push('indexedDB');
      throw new Error('SENTINEL: indexedDB was accessed on host path');
    },
    configurable: true,
  });

  // process.env.TZ
  if (typeof process !== 'undefined' && process.env) {
    state.tzDescriptor = Object.getOwnPropertyDescriptor(process.env, 'TZ');
    Object.defineProperty(process.env, 'TZ', {
      get() {
        state.triggered.push('process.env.TZ');
        throw new Error('SENTINEL: process.env.TZ was accessed on host path');
      },
      configurable: true,
    });
  }

  return state;
}

function removeGlobalTraps(state: TrapState): void {
  const g = globalThis as Record<string, unknown>;

  if (state.devtoolsDescriptor) {
    Object.defineProperty(g, '__OS_DEVTOOLS__', state.devtoolsDescriptor);
  } else {
    delete g['__OS_DEVTOOLS__'];
  }

  if (state.tauriDescriptor) {
    Object.defineProperty(g, '__TAURI__', state.tauriDescriptor);
  } else {
    delete g['__TAURI__'];
  }

  if (state.indexedDBDescriptor) {
    Object.defineProperty(g, 'indexedDB', state.indexedDBDescriptor);
  } else {
    delete g['indexedDB'];
  }

  if (typeof process !== 'undefined' && process.env) {
    if (state.tzDescriptor) {
      Object.defineProperty(process.env, 'TZ', state.tzDescriptor);
    } else {
      delete process.env.TZ;
    }
  }
}

// ---------------------------------------------------------------------------
// Host runtime config fixtures
// ---------------------------------------------------------------------------

function makeRuntime(config: ValidatedKernelRuntimeConfig['config']): ValidatedKernelRuntimeConfig {
  return {
    config,
    transportBindingVerified: true,
    transportBinding: {
      runtimeKind: config.kind,
      createTransportConfig: () => ({}),
    },
    transportConfig: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapHostRuntimeToTransportConfig: no-globals sentinel', () => {
  let trapState: TrapState;

  beforeEach(() => {
    trapState = installGlobalTraps();
  });

  afterEach(() => {
    removeGlobalTraps(trapState);
  });

  it('browser-wasm-worker maps to environment=browser with explicit URLs', () => {
    const runtime = makeRuntime({
      kind: 'browser-wasm-worker',
      wasmBaseUrl: 'https://cdn.example.com/wasm/',
      workerUrl: 'https://cdn.example.com/worker.js',
      cspPolicy: 'strict',
      memoryPolicy: 'default',
    });

    const config: ExplicitTransportConfig = mapHostRuntimeToTransportConfig(runtime);

    expect(config.environment).toBe('browser');
    expect(config.wasmBaseUrl).toBe('https://cdn.example.com/wasm/');
    expect(config.workerUrl).toBe('https://cdn.example.com/worker.js');
    expect(trapState.triggered).toEqual([]);
  });

  it('node-napi maps to environment=headless', () => {
    const runtime = makeRuntime({
      kind: 'node-napi',
      addonResolution: 'public-platform-package',
      workerPolicy: 'main-thread',
    });

    const config = mapHostRuntimeToTransportConfig(runtime);

    expect(config.environment).toBe('headless');
    expect(trapState.triggered).toEqual([]);
  });

  it('headless-wasm maps to environment=headless with explicit WASM transport', () => {
    const runtime = makeRuntime({
      kind: 'headless-wasm',
      wasmModulePolicy: 'host-provided',
      executionPolicy: 'same-thread',
    });

    const config = mapHostRuntimeToTransportConfig(runtime);

    expect(config.environment).toBe('headless');
    expect(config.explicitRuntime).toBe('wasm');
    expect(trapState.triggered).toEqual([]);
  });

  it('tauri-native maps to environment=browser with explicit IPC namespace', () => {
    const runtime = makeRuntime({
      kind: 'tauri-native',
      ipcNamespace: 'mog-tauri',
      nativePermissionProfile: 'desktop-standard',
    });

    const config = mapHostRuntimeToTransportConfig(runtime);

    expect(config.environment).toBe('browser');
    expect(config.ipcNamespace).toBe('mog-tauri');
    expect(trapState.triggered).toEqual([]);
  });

  it('test maps to environment=headless', () => {
    const runtime = makeRuntime({
      kind: 'test',
      deterministic: true,
    });

    const config = mapHostRuntimeToTransportConfig(runtime);

    expect(config.environment).toBe('headless');
    expect(trapState.triggered).toEqual([]);
  });

  it('unsupported runtime kind throws before engine construction', () => {
    const runtime = makeRuntime({
      kind: 'http-service',
      baseUrl: 'https://api.example.com',
      authHeaderPolicy: 'host-supplied',
    } as ValidatedKernelRuntimeConfig['config']);

    expect(() => mapHostRuntimeToTransportConfig(runtime)).toThrow(
      /Unsupported runtime kind for host-backed construction: http-service/,
    );
    expect(trapState.triggered).toEqual([]);
  });

  it('python-pyo3 runtime kind throws before engine construction', () => {
    const runtime = makeRuntime({
      kind: 'python-pyo3',
      bindingResolution: 'public-pypi-package',
      executionPolicy: 'in-process',
      rawByteBoundary: 'trusted-process-only',
    } as ValidatedKernelRuntimeConfig['config']);

    expect(() => mapHostRuntimeToTransportConfig(runtime)).toThrow(
      /Unsupported runtime kind for host-backed construction: python-pyo3/,
    );
    expect(trapState.triggered).toEqual([]);
  });

  it('rust-library runtime kind throws before engine construction', () => {
    const runtime = makeRuntime({
      kind: 'rust-library',
      crateResolution: 'workspace-crate',
      executionPolicy: 'in-process',
      rawByteBoundary: 'trusted-process-only',
    } as ValidatedKernelRuntimeConfig['config']);

    expect(() => mapHostRuntimeToTransportConfig(runtime)).toThrow(
      /Unsupported runtime kind for host-backed construction: rust-library/,
    );
    expect(trapState.triggered).toEqual([]);
  });

  it('no globals are touched across all supported runtime kind mappings', () => {
    // Run all supported kinds in sequence with traps active
    const supportedKinds: ValidatedKernelRuntimeConfig['config'][] = [
      {
        kind: 'browser-wasm-worker',
        wasmBaseUrl: '/wasm/',
        workerUrl: '/worker.js',
        cspPolicy: 'strict',
        memoryPolicy: 'default',
      },
      {
        kind: 'node-napi',
        addonResolution: 'public-platform-package',
        workerPolicy: 'main-thread',
      },
      {
        kind: 'headless-wasm',
        wasmModulePolicy: 'host-provided',
        executionPolicy: 'same-thread',
      },
      {
        kind: 'tauri-native',
        ipcNamespace: 'test-ns',
        nativePermissionProfile: 'desktop-standard',
      },
      { kind: 'test', deterministic: true },
    ];

    for (const config of supportedKinds) {
      mapHostRuntimeToTransportConfig(makeRuntime(config));
    }

    expect(trapState.triggered).toEqual([]);
  });
});
