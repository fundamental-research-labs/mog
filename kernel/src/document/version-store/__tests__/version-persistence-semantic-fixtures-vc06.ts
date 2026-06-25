import { vc06DefinitionSemanticChanges } from './version-persistence-semantic-fixtures-vc06-definitions';
import { vc06ViewObjectSemanticChanges } from './version-persistence-semantic-fixtures-vc06-view-objects';

export function vc06SemanticChangeSetPayload() {
  return {
    schemaVersion: 1,
    changes: [...vc06DefinitionSemanticChanges(), ...vc06ViewObjectSemanticChanges()],
  };
}
