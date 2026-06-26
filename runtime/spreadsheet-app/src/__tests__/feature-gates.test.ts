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

test('formula AI feature gate fails closed unless a runtime service is available', () => {
  const unavailable = mergeFeatureGates(
    {
      capabilities: {
        formulaAI: true,
        customHostCapability: true,
      },
    },
    undefined,
    undefined,
    undefined,
    { formulaAI: false, versionControl: true },
  );

  assert.equal(unavailable.capabilities?.formulaAI, false);
  assert.equal(unavailable.capabilities?.customHostCapability, true);

  const available = mergeFeatureGates(
    {
      capabilities: {
        formulaAI: false,
      },
    },
    undefined,
    undefined,
    undefined,
    { formulaAI: true, versionControl: true },
  );

  assert.equal(available.capabilities?.formulaAI, false);

  const hostDefault = mergeFeatureGates(undefined, undefined, undefined, undefined, {
    formulaAI: true,
    versionControl: true,
  });
  assert.equal(hostDefault.capabilities?.formulaAI, undefined);

  const hostEnabled = mergeFeatureGates(
    { capabilities: { formulaAI: true } },
    undefined,
    undefined,
    undefined,
    { formulaAI: true, versionControl: true },
  );
  assert.equal(hostEnabled.capabilities?.formulaAI, true);
});
