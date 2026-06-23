import { expect, it } from '@jest/globals';

import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import {
  defaultCellChange,
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
  validSemanticPayload,
} from './version-diff-projection-fixtures';
import {
  createVersion,
  graphWithMergeTarget,
  graphWithRootAndChild,
} from './version-diff-projection-test-utils';

export function registerProjectionDiagnosticScenarios(): void {
  it('rejects unsupported row-domain entries without leaking raw row selectors', async () => {
    const hiddenSheet = 'sheet-payroll-secret';
    const hiddenRow = 'secret-row-17';
    const changes = [
      semanticRecord({
        changeId: 'row-hidden-state',
        domain: 'rows',
        entityId: `${hiddenSheet}!row:17`,
        propertyPath: ['hidden'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'Set' },
          { key: 'rowId', value: hiddenRow },
          { key: 'hidden', value: true },
        ]),
        display: entityLabelDisplay('Payroll row 17'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_UNSUPPORTED_SCHEMA',
            message: 'The requested version diff is not materializable by the attached service.',
            data: expect.objectContaining({
              recoverability: 'repair',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheet);
    expect(serialized).not.toContain(hiddenRow);
    expect(serialized).not.toContain('Payroll row 17');
  });

  it('rejects stale direct commit selectors without exposing the stale id', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [defaultCellChange('child')]),
    });
    const version = createVersion(provider);
    const staleBase = `commit:sha256:${'f'.repeat(64)}` as WorkbookCommitId;

    const result = await version.diff(staleBase, childCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_OBJECT',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector: 'base',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(staleBase);

    await expect(version.diff(rootCommitId, childCommitId)).resolves.toMatchObject({ ok: true });
  });

  it('rejects ambiguous merge target selectors without exposing parent ids', async () => {
    const graph = await graphWithMergeTarget();
    const version = createVersion(graph.provider);

    const result = await version.diff(graph.oursCommitId, graph.mergeCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_UNMATERIALIZABLE_COMMIT',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ operation: 'diff' }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(graph.oursCommitId);
    expect(serialized).not.toContain(graph.theirsCommitId);
    expect(serialized).not.toContain(graph.mergeCommitId);
  });
}
