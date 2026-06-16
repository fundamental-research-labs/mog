import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { writeNodeFileBytes } from '../src/host-adapters/native-node-runtime';

describe('writeNodeFileBytes', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('creates missing parent directories before writing bytes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mog-save-path-'));
    const outputPath = join(tempDir, 'nested', 'model.xlsx');
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await writeNodeFileBytes(outputPath, bytes);

    await expect(readFile(outputPath)).resolves.toEqual(Buffer.from(bytes));
  });

  it('adds path metadata to filesystem failures', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mog-save-path-'));
    const fileParent = join(tempDir, 'not-a-directory');
    await writeFile(fileParent, 'already a file');
    const outputPath = join(fileParent, 'model.xlsx');

    await expect(writeNodeFileBytes(outputPath, new Uint8Array([1]))).rejects.toMatchObject({
      name: 'MogNodeFileWriteError',
      requestedPath: outputPath,
      absolutePath: resolve(outputPath),
      cwd: process.cwd(),
      parentDirectory: resolve(fileParent),
      filesystemCode: expect.any(String),
    });
  });
});
