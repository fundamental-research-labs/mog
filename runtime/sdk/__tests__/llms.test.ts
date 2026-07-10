import { readFileSync } from 'node:fs';
import { api } from '../src/api-describe';

const llms = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');

describe('SDK llms.txt contract', () => {
  it('keeps every literal api.describe path resolvable', () => {
    const paths = [...llms.matchAll(/api\.describe\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
      (match) => match[1],
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(api.describe(path)).not.toBeNull();
    }
  });

  it('keeps documented search queries productive', () => {
    const queries = [...llms.matchAll(/api\.search\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
      (match) => match[1],
    );

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(api.search(query).length).toBeGreaterThan(0);
    }
  });

  it('contains generated high-risk contracts and no known stale claims', () => {
    expect(llms).toContain('<!-- BEGIN GENERATED:API-CONTRACTS -->');
    expect(llms).toContain('<!-- END GENERATED:API-CONTRACTS -->');
    expect(llms).toContain("api.describe('type:CellFormatInput')");
    expect(llms).not.toContain("tags: ['action']");
    expect(llms).not.toMatch(/\b582 spreadsheet formula functions\b/);
  });
});
