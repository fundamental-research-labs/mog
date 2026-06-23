import { createWorkbookVersionDiffService } from '../diff-service';
import {
  entityLabelDisplay,
  graphWithRootAndChild,
  semanticObject,
  semanticRecord,
  validSemanticPayload,
} from './diff-service-fixtures';

describe('WorkbookVersionDiffService fail-closed behavior', () => {
  it('fails closed without leaking unsupported VC-06 raw payload fields', async () => {
    const rawSecret = 'Sheet1!$B$2:$B$20';
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        semanticRecord({
          changeId: 'vc06-unsupported-named-range-raw-field',
          domain: 'named-ranges',
          entityId: 'name:RevenueTotal',
          propertyPath: ['definition'],
          before: null,
          after: semanticObject([
            { key: 'kind', value: 'Set' },
            { key: 'name', value: 'RevenueTotal' },
            { key: 'secretFormula', value: rawSecret },
          ]),
          display: entityLabelDisplay('RevenueTotal'),
        }),
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain('secretFormula');
  });

  it('fails closed without fabricated entries when semantic data is missing from the payload', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: { schemaVersion: 1 },
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff({ kind: 'commit', id: rootCommitId }, { kind: 'commit', id: childCommitId }),
    ).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
  });

  it('fails closed without fabricated entries for unsupported semantic schemas', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 2,
        changes: [
          {
            id: 'skeletal-change',
            domain: 'cell',
          },
        ],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
    expect(JSON.stringify(result)).not.toContain('skeletal-change');
  });
});
