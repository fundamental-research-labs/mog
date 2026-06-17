import { createRequire } from 'node:module';

function getRequireFromHere(): NodeRequire {
  return createRequire(import.meta.url);
}

function getPlatformPackageName(): string {
  if (process.platform === 'darwin') return `@mog-sdk/darwin-${process.arch}`;
  if (process.platform === 'win32' && process.arch === 'x64') return '@mog-sdk/win32-x64-msvc';
  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const report = process.report?.getReport?.() as
      | { readonly header?: { readonly glibcVersionRuntime?: string } }
      | undefined;
    const libc = report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
    return `@mog-sdk/linux-${arch}-${libc}`;
  }
  throw new Error(
    `Unsupported platform for @mog-sdk/sdk native runtime: ${process.platform}/${process.arch}`,
  );
}

export function loadNodeSdkNapiAddon(): Record<string, (...args: unknown[]) => unknown> {
  return getRequireFromHere()(getPlatformPackageName()) as Record<
    string,
    (...args: unknown[]) => unknown
  >;
}

export async function readNodeFileBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return new Uint8Array(buf);
}

export async function writeNodeFileBytes(path: string, data: Uint8Array): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, resolve } = await import('node:path');
  const cwd = resolve('.');
  const absolutePath = resolve(path);
  const parentDirectory = dirname(absolutePath);

  try {
    await mkdir(parentDirectory, { recursive: true });
    await writeFile(absolutePath, data);
  } catch (cause) {
    const error = new Error(
      `Could not write file "${absolutePath}" for wb.save("${path}")`,
      cause != null ? { cause } : undefined,
    ) as Error & {
      requestedPath: string;
      absolutePath: string;
      cwd: string;
      parentDirectory: string;
      filesystemCode?: string;
      code?: string;
    };
    error.name = 'MogNodeFileWriteError';
    error.requestedPath = path;
    error.absolutePath = absolutePath;
    error.cwd = cwd;
    error.parentDirectory = parentDirectory;
    const code =
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : undefined;
    if (code) {
      error.filesystemCode = code;
      error.code = code;
    }
    throw error;
  }
}
