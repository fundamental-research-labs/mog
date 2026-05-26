import type { HostDiagnosticsSink } from './diagnostics';

export type KernelRuntimeConfig =
  | {
      readonly kind: 'browser-wasm-worker';
      readonly wasmBaseUrl: string;
      readonly workerUrl: string;
      readonly cspPolicy: 'strict' | 'host-provided';
      readonly memoryPolicy: 'default' | 'bounded';
    }
  | {
      readonly kind: 'node-napi';
      readonly addonResolution: 'public-platform-package' | 'host-provided-path';
      readonly workerPolicy: 'main-thread' | 'worker-thread';
    }
  | {
      readonly kind: 'tauri-native';
      readonly ipcNamespace: string;
      readonly nativePermissionProfile: string;
    }
  | {
      readonly kind: 'http-service';
      readonly baseUrl: string;
      readonly authHeaderPolicy: 'host-supplied' | 'session-derived';
    }
  | {
      readonly kind: 'python-pyo3';
      readonly bindingResolution: 'public-pypi-package' | 'host-provided-wheel' | 'source-tree-dev';
      readonly executionPolicy: 'in-process' | 'worker-process';
      readonly rawByteBoundary: 'trusted-process-only' | 'redacted-protocol-required';
    }
  | {
      readonly kind: 'rust-library';
      readonly crateResolution: 'workspace-crate' | 'published-crate' | 'host-linked-library';
      readonly executionPolicy: 'in-process';
      readonly rawByteBoundary: 'trusted-process-only' | 'redacted-protocol-required';
    }
  | {
      readonly kind: 'test';
      readonly deterministic: true;
    };

export interface RuntimeHostContext {
  readonly kernel: KernelRuntimeConfig;
  readonly assetPolicy: {
    readonly wasmBaseUrl?: string;
    readonly workerUrl?: string;
    readonly cspNonce?: string;
    readonly assetIntegrityPolicy: 'host-verified' | 'same-origin' | 'test-fixture';
  };
  readonly disposalPolicy: {
    readonly onTrap: 'surface-error' | 'attempt-recovery' | 'dispose-session';
    readonly onProviderFailure: 'fail-open-read-only' | 'fail-closed' | 'test-capture';
  };
  readonly diagnostics: HostDiagnosticsSink;
}
