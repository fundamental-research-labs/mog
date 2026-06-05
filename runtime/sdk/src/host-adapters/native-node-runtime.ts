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
    `Unsupported platform for @mog-sdk/node native runtime: ${process.platform}/${process.arch}`,
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
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, data);
}
