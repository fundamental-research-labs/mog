import {
  createWorkbookLinkService,
  type WorkbookLinkResolver,
  type WorkbookLinkStatusScope,
} from '../index';

function scope(actor: string, session = 'session-a'): WorkbookLinkStatusScope {
  return {
    requestingDocumentId: 'target-doc',
    requestingSessionId: session,
    actor,
    principal: { tags: [`user:${actor}`] },
  };
}

describe('WorkbookLinkService', () => {
  it('stores persisted records separately from principal-scoped runtime status', async () => {
    const resolver: WorkbookLinkResolver = {
      resolve(request) {
        if (request.actor === 'alice') {
          return {
            linkId: request.linkId,
            status: 'ready',
            sourceSessionId: 'source-session',
            sourceWorkbookId: request.expectedWorkbookId ?? undefined,
            sourceVersion: 'v1',
            authorization: 'read',
          };
        }
        return {
          linkId: request.linkId,
          status: 'denied',
          statusReason: 'permissionDenied',
          authorization: 'denied',
        };
      },
    };
    const service = createWorkbookLinkService({
      resolver,
      now: () => '2026-05-20T00:00:00.000Z',
    });
    const view = service.create({
      linkId: 'link-budget',
      expectedWorkbookId: 'semantic-budget',
      target: { kind: 'document-ref', documentId: 'budget-doc' },
      displayName: 'Budget',
      sourceKind: 'mog-workbook',
      materializedCacheMetadata: { cachedValuesVersion: 'cache-v1' },
    });

    expect(view).toMatchObject({ linkId: 'link-budget', targetDisplay: 'Mog workbook' });
    expect(service.listRecords()[0]).toMatchObject({ expectedWorkbookId: 'semantic-budget' });
    expect(service.list()[0]).toHaveProperty('status');

    await expect(service.refresh('link-budget', scope('alice'))).resolves.toMatchObject({
      kind: 'workbook.links.refresh',
      status: 'applied',
      linkId: 'link-budget',
      statusView: {
        status: 'ready',
        cachedValuesVersion: 'cache-v1',
      },
    });
    await expect(service.refresh('link-budget', scope('bob'))).resolves.toMatchObject({
      kind: 'workbook.links.refresh',
      status: 'failed',
      linkId: 'link-budget',
      statusView: {
        status: 'denied',
        statusReason: 'permissionDenied',
      },
    });

    expect(service.getStatus('link-budget', scope('alice')).status).toBe('ready');
    expect(service.getStatus('link-budget', scope('bob')).status).toBe('denied');
    expect(service.getStatus('link-budget', scope('alice', 'session-b')).status).toBe('unresolved');
  });

  it('replaces and disposes watch handles by actor/session scope', async () => {
    const disposed: string[] = [];
    const resolver: WorkbookLinkResolver = {
      resolve(request) {
        return {
          linkId: request.linkId,
          status: 'ready',
          authorization: 'read',
          watch: {
            dispose: () => disposed.push(`${request.actor}:${request.requestingSessionId}`),
          },
        };
      },
    };
    const service = createWorkbookLinkService({ resolver });
    service.create({
      linkId: 'link-source',
      expectedWorkbookId: null,
      target: { kind: 'open-session', sessionId: 'source-session' },
      displayName: 'Source',
      sourceKind: 'mog-workbook',
    });

    await service.refresh('link-source', scope('alice', 'session-a'));
    await service.refresh('link-source', scope('alice', 'session-a'));
    await service.refresh('link-source', scope('alice', 'session-b'));

    expect(disposed).toEqual(['alice:session-a']);
    service.dispose();
    expect(disposed.sort()).toEqual(
      ['alice:session-a', 'alice:session-a', 'alice:session-b'].sort(),
    );
  });

  it('rejects a resolver-ready source when the semantic workbook id differs', async () => {
    const resolver: WorkbookLinkResolver = {
      resolve(request) {
        return {
          linkId: request.linkId,
          status: 'ready',
          sourceSessionId: 'wrong-source-session',
          sourceWorkbookId: 'semantic-budget-copy',
          authorization: 'read',
        };
      },
    };
    const service = createWorkbookLinkService({ resolver });
    service.create({
      linkId: 'link-budget',
      expectedWorkbookId: 'semantic-budget',
      target: { kind: 'open-session', sessionId: 'wrong-source-session' },
      displayName: 'Budget',
      sourceKind: 'mog-workbook',
    });

    await expect(service.refresh('link-budget', scope('alice'))).resolves.toMatchObject({
      kind: 'workbook.links.refresh',
      status: 'failed',
      linkId: 'link-budget',
      statusView: {
        status: 'broken',
        statusReason: 'wrongWorkbookId',
      },
    });
  });

  it('redacts public views and permission-checks copy source', async () => {
    const service = createWorkbookLinkService();
    service.create({
      linkId: 'link-local',
      expectedWorkbookId: null,
      target: { kind: 'path', path: '/secret/finance/Budget.xlsx' },
      displayName: 'Budget',
      sourceKind: 'excel-workbook',
    });
    service.create({
      linkId: 'link-url',
      expectedWorkbookId: null,
      target: { kind: 'url', url: 'https://example.test/path/Budget.xlsx?token=secret' },
      displayName: 'Budget URL',
      sourceKind: 'excel-workbook',
    });
    service.create({
      linkId: 'link-dde',
      expectedWorkbookId: null,
      target: { kind: 'opaque-host-ref', provider: 'ooxml-dde', ref: 'token' },
      displayName: 'DDE',
      sourceKind: 'dde-link',
    });

    expect(service.get('link-local')).toMatchObject({ targetDisplay: 'Budget.xlsx' });
    expect(service.get('link-url')).toMatchObject({
      targetDisplay: 'https://example.test/.../Budget.xlsx',
    });
    await expect(service.copySource('link-local', scope('alice'))).resolves.toEqual({
      type: 'denied',
      linkId: 'link-local',
      deniedReason: 'permissionDenied',
    });
    await expect(service.copySource('link-url', scope('alice'))).resolves.toEqual({
      type: 'denied',
      linkId: 'link-url',
      deniedReason: 'redacted',
    });
    await expect(service.refresh('link-dde', scope('alice'))).resolves.toMatchObject({
      kind: 'workbook.links.refresh',
      status: 'unsupported',
      statusView: {
        status: 'unresolved',
        statusReason: 'unsupportedLinkKind',
        canRefresh: false,
      },
    });
  });

  it('returns an aggregate receipt for refreshAll including no-op inventory', async () => {
    const service = createWorkbookLinkService();

    await expect(service.refreshAll(scope('alice'))).resolves.toMatchObject({
      kind: 'workbook.links.refreshAll',
      status: 'noOp',
      refreshedCount: 0,
      failedCount: 0,
      unsupportedCount: 0,
      statusViews: [],
      receipts: [],
    });
  });

  it('returns aggregate refreshAll receipts with preserved status views', async () => {
    const resolver: WorkbookLinkResolver = {
      resolve(request) {
        return {
          linkId: request.linkId,
          status: 'ready',
          authorization: 'read',
        };
      },
    };
    const service = createWorkbookLinkService({ resolver });
    service.create({
      linkId: 'link-ready',
      expectedWorkbookId: null,
      target: { kind: 'open-session', sessionId: 'source-session' },
      displayName: 'Ready',
      sourceKind: 'mog-workbook',
    });
    service.create({
      linkId: 'link-dde',
      expectedWorkbookId: null,
      target: { kind: 'opaque-host-ref', provider: 'ooxml-dde', ref: 'token' },
      displayName: 'DDE',
      sourceKind: 'dde-link',
    });

    await expect(service.refreshAll(scope('alice'))).resolves.toMatchObject({
      kind: 'workbook.links.refreshAll',
      status: 'partial',
      linkIds: ['link-ready', 'link-dde'],
      refreshedCount: 1,
      failedCount: 0,
      unsupportedCount: 1,
      statusViews: [
        expect.objectContaining({ linkId: 'link-ready', status: 'ready' }),
        expect.objectContaining({
          linkId: 'link-dde',
          status: 'unresolved',
          statusReason: 'unsupportedLinkKind',
        }),
      ],
      receipts: [
        expect.objectContaining({ kind: 'workbook.links.refresh', status: 'applied' }),
        expect.objectContaining({ kind: 'workbook.links.refresh', status: 'unsupported' }),
      ],
    });
  });
});
