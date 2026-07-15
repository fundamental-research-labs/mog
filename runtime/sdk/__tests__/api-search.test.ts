import { api } from '../src/api-describe';

describe('SDK API search', () => {
  it('finds methods by concept and returns exact describe paths', () => {
    const hits = api.search('column width');

    expect(hits.some((hit) => hit.path === 'ws.layout.setColumnWidth')).toBe(true);
    for (const hit of hits) {
      expect(api.describe(hit.path)).not.toBeNull();
    }
  });

  it('is case-insensitive and camelCase-aware', () => {
    expect(api.search('SET COLUMN WIDTH')[0]?.path).toBe('ws.layout.setColumnWidth');
    expect(api.search('setColumnWidth')[0]?.path).toBe('ws.layout.setColumnWidth');
  });

  it('searches current type definitions and semantic documentation', () => {
    const chartConfig = api.search('chart anchor points', { kinds: ['type'] });

    expect(chartConfig.some((hit) => hit.path === 'type:ChartConfig')).toBe(true);
    expect(api.search('background color bold', { kinds: ['type'] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'type:CellFormatInput' })]),
    );
  });

  it('supports result kind filters and deterministic limits', () => {
    const hits = api.search('chart', { kinds: ['method'], limit: 3 });

    expect(hits).toHaveLength(3);
    expect(hits.every((hit) => hit.kind === 'method')).toBe(true);
    expect(api.search('chart', { limit: 0 })).toEqual([]);
  });

  it('returns no results for empty or unknown queries', () => {
    expect(api.search('')).toEqual([]);
    expect(api.search('definitely-not-a-mog-api-concept')).toEqual([]);
  });
});
