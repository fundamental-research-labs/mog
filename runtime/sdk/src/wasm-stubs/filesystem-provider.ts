export class FilesystemProvider {
  constructor() {
    throw new Error('FilesystemProvider is not available in the WASM SDK runtime');
  }
}

export function createFilesystemProviderFactory() {
  return async (_config: unknown) => {
    throw new Error('Filesystem storage providers are not available in the WASM SDK runtime');
  };
}

export type FilesystemProviderOptions = never;
