import type {
  ObjectDigest,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
} from '@mog-sdk/contracts/api';

import {
  SECRET_TABLE_ID,
  SECRET_TABLE_NAME,
} from './version-review-provider-access-helpers-constants';

export function tableDefinitionConflict(): VersionMergeConflict {
  const conflictId = 'conflict:w10-09:secret-table';
  const structural: VersionDiffStructuralMetadata = {
    kind: 'metadata',
    changeId: 'change:w10-09-secret-table',
    domain: 'tables',
    entityId: SECRET_TABLE_ID,
    propertyPath: ['definition'],
  };
  const base = tableDefinitionValue('base');
  const ours = tableDefinitionValue('ours');
  const theirs = { kind: 'redacted', reason: 'permission-denied' } as const;
  return {
    conflictId,
    conflictDigest: `sha256:${'a'.repeat(64)}`,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours),
      resolutionOption(conflictId, 'acceptTheirs', theirs),
      resolutionOption(conflictId, 'acceptBase', base),
    ],
  };
}

export function tableDefinitionValue(name: string): VersionDiffValue {
  return {
    kind: 'value',
    value: {
      kind: 'object',
      fields: [
        { key: 'kind', value: 'tableDefinition' },
        { key: 'tableId', value: SECRET_TABLE_ID },
        { key: 'name', value: `${SECRET_TABLE_NAME} ${name}` },
        { key: 'sheetId', value: 'sheet-1' },
      ],
    },
  };
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflict['resolutionOptions'][number]['kind'],
  value: VersionDiffValue,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w10-09:${kind}`,
    conflictId,
    kind,
    value,
    recalcRequired: false,
  };
}
