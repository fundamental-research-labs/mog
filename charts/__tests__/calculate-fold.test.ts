/**
 * Calculate and fold transform tests
 *
 * Tests applyTransform with calculate and fold transforms, which have
 * zero coverage in the existing transform tests.
 */
import type { DataRow, Transform } from '../src/grammar/spec';
import { applyTransform, applyTransforms } from '../src/grammar/transforms';

// ---------------------------------------------------------------------------
// Calculate transform via applyTransform
// ---------------------------------------------------------------------------

describe('calculate transform', () => {
  const data: DataRow[] = [
    { a: 10, b: 20 },
    { a: 5, b: 3 },
    { a: 0, b: 7 },
  ];

  it('simple field reference', () => {
    const t: Transform = { type: 'calculate', calculate: 'a', as: 'copy_a' };
    const result = applyTransform(t, data);
    expect(result[0].copy_a).toBe(10);
    expect(result[1].copy_a).toBe(5);
  });

  it('field reference with datum. prefix', () => {
    const t: Transform = { type: 'calculate', calculate: 'datum.a', as: 'copy_a' };
    const result = applyTransform(t, data);
    expect(result[0].copy_a).toBe(10);
  });

  it('addition: field + field', () => {
    const t: Transform = { type: 'calculate', calculate: 'a + b', as: 'sum' };
    const result = applyTransform(t, data);
    expect(result[0].sum).toBe(30);
    expect(result[1].sum).toBe(8);
  });

  it('subtraction: field - field', () => {
    const t: Transform = { type: 'calculate', calculate: 'a - b', as: 'diff' };
    const result = applyTransform(t, data);
    expect(result[0].diff).toBe(-10);
    expect(result[1].diff).toBe(2);
  });

  it('multiplication: field * constant', () => {
    const t: Transform = { type: 'calculate', calculate: 'a * 2', as: 'doubled' };
    const result = applyTransform(t, data);
    expect(result[0].doubled).toBe(20);
    expect(result[1].doubled).toBe(10);
  });

  it('division: field / field', () => {
    const t: Transform = { type: 'calculate', calculate: 'a / b', as: 'ratio' };
    const result = applyTransform(t, data);
    expect(result[0].ratio).toBe(0.5);
  });

  it('division by zero returns null', () => {
    const zeroData: DataRow[] = [{ a: 10, b: 0 }];
    const t: Transform = { type: 'calculate', calculate: 'a / b', as: 'ratio' };
    const result = applyTransform(t, zeroData);
    expect(result[0].ratio).toBeNull();
  });

  it('non-numeric field returns null for arithmetic', () => {
    const strData: DataRow[] = [{ a: 'hello', b: 3 }];
    const t: Transform = { type: 'calculate', calculate: 'a + b', as: 'result' };
    const result = applyTransform(t, strData);
    expect(result[0].result).toBeNull();
  });

  it('string concatenation: field + " " + field', () => {
    const nameData: DataRow[] = [{ first: 'John', last: 'Doe' }];
    const t: Transform = { type: 'calculate', calculate: 'first + " " + last', as: 'full' };
    const result = applyTransform(t, nameData);
    expect(result[0].full).toBe('John Doe');
  });

  it('unsupported expression returns null', () => {
    const t: Transform = { type: 'calculate', calculate: 'Math.sqrt(a)', as: 'result' };
    const result = applyTransform(t, data);
    expect(result[0].result).toBeNull();
  });

  it('preserves original data fields', () => {
    const t: Transform = { type: 'calculate', calculate: 'a * 2', as: 'doubled' };
    const result = applyTransform(t, data);
    expect(result[0].a).toBe(10);
    expect(result[0].b).toBe(20);
    expect(result[0].doubled).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Fold transform via applyTransform
// ---------------------------------------------------------------------------

describe('fold transform', () => {
  const data: DataRow[] = [
    { id: 1, sales: 100, cost: 60 },
    { id: 2, sales: 200, cost: 120 },
  ];

  it('basic fold with default as', () => {
    const t: Transform = { type: 'fold', fold: ['sales', 'cost'], as: ['key', 'value'] };
    const result = applyTransform(t, data);
    expect(result).toHaveLength(4); // 2 rows x 2 fold fields
    expect(result[0].key).toBe('sales');
    expect(result[0].value).toBe(100);
    expect(result[1].key).toBe('cost');
    expect(result[1].value).toBe(60);
  });

  it('non-fold fields are preserved', () => {
    const t: Transform = { type: 'fold', fold: ['sales', 'cost'], as: ['metric', 'amount'] };
    const result = applyTransform(t, data);
    expect(result[0].id).toBe(1);
    expect(result[0].metric).toBe('sales');
    expect(result[0].amount).toBe(100);
  });

  it('fold fields are removed from output rows', () => {
    const t: Transform = { type: 'fold', fold: ['sales', 'cost'], as: ['key', 'value'] };
    const result = applyTransform(t, data);
    for (const row of result) {
      expect(row).not.toHaveProperty('sales');
      expect(row).not.toHaveProperty('cost');
    }
  });

  it('custom as names', () => {
    const t: Transform = { type: 'fold', fold: ['sales', 'cost'], as: ['metric', 'amount'] };
    const result = applyTransform(t, data);
    expect(result[0]).toHaveProperty('metric');
    expect(result[0]).toHaveProperty('amount');
  });

  it('single fold field', () => {
    const t: Transform = { type: 'fold', fold: ['sales'], as: ['key', 'value'] };
    const result = applyTransform(t, data);
    expect(result).toHaveLength(2); // 2 rows x 1 fold field
    expect(result[0].key).toBe('sales');
    expect(result[0].value).toBe(100);
  });

  it('fold with missing field value produces undefined', () => {
    const sparseData: DataRow[] = [{ id: 1, sales: 100 }]; // no 'cost' field
    const t: Transform = { type: 'fold', fold: ['sales', 'cost'], as: ['key', 'value'] };
    const result = applyTransform(t, sparseData);
    expect(result).toHaveLength(2);
    const costRow = result.find((r) => r.key === 'cost');
    expect(costRow?.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyTransforms pipeline with calculate + fold
// ---------------------------------------------------------------------------

describe('applyTransforms pipeline', () => {
  it('calculate then fold', () => {
    const data: DataRow[] = [
      { revenue: 100, costs: 60 },
      { revenue: 200, costs: 120 },
    ];
    const transforms: Transform[] = [
      { type: 'calculate', calculate: 'revenue - costs', as: 'profit' },
      { type: 'fold', fold: ['revenue', 'costs', 'profit'], as: ['metric', 'value'] },
    ];
    const result = applyTransforms(transforms, data);
    expect(result).toHaveLength(6); // 2 rows x 3 fold fields
    const profitRows = result.filter((r) => r.metric === 'profit');
    expect(profitRows).toHaveLength(2);
    expect(profitRows[0].value).toBe(40);
    expect(profitRows[1].value).toBe(80);
  });

  it('empty transform array returns original data', () => {
    const data: DataRow[] = [{ a: 1 }];
    expect(applyTransforms([], data)).toBe(data);
  });
});
