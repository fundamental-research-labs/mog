import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const builtBinary = join(packageRoot, 'compute-core-napi.node');
const hostPackageDir = join(packageRoot, 'npm', hostNativePackageDirName());
const hostBinary = join(hostPackageDir, 'compute-core-napi.node');

if (!existsSync(builtBinary)) {
  throw new Error(`Native build did not produce ${builtBinary}`);
}

mkdirSync(hostPackageDir, { recursive: true });
copyFileSync(builtBinary, hostBinary);
console.log(`[compute/napi] synced ${hostBinary}`);

function hostNativePackageDirName() {
  if (process.platform === 'darwin') {
    return `darwin-${hostArch()}`;
  }
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') {
      throw new Error(`Unsupported Windows architecture for compute-core-napi: ${process.arch}`);
    }
    return 'win32-x64-msvc';
  }
  if (process.platform === 'linux') {
    return `linux-${hostArch()}-${linuxLibc()}`;
  }
  throw new Error(
    `Unsupported platform for compute-core-napi: ${process.platform}/${process.arch}`,
  );
}

function hostArch() {
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'x64') return 'x64';
  throw new Error(`Unsupported architecture for compute-core-napi: ${process.arch}`);
}

function linuxLibc() {
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
}
