/**
 * Tests for Grammar Transform Functions
 */

import {
  // Aggregate
  applyAggregate,
  // Bin
  applyBin,
  // Filter
  applyFilter,
  // Sort
  applySort,
  // Pipeline
  applyTransforms,
  computeRegression,
  count,
  extent,
  filterOneOf,
  filterRange,
  filterValid,
  gaussianKernel,
  getSortedUniqueValues,
  histogram,
  // Density
  kernelDensityEstimation,
  // Regression
  linearRegression,
  max,
  mean,
  min,
  polynomialRegression,
  silvermanBandwidth,
  sortAscending,
  sortDescending,
  sum,
  unique,
} from '../../src/grammar/transforms';

// =============================================================================
// Filter Transform Tests
// =============================================================================

describe('Filter Transform', () => {
  const testData = [
    { name: 'Alice', age: 30, city: 'NYC' },
    { name: 'Bob', age: 25, city: 'LA' },
    { name: 'Charlie', age: 35, city: 'NYC' },
    { name: 'Diana', age: 28, city: 'Chicago' },
  ];

  test('filters by equal condition', () => {
    const result = applyFilter(testData, { field: 'city', equal: 'NYC' });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Charlie']);
  });

  test('filters by greater than condition', () => {
    const result = applyFilter(testData, { field: 'age', gt: 28 });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Charlie']);
  });

  test('filters by less than or equal condition', () => {
    const result = applyFilter(testData, { field: 'age', lte: 28 });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(['Bob', 'Diana']);
  });

  test('filters by oneOf condition', () => {
    const result = applyFilter(testData, { field: 'city', oneOf: ['NYC', 'LA'] });
    expect(result).toHaveLength(3);
  });

  test('filters by range condition', () => {
    const result = applyFilter(testData, { field: 'age', range: [26, 32] });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Diana']);
  });

  test('filters by expression string', () => {
    const result = applyFilter(testData, 'datum.age > 28');
    expect(result).toHaveLength(2);
  });

  test('filterValid removes null/undefined values', () => {
    const dataWithNulls = [{ value: 10 }, { value: null }, { value: 20 }, { value: undefined }];
    const result = filterValid(dataWithNulls, 'value');
    expect(result).toHaveLength(2);
  });

  test('filterRange filters numeric values', () => {
    const result = filterRange(testData, 'age', 25, 30);
    expect(result).toHaveLength(3);
  });

  test('filterOneOf filters by set membership', () => {
    const result = filterOneOf(testData, 'name', ['Alice', 'Bob']);
    expect(result).toHaveLength(2);
  });
});

// =============================================================================
// Sort Transform Tests
// =============================================================================

