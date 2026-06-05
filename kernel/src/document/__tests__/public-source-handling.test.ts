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

  it('rejects raw interactive deferred import options on public createFromXlsx', async () => {
    const result = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) },
      {
        environment: 'headless',
        userTimezone: 'UTC',
        internalInteractiveDeferred: true,
      } as any,
    );

    expect(result.success).toBe(false);
    expect((result.error as any)?.code).toBe('invalid_interactive_import_option');
    expect((result.error as any)?.scope).toBe('allSheets');
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
