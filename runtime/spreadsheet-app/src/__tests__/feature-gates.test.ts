import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeFeatureGates } from '../feature-gates';

test('version-control feature gates fail closed without weakening host capability policy', () => {
  const unavailable = mergeFeatureGates(
    {
      capabilities: {
        versionControl: true,
        versionControlMerge: true,
        'versionControl.merge': true,
        customHostCapability: true,
      },
    },
    undefined,
    undefined,
    undefined,
    { versionControl: false },
  );

  assert.equal(unavailable.capabilities?.versionControl, false);
  assert.equal(unavailable.capabilities?.versionControlMerge, false);
  assert.equal(unavailable.capabilities?.['versionControl.merge'], false);
  assert.equal(unavailable.capabilities?.customHostCapability, true);

  const available = mergeFeatureGates(
    {
      capabilities: {
        versionControl: false,
        versionControlMerge: false,
        'versionControl.merge': false,
      },
    },
    undefined,
    undefined,
    undefined,
    { versionControl: true },
  );

  assert.equal(available.capabilities?.versionControl, false);
  assert.equal(available.capabilities?.versionControlMerge, false);
  assert.equal(available.capabilities?.['versionControl.merge'], false);
});
