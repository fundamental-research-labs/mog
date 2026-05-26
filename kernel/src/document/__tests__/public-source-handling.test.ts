import { DocumentFactory } from '../../api/document/document-factory';
import { MogDocumentFactory } from '../../api/document/mog-document-factory';
import { LegacyOptionRejectedError } from '../../errors/document';

describe('public DocumentSource handling', () => {
  it('rejects headless path import on DocumentFactory.createFromXlsx', async () => {
    const result = await DocumentFactory.createFromXlsx(
      { type: 'path', path: '/tmp/private.xlsx' },
      { environment: 'headless', userTimezone: 'UTC' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(LegacyOptionRejectedError);
    expect(result.error?.message).toMatch(/source resolvers\/materializers|pass bytes/);
  });

  it('rejects path sources in the public SDK facade', async () => {
    const result = await MogDocumentFactory.open({
      source: { type: 'path', path: '/tmp/private.xlsx', format: 'xlsx' },
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.document).toBeUndefined();
    expect(result.importResult.success).toBe(false);
    expect(result.importResult.error?.code).toBe('UNSUPPORTED_SOURCE');
    expect(result.importResult.error?.message).toMatch(
      /source resolvers\/materializers|pass bytes/,
    );
  });

  it('fails closed for unknown public SDK source kinds', async () => {
    const result = await MogDocumentFactory.open({
      source: { type: 'hostHandle', handleId: 'opaque' } as any,
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });

    expect(result.document).toBeUndefined();
    expect(result.importResult.success).toBe(false);
    expect(result.importResult.error?.code).toBe('UNSUPPORTED_SOURCE');
  });
});
