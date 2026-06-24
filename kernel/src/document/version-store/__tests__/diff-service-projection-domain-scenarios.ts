import { createWorkbookVersionDiffService } from '../diff-service';
import {
  graphWithRootAndChild,
  redactedEntityLabelDisplay,
  validSemanticPayload,
  vc06SemanticChanges,
} from './diff-service-fixtures';

export function registerDiffServiceProjectionDomainScenarios(): void {
  it('projects provider-backed VC-06 semantic domains into public diff entries', async () => {
    const semanticChanges = vc06SemanticChanges();
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', semanticChanges),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'success',
      items: semanticChanges,
      order: 'semantic-change-order',
      diagnostics: [],
    });
    expect(result.items).toEqual(semanticChanges);
    expect(
      result.items.map((entry) =>
        entry.structural.kind === 'metadata' ? entry.structural.domain : entry.structural.kind,
      ),
    ).toEqual([
      'cells.values',
      'cells.formulas',
      'named-ranges',
      'tables',
      'comments-notes',
      'conditional-formatting',
      'data-validation',
      'filters',
      'sorts',
      'charts.source-range',
      'floating-objects.anchors',
    ]);
    expect(
      result.items.find(
        (entry) =>
          entry.structural.kind === 'metadata' &&
          entry.structural.changeId === 'vc06-named-range-definition',
      )?.display,
    ).toEqual(redactedEntityLabelDisplay());
    expect(JSON.stringify(result)).not.toContain('secretFormula');
  });
}
