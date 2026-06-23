import type { VersionPageToken } from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../diff-service';
import {
  internalPageTokenForOffset,
  internalPageTokenForOrderKey,
  publicPageTokenFor,
} from '../diff-service-pagination';
import { graphWithRootAndChild, validSemanticPayload } from './diff-service-fixtures';

export function registerDiffServicePaginationTokenValidationScenarios(): void {
  it('rejects stale and malformed page tokens before returning entries', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 2 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });
    const offsetToken = internalPageTokenForOffset(rootCommitId, childCommitId, 0);
    const malformedOffsetToken = `${offsetToken.slice(0, -1)}1e2` as VersionPageToken;
    const cases = [
      {
        pageToken: `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}stale-handle` as VersionPageToken,
        diagnostic: { issueCode: 'VERSION_STALE_PAGE_CURSOR' },
      },
      {
        pageToken: publicPageTokenFor(malformedOffsetToken),
        diagnostic: {
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          safeMessage: 'diff pageToken carries an invalid page offset.',
        },
      },
      {
        pageToken: publicPageTokenFor(
          internalPageTokenForOrderKey(rootCommitId, childCommitId, 'not-json-array'),
        ),
        diagnostic: {
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          safeMessage: 'diff pageToken carries an invalid order key.',
        },
      },
    ];

    for (const { pageToken, diagnostic: expectedDiagnostic } of cases) {
      await expect(
        service.diff(
          { kind: 'commit', id: rootCommitId },
          { kind: 'commit', id: childCommitId },
          { pageToken },
        ),
      ).resolves.toMatchObject({
        status: 'degraded',
        items: [],
        diagnostics: [expect.objectContaining(expectedDiagnostic)],
      });
    }
  });
}
