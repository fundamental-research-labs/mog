import { jest } from '@jest/globals';

import type {
  SemanticWorkbookDiff,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import type { VersionSemanticStateReaderPort } from '../../../document/version-store/semantic-state-reader';

export function semanticState(label: string, seed: string): SemanticWorkbookStateEnvelope {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: label,
      domains: {},
      sheets: {},
    },
    stateDigest: semanticDigest(seed),
  };
}

export function semanticStateReader(
  currentState: SemanticWorkbookStateEnvelope,
  baseState: SemanticWorkbookStateEnvelope,
): VersionSemanticStateReaderPort & {
  readonly readCurrentSemanticState: jest.MockedFunction<
    VersionSemanticStateReaderPort['readCurrentSemanticState']
  >;
  readonly diffSemanticStates: jest.MockedFunction<
    VersionSemanticStateReaderPort['diffSemanticStates']
  >;
} {
  return {
    readCurrentSemanticState: jest.fn().mockResolvedValue(currentState),
    diffSemanticStates: jest.fn().mockResolvedValue({
      beforeDigest: baseState.stateDigest,
      afterDigest: currentState.stateDigest,
      changes: [],
      coverage: [],
      diagnostics: [],
    } satisfies SemanticWorkbookDiff),
  };
}

export function snapshotPort(seed: number) {
  return {
    encodeDiff: jest.fn().mockResolvedValue(new Uint8Array([seed, seed + 1, seed + 2])),
  };
}

export function objectDigest(seed: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    digest: seed.repeat(64).slice(0, 64),
  };
}

function semanticDigest(seed: string): SemanticWorkbookStateEnvelope['stateDigest'] {
  return {
    algorithm: 'sha256',
    value: seed.repeat(64).slice(0, 64),
  };
}