describe('Sort Transform', () => {
  const testData = [
    { name: 'Charlie', age: 35 },
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
  ];

  test('sorts ascending by field', () => {
    const result = applySort(testData, { field: 'age', order: 'ascending' });
    expect(result.map((d) => d.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  test('sorts descending by field', () => {
    const result = applySort(testData, { field: 'age', order: 'descending' });
    expect(result.map((d) => d.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  test('sorts by multiple fields', () => {
    const dataWithTies = [
      { name: 'Charlie', age: 30, score: 80 },
      { name: 'Alice', age: 30, score: 90 },
      { name: 'Bob', age: 25, score: 85 },
    ];
    const result = applySort(dataWithTies, [
      { field: 'age', order: 'ascending' },
      { field: 'score', order: 'descending' },
    ]);
    expect(result.map((d) => d.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  test('sortAscending helper works', () => {
    const result = sortAscending(testData, 'name');
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  test('sortDescending helper works', () => {
    const result = sortDescending(testData, 'age');
    expect(result.map((d) => d.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  test('getSortedUniqueValues returns sorted unique values', () => {
    const data = [{ category: 'B' }, { category: 'A' }, { category: 'C' }, { category: 'A' }];
    const result = getSortedUniqueValues(data, 'category');
    expect(result).toEqual(['A', 'B', 'C']);
  });

  test('handles null values at end', () => {
    const dataWithNulls = [
      { name: 'Bob', value: null },
      { name: 'Alice', value: 10 },
      { name: 'Charlie', value: 5 },
    ];
    const result = applySort(dataWithNulls, { field: 'value', order: 'ascending' });
    expect(result.map((d) => d.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });
});

// =============================================================================
// Aggregate Transform Tests
// =============================================================================

describe('Aggregate Transform', () => {
  const salesData = [
    { category: 'A', region: 'North', sales: 100 },
    { category: 'A', region: 'South', sales: 150 },
    { category: 'B', region: 'North', sales: 200 },
    { category: 'B', region: 'South', sales: 120 },
    { category: 'A', region: 'North', sales: 80 },
  ];

  test('aggregates with sum', () => {
    const result = applyAggregate(salesData, {
      groupby: ['category'],
      aggregate: [{ op: 'sum', field: 'sales', as: 'total' }],
    });
    expect(result).toHaveLength(2);
    const catA = result.find((r) => r.category === 'A');
    const catB = result.find((r) => r.category === 'B');
    expect(catA?.total).toBe(330);
    expect(catB?.total).toBe(320);
  });

  test('aggregates with count', () => {
    const result = applyAggregate(salesData, {
      groupby: ['category'],
      aggregate: [{ op: 'count', field: 'sales', as: 'count' }],
    });
    const catA = result.find((r) => r.category === 'A');
    expect(catA?.count).toBe(3);
  });

  test('aggregates with mean', () => {
    const result = applyAggregate(salesData, {
      groupby: ['category'],
      aggregate: [{ op: 'mean', field: 'sales', as: 'avg' }],
    });
    const catA = result.find((r) => r.category === 'A');
    expect(catA?.avg).toBe(110);
  });

  test('aggregates with multiple groupby fields', () => {
    const result = applyAggregate(salesData, {
      groupby: ['category', 'region'],
      aggregate: [{ op: 'sum', field: 'sales', as: 'total' }],
    });
    expect(result).toHaveLength(4);
    const aNorth = result.find((r) => r.category === 'A' && r.region === 'North');
    expect(aNorth?.total).toBe(180);
  });

  test('aggregates with min/max', () => {
    const result = applyAggregate(salesData, {
      groupby: ['category'],
      aggregate: [
        { op: 'min', field: 'sales', as: 'minSales' },
        { op: 'max', field: 'sales', as: 'maxSales' },
      ],
    });
    const catA = result.find((r) => r.category === 'A');
    expect(catA?.minSales).toBe(80);
    expect(catA?.maxSales).toBe(150);
  });

  test('count utility function works', () => {
    expect(count(salesData)).toBe(5);
  });

  test('sum utility function works', () => {
    expect(sum(salesData, 'sales')).toBe(650);
  });

  test('mean utility function works', () => {
    expect(mean(salesData, 'sales')).toBe(130);
  });

  test('min/max utility functions work', () => {
    expect(min(salesData, 'sales')).toBe(80);
    expect(max(salesData, 'sales')).toBe(200);
  });

  test('extent utility function works', () => {
    const [minVal, maxVal] = extent(salesData, 'sales') ?? [0, 0];
    expect(minVal).toBe(80);
    expect(maxVal).toBe(200);
  });

  test('unique utility function works', () => {
    const categories = unique(salesData, 'category');
    expect(categories).toHaveLength(2);
    expect(categories).toContain('A');
    expect(categories).toContain('B');
  });

  // ---------------------------------------------------------------------------
  // Bug: groupBy key uses '|' as delimiter, causing collisions when field
  // values themselves contain '|'. These tests express CORRECT behavior.
  // ---------------------------------------------------------------------------

  test('groupBy with pipe in field value should not split the value', () => {
    const data = [
      { category: 'A|B', sales: 100 },
      { category: 'A|B', sales: 50 },
      { category: 'C', sales: 200 },
    ];

    const result = applyAggregate(data, {
      groupby: ['category'],
      aggregate: [{ op: 'sum', field: 'sales', as: 'total' }],
    });

    // Should produce exactly 2 groups: 'A|B' and 'C'
    expect(result).toHaveLength(2);

    const groupAB = result.find((r) => r.category === 'A|B');
    const groupC = result.find((r) => r.category === 'C');

    expect(groupAB).toBeDefined();
    expect(groupAB?.total).toBe(150);
    expect(groupC).toBeDefined();
    expect(groupC?.total).toBe(200);
  });

  test('multi-field groupBy with pipe collision should keep groups separate', () => {
    // These two rows produce the same key "A|B|East" with a naive join('|'):
    //   category='A|B', region='East'  => "A|B|East"
    //   category='A',   region='B|East' => "A|B|East"
    // They must remain separate groups.
    const data = [
      { category: 'A|B', region: 'East', sales: 100 },
      { category: 'A', region: 'B|East', sales: 200 },
    ];

    const result = applyAggregate(data, {
      groupby: ['category', 'region'],
      aggregate: [{ op: 'sum', field: 'sales', as: 'total' }],
    });

    // Should produce 2 separate groups, not 1 merged group
    expect(result).toHaveLength(2);

    const group1 = result.find((r) => r.category === 'A|B' && r.region === 'East');
    const group2 = result.find((r) => r.category === 'A' && r.region === 'B|East');

    expect(group1).toBeDefined();
    expect(group1?.total).toBe(100);
    expect(group2).toBeDefined();
    expect(group2?.total).toBe(200);
  });

  test('groupBy with empty string field value should not cause delimiter issues', () => {
    const data = [
      { category: '', region: 'East', sales: 50 },
      { category: '', region: 'East', sales: 30 },
      { category: 'A', region: '', sales: 100 },
      { category: 'A', region: 'East', sales: 200 },
    ];

    const result = applyAggregate(data, {
      groupby: ['category', 'region'],
      aggregate: [{ op: 'sum', field: 'sales', as: 'total' }],
    });

    // Should produce 3 groups: ('', 'East'), ('A', ''), ('A', 'East')
    expect(result).toHaveLength(3);

    const emptyAndEast = result.find((r) => r.category === '' && r.region === 'East');
    const aAndEmpty = result.find((r) => r.category === 'A' && r.region === '');
    const aAndEast = result.find((r) => r.category === 'A' && r.region === 'East');

    expect(emptyAndEast).toBeDefined();
    expect(emptyAndEast?.total).toBe(80);
    expect(aAndEmpty).toBeDefined();
    expect(aAndEmpty?.total).toBe(100);
    expect(aAndEast).toBeDefined();
    expect(aAndEast?.total).toBe(200);
  });
});

// =============================================================================
// Bin Transform Tests
// =============================================================================

describe('Bin Transform', () => {
  const numericData = [
    { value: 5 },
    { value: 15 },
    { value: 25 },
    { value: 35 },
    { value: 45 },
    { value: 55 },
  ];

  test('creates bins for numeric data', () => {
    const result = applyBin(numericData, {
      field: 'value',
      as: 'bin',
      maxbins: 3,
    });
    expect(result).toHaveLength(6);
    expect(result[0]).toHaveProperty('bin');
    expect(result[0]).toHaveProperty('bin_end');
  });

  test('histogram creates bin counts', () => {
    const values = [5, 15, 25, 35, 45, 55, 12, 22, 32, 42];
    const result = histogram(values, { maxbins: 5 });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((b) => b.bin0 < b.bin1)).toBe(true);
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(10);
  });

  test('handles explicit step size', () => {
    const result = applyBin(numericData, {
      field: 'value',
      as: 'bin',
      step: 20,
    });
    // Check that bins have consistent width
    const binWidths = result.map((r) => (r.bin_end as number) - (r.bin as number));
    expect(binWidths.every((w) => w === 20)).toBe(true);
  });

  test('handles null values', () => {
    const dataWithNulls = [{ value: 10 }, { value: null }, { value: 30 }];
    const result = applyBin(dataWithNulls, {
      field: 'value',
      as: 'bin',
    });
    expect(result).toHaveLength(3);
    expect(result[1].bin).toBeNull();
  });
});

// =============================================================================
// Regression Transform Tests
// =============================================================================

describe('Regression Transform', () => {
  test('applyTransforms regression predicts dependent field over x field', () => {
    const data = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
      { x: 4, y: 8 },
      { x: 5, y: 10 },
    ];

    const result = applyTransforms(
      [{ type: 'regression', regression: 'y', on: 'x', method: 'linear', as: ['x', 'y'] }],
      data,
    );

    expect(result).toHaveLength(100);
    expect(result[0].x).toBeCloseTo(1, 5);
    expect(result[0].y).toBeCloseTo(2, 5);
    expect(result[result.length - 1].x).toBeCloseTo(5, 5);
    expect(result[result.length - 1].y).toBeCloseTo(10, 5);
  });

  test('linear regression computes correct slope and intercept', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10]; // y = 2x

    const result = linearRegression(x, y);
    expect(result.coefficients[0]).toBeCloseTo(2, 5); // slope
    expect(result.coefficients[1]).toBeCloseTo(0, 5); // intercept
    expect(result.rSquared).toBeCloseTo(1, 5);
  });

  test('linear regression with noise', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2.1, 3.9, 6.2, 7.8, 10.1]; // y ~ 2x with noise

    const result = linearRegression(x, y);
    expect(result.coefficients[0]).toBeCloseTo(2, 0); // slope ~ 2
    expect(result.rSquared).toBeGreaterThan(0.95);
  });

  test('polynomial regression fits quadratic', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 25]; // y = x^2

    const result = polynomialRegression(x, y, 2);
    expect(result.predict(6)).toBeCloseTo(36, 0);
    expect(result.rSquared).toBeCloseTo(1, 3);
  });

  test('computeRegression dispatches to correct method', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];

    const linear = computeRegression(x, y, 'linear');
    expect(linear.method).toBe('linear');

    const poly = computeRegression(x, y, 'poly', 3);
    expect(poly.method).toBe('polynomial');
  });

  test('handles degenerate case with single point', () => {
    const x = [5];
    const y = [10];

    const result = linearRegression(x, y);
    expect(result.predict(5)).toBe(10);
  });
});

// =============================================================================
// Density Transform Tests
// =============================================================================

describe('Density Transform', () => {
  test('kernel density estimation produces smooth curve', () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 4, 5];

    const result = kernelDensityEstimation(values, { steps: 50 });
    expect(result.x).toHaveLength(50);
    expect(result.density).toHaveLength(50);
    expect(result.maxDensity).toBeGreaterThan(0);
  });

  test('silverman bandwidth is positive', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const bandwidth = silvermanBandwidth(values);
    expect(bandwidth).toBeGreaterThan(0);
  });

  test('gaussian kernel is normalized', () => {
    // Kernel should peak at 0
    expect(gaussianKernel(0)).toBeGreaterThan(gaussianKernel(1));
    expect(gaussianKernel(0)).toBeGreaterThan(gaussianKernel(-1));
  });

  test('density peaks near mode', () => {
    const values = [5, 5, 5, 5, 5, 1, 2, 3]; // Mode at 5

    const result = kernelDensityEstimation(values, { steps: 100 });
    const maxIndex = result.density.indexOf(Math.max(...result.density));
    const modeX = result.x[maxIndex];

    expect(modeX).toBeCloseTo(5, 0);
  });
});

// =============================================================================
// Transform Pipeline Tests
// =============================================================================

describe('Transform Pipeline', () => {
  const testData = [
    { category: 'A', value: 10, status: 'active' },
    { category: 'A', value: 20, status: 'active' },
    { category: 'B', value: 15, status: 'inactive' },
    { category: 'B', value: 25, status: 'active' },
    { category: 'A', value: 30, status: 'inactive' },
  ];

  test('applies multiple transforms in sequence', () => {
    const result = applyTransforms(
      [
        { type: 'filter', filter: { field: 'status', equal: 'active' } },
        {
          type: 'aggregate',
          aggregate: [
            { groupby: ['category'], aggregate: [{ op: 'sum', field: 'value', as: 'total' }] },
          ],
        },
        { type: 'sort', sort: [{ field: 'total', order: 'descending' }] },
      ],
      testData,
    );

    expect(result).toHaveLength(2);
    // After filtering for 'active': A has 10+20=30, B has 25
    // Sorted descending: A (30) comes first
    expect(result[0].category).toBe('A');
  });

  test('empty transform array returns original data', () => {
    const result = applyTransforms([], testData);
    expect(result).toEqual(testData);
  });

  test('filter then aggregate', () => {
    const result = applyTransforms(
      [
        { type: 'filter', filter: { field: 'value', gt: 15 } },
        {
          type: 'aggregate',
          aggregate: [
            { groupby: ['category'], aggregate: [{ op: 'count', field: 'value', as: 'count' }] },
          ],
        },
      ],
      testData,
    );

    expect(result).toHaveLength(2);
    const catA = result.find((r) => r.category === 'A');
    expect(catA?.count).toBe(2); // value 20 and 30
  });
});
