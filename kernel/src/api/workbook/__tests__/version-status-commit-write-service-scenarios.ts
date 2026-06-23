import { jest } from '@jest/globals';

import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_CREATED_AT as CREATED_AT,
  VERSION_STATUS_REF_REVISION as REF_REVISION,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
} from './version-status-test-utils';
import {
  VERSION_AUTHOR,
  createMockCtx,
  createWorkbook,
} from './version-status-workbook-test-utils';

export function registerVersionStatusCommitWriteServiceScenarios() {
  it('maps public commit options to an attached version write service', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: VERSION_AUTHOR,
      },
    }));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          objectStore: {},
          refStore: {},
          writeService: { commit },
        },
      }),
    });

    await expect(
      wb.version.commit({
        message: 'Capture forecast edits',
        mode: { kind: 'normal' },
        expectedHead: {
          commitId: ROOT_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
        },
        redactionPolicy: {
          mode: 'strict',
          redactSecrets: true,
          redactExternalLinks: true,
          redactAgentTrace: true,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
      },
    });
    expect(commit).toHaveBeenCalledWith({
      message: 'Capture forecast edits',
      mode: { kind: 'normal' },
      expectedHead: {
        commitId: ROOT_COMMIT_ID,
        revision: REF_REVISION,
        symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
      },
      redactionPolicy: {
        mode: 'strict',
        redactSecrets: true,
        redactExternalLinks: true,
        redactAgentTrace: true,
      },
    });

    await expect(wb.version.getStatus()).resolves.toMatchObject({
      commitApi: {
        stage: 'present',
        available: true,
      },
    });
  });
}
