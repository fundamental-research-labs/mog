export interface WasmAssetEntry {
  url: string;
  integrity?: string;
  simd: boolean;
  threading: boolean;
  initialMemoryPages?: number;
  maxMemoryPages?: number;
}

export interface WorkerAssetEntry {
  url: string;
  integrity?: string;
  type: 'module' | 'classic';
}

export interface NativeAddonEntry {
  path: string;
  platform: string;
  arch: string;
  libc?: string;
  abiVersion: string;
  integrity?: string;
}

export interface FontAssetEntry {
  family: string;
  url: string;
  weight?: number;
  style?: 'normal' | 'italic';
  integrity?: string;
}

export interface RuntimeAssetManifest {
  version: string;
  wasm: WasmAssetEntry[];
  workers: WorkerAssetEntry[];
  nativeAddons?: NativeAddonEntry[];
  fonts?: FontAssetEntry[];
  baseUrl?: string;
}
