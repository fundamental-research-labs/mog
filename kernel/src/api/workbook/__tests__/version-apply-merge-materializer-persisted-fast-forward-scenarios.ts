import { it } from '@jest/globals';

import { runPersistedFastForwardExistingDescendantScenario } from './version-apply-merge-materializer-persisted-fast-forward-existing-descendant-scenario';

export function describePersistedFastForwardMaterializerScenarios(): void {
  it(
    'applies a persisted fast-forward merge result to an existing descendant commit',
    runPersistedFastForwardExistingDescendantScenario,
  );
}
