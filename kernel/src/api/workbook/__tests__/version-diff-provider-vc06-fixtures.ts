import { vc06CellSemanticChanges } from './version-diff-provider-vc06-fixtures-cells';
import { vc06GridAutomationSemanticChanges } from './version-diff-provider-vc06-fixtures-grid-automation';
import { vc06StructuredEntitySemanticChanges } from './version-diff-provider-vc06-fixtures-structured-entities';
import { vc06VisualObjectSemanticChanges } from './version-diff-provider-vc06-fixtures-visual-objects';

export function vc06SemanticChanges() {
  return [
    ...vc06CellSemanticChanges(),
    ...vc06StructuredEntitySemanticChanges(),
    ...vc06GridAutomationSemanticChanges(),
    ...vc06VisualObjectSemanticChanges(),
  ];
}
