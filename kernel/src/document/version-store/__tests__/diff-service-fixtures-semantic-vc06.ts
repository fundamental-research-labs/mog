import { vc06DefinitionSemanticChanges } from './diff-service-fixtures-semantic-vc06-definitions';
import { vc06ViewObjectSemanticChanges } from './diff-service-fixtures-semantic-vc06-view-objects';

export function vc06SemanticChanges() {
  return [
    ...vc06DefinitionSemanticChanges(),
    ...vc06ViewObjectSemanticChanges(),
  ];
}
