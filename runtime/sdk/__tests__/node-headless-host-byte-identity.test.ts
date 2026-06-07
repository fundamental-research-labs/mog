import { createHostByteFingerprint } from '@mog-sdk/types-host/fingerprints';
import { createNodeHeadlessHost } from '../src/host-adapters/node-headless-host';

describe('node headless host byte identity', () => {
  it('issues immutable byte handles with the shared raw-byte fingerprint contract', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const host = createNodeHeadlessHost({
      documentId: 'node-headless-host-byte-identity-test',
      operation: 'import',
      timezone: 'UTC',
      importBytes: bytes,
    });

    try {
      const documentRef = host.kernelContext.storage.documentRef;
      if (!documentRef || documentRef.kind !== 'source-handle') {
        throw new Error('Expected import operation to issue a source-handle document ref');
      }

      const contentIdentity = documentRef.issuance.contentIdentity;
      expect(contentIdentity.kind).toBe('immutable-byte-handle');
      expect(contentIdentity.handleFingerprint).toBe(createHostByteFingerprint(bytes));
      expect(contentIdentity.sizeBytes).toBe(bytes.byteLength);
    } finally {
      host.dispose();
    }
  });
});
