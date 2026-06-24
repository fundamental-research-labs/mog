import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

function readToken(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) {
    throw new Error(`Missing CSS token --${name}`);
  }
  return match[1].trim();
}

function readPxToken(css: string, name: string): number {
  const value = readToken(css, name);
  const match = value.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) {
    throw new Error(`Expected --${name} to be a px token, got ${value}`);
  }
  return Number(match[1]);
}

describe('ribbon layout tokens', () => {
  it.each([
    ['globals.css', 'src/infra/styles/globals.css'],
    ['tokens.css', 'src/infra/styles/tokens.css'],
  ])('%s reserves vertical padding inside the fixed ribbon height', (_label, tokenPath) => {
    const css = readFileSync(nodePath.resolve(APP_ROOT, tokenPath), 'utf8');

    const ribbonHeight = readPxToken(css, 'ribbon-height');
    const contentHeight = readPxToken(css, 'ribbon-content-height');
    const labelHeight = readPxToken(css, 'ribbon-label-height');
    const paddingY = readPxToken(css, 'ribbon-padding-y');

    expect(paddingY).toBeGreaterThan(0);
    expect(ribbonHeight).toBe(contentHeight + labelHeight + paddingY * 2);
  });
});
