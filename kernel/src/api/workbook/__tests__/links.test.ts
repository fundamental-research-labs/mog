import { jest } from '@jest/globals';

import { WorkbookLinksImpl } from '../links';

const scope = {
  requestingDocumentId: 'dest-doc',
  requestingSessionId: 'dest-session',
  actor: 'agent-alpha',
  principal: { tags: ['agent:alpha'] },
};

describe('WorkbookLinksImpl', () => {
  it('unwraps refresh receipts to sanitized public status views', async () => {
    const readyStatus = {
      linkId: 'link-ready',
      status: 'ready' as const,
      lastResolvedAt: '2026-06-17T00:00:00.000Z',
      cachedValuesVersion: 'cache-v1',
      canRefresh: true,
      retryable: false,
      displayMessage: 'Ready',
    };
    const service = {
      refresh: jest.fn(async () => ({
        kind: 'workbook.links.refresh',
        status: 'applied',
        effects: [],
        diagnostics: [],
        linkId: 'link-ready',
        statusView: readyStatus,
      })),
    };
    const links = new WorkbookLinksImpl(service as any, () => scope);

    await expect(links.refresh('link-ready')).resolves.toEqual(readyStatus);
    await expect(links.refresh('link-ready')).resolves.not.toHaveProperty('kind');
    expect(service.refresh).toHaveBeenCalledWith('link-ready', scope);
  });

  it('unwraps refreshAll receipts to status-view arrays', async () => {
    const statusViews = [
      {
        linkId: 'link-ready',
        status: 'ready' as const,
        canRefresh: true,
        retryable: false,
        displayMessage: 'Ready',
      },
      {
        linkId: 'link-denied',
        status: 'denied' as const,
        statusReason: 'permissionDenied' as const,
        canRefresh: true,
        retryable: false,
        displayMessage: 'Permission denied',
      },
    ];
    const service = {
      refreshAll: jest.fn(async () => ({
        kind: 'workbook.links.refreshAll',
        status: 'partial',
        effects: [],
        diagnostics: [],
        linkIds: ['link-ready', 'link-denied'],
        statusViews,
        receipts: [],
        refreshedCount: 1,
        failedCount: 1,
        unsupportedCount: 0,
      })),
    };
    const links = new WorkbookLinksImpl(service as any, () => scope);

    await expect(links.refreshAll({ concurrency: 1 })).resolves.toEqual(statusViews);
    expect(service.refreshAll).toHaveBeenCalledWith(scope, { concurrency: 1 });
  });
});
