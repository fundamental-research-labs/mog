import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('kernel boundary', () => {
  it('keeps collaboration on the document sync port instead of raw kernel internals', () => {
    const boot = readSource('src/boot.ts');
    const collaborative = readSource('src/collaborative-engine.ts');

    expect(collaborative).not.toMatch(/\bDocumentHandleInternal\b/);
    expect(collaborative).not.toMatch(/\bKernelDocumentFactory\b/);
    expect(collaborative).not.toMatch(/\b_getComputeBridge\b/);
    expect(collaborative).not.toMatch(/handle\.context/);
    expect(collaborative).not.toMatch(/DocumentFactory as unknown/);
    expect(collaborative).not.toMatch(/\bcomputeBridge\b/);

    expect(collaborative).toMatch(/\b_getDocumentSyncPort\b/);
    expect(boot).toMatch(/\bcreateSyncPort\b/);
  });
});
