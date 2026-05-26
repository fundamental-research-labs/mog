import { colIndexToName, cellRef } from '../shared/column-name';

// ---------------------------------------------------------------------------
// colIndexToName
// ---------------------------------------------------------------------------

describe('colIndexToName', () => {
  it('converts 0 to A', () => {
    expect(colIndexToName(0)).toBe('A');
  });

  it('converts 25 to Z', () => {
    expect(colIndexToName(25)).toBe('Z');
  });

  it('converts 26 to AA', () => {
    expect(colIndexToName(26)).toBe('AA');
  });

  it('converts 27 to AB', () => {
    expect(colIndexToName(27)).toBe('AB');
  });

  it('converts 51 to AZ', () => {
    expect(colIndexToName(51)).toBe('AZ');
  });

  it('converts 52 to BA', () => {
    expect(colIndexToName(52)).toBe('BA');
  });

  it('converts 701 to ZZ', () => {
    expect(colIndexToName(701)).toBe('ZZ');
  });

  it('converts 702 to AAA', () => {
    expect(colIndexToName(702)).toBe('AAA');
  });
});

// ---------------------------------------------------------------------------
// cellRef
// ---------------------------------------------------------------------------

describe('cellRef', () => {
  it('converts (0, 0) to A1', () => {
    expect(cellRef(0, 0)).toBe('A1');
  });

  it('converts (0, 25) to Z1', () => {
    expect(cellRef(0, 25)).toBe('Z1');
  });

  it('converts (0, 26) to AA1', () => {
    expect(cellRef(0, 26)).toBe('AA1');
  });

  it('converts (99, 2) to C100', () => {
    expect(cellRef(99, 2)).toBe('C100');
  });
});
