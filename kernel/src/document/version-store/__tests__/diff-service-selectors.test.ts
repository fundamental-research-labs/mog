import { createWorkbookVersionDiffService } from '../diff-service';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../graph';
import { appendChild, graphWithRootAndChild, validSemanticPayload } from './diff-service-fixtures';

describe('WorkbookVersionDiffService selectors', () => {
  it('resolves HEAD and refs/heads/main selectors through the visible graph', async () => {
    const { provider, rootCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 10 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff(
        { kind: 'commit', id: rootCommitId },
        { kind: 'ref', name: VERSION_GRAPH_HEAD_REF },
      ),
    ).resolves.toMatchObject({
      status: 'success',
      items: [expect.objectContaining({ after: { kind: 'value', value: 10 } })],
    });

    await expect(
      service.diff(
        { kind: 'commit', id: rootCommitId },
        { kind: 'ref', name: VERSION_GRAPH_MAIN_REF },
      ),
    ).resolves.toMatchObject({
      status: 'success',
      items: [expect.objectContaining({ after: { kind: 'value', value: 10 } })],
    });
  });

  it('fails closed when selectors do not describe a direct parent-child diff', async () => {
    const graph = await graphWithRootAndChild({
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
    const { childCommitId: grandchildCommitId } = await appendChild(graph, {
      label: 'grandchild',
      semanticPayload: validSemanticPayload('grandchild', [
        {
          changeId: 'change-2',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 2 },
          after: { kind: 'value', value: 3 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider: graph.provider });

    await expect(
      service.diff(
        { kind: 'commit', id: graph.rootCommitId },
        { kind: 'commit', id: grandchildCommitId },
      ),
    ).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNMATERIALIZABLE_COMMIT' })],
    });
  });
});
