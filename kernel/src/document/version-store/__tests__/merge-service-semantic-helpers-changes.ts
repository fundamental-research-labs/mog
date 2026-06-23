export function validSemanticPayload(changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    changes,
  };
}

export function valueChange(
  changeId: string,
  domain: string,
  entityId: string,
  propertyPath: readonly string[],
  before: unknown,
  after: unknown,
) {
  return {
    changeId,
    domain,
    entityId,
    propertyPath,
    before: { kind: 'value', value: before },
    after: { kind: 'value', value: after },
    display: {
      address: { kind: 'value', value: entityId.split('!')[1] ?? entityId },
    },
  };
}

export function rowColumnOrderChange(
  changeId: string,
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
  beforePresent: boolean,
  afterPresent: boolean,
) {
  const value = rowColumnValue(sheetId, axis, index);
  return {
    changeId,
    domain: 'rows-columns',
    entityId: `${sheetId}!${axis}:${index}`,
    propertyPath: ['order'],
    before: { kind: 'value', value: beforePresent ? value : null },
    after: { kind: 'value', value: afterPresent ? value : null },
    display: { address: { kind: 'value', value: displayRef(axis, index) } },
  };
}

export function rowColumnValue(sheetId: string, axis: 'row' | 'column', index: number) {
  return {
    kind: 'object',
    fields: [
      { key: 'axis', value: axis },
      { key: 'sheetId', value: sheetId },
      { key: 'index', value: index },
      { key: 'displayRef', value: displayRef(axis, index) },
    ],
  };
}

function displayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') return `${index + 1}:${index + 1}`;
  const label = columnLabel(index);
  return `${label}:${label}`;
}

function columnLabel(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = `${String.fromCharCode(65 + remainder)}${label}`;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}
