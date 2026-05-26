import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import mogScope from '../postcss-mog-scope.mjs';

async function process(css) {
  const result = await postcss([mogScope]).process(css, { from: undefined });
  return result.css;
}

describe('postcss-mog-scope', () => {
  test(':root declarations are unchanged', async () => {
    const input = ':root { --color-ss-primary: #217346; }';
    assert.equal(await process(input), input);
  });

  test(':host declarations are unchanged', async () => {
    const input = ':host { --font-ss-sans: Inter; }';
    assert.equal(await process(input), input);
  });

  test(':root inside @layer theme is unchanged', async () => {
    const input = '@layer theme { :root, :host { --color-ss-primary: #217346; } }';
    assert.equal(await process(input), input);
  });

  test('@font-face is unchanged', async () => {
    const input = '@font-face { font-family: Carlito; src: url(Carlito.ttf); }';
    assert.equal(await process(input), input);
  });

  test('@keyframes rules are unchanged', async () => {
    const input =
      '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    assert.equal(await process(input), input);
  });

  test('@layer properties rules are unchanged', async () => {
    const input = '@layer properties { *, ::before, ::after { --tw-translate-x: 0; } }';
    assert.equal(await process(input), input);
  });

  test('@layer base selectors are scoped', async () => {
    const input = '@layer base { *, ::after, ::before { box-sizing: border-box; } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] *'));
    assert.ok(result.includes('[data-mog-engine] ::after'));
    assert.ok(result.includes('[data-mog-engine] ::before'));
  });

  test('html selector becomes [data-mog-engine]', async () => {
    const input = '@layer base { html { overflow: hidden; } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] {'));
    assert.ok(!result.includes('html'));
  });

  test('body selector becomes [data-mog-engine]', async () => {
    const input = '@layer base { body { margin: 0; } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] {'));
    assert.ok(!result.includes('body'));
  });

  test('class selectors are scoped', async () => {
    const input = '.text-body { font-size: 14px; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .text-body'));
  });

  test('utility classes are scoped', async () => {
    const input = '.flex { display: flex; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .flex'));
  });

  test('::selection is scoped', async () => {
    const input = '::selection { background: blue; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] ::selection'));
  });

  test('compound selectors are scoped correctly', async () => {
    const input = '.shell-host .text-body { color: red; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .shell-host .text-body'));
  });

  test('html with descendant becomes scoped', async () => {
    const input = 'html .dark .foo { color: red; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .dark .foo'));
    assert.ok(!result.includes('html'));
  });

  test('multiple selectors in one rule are all scoped', async () => {
    const input = '.a, .b, .c { color: red; }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .a'));
    assert.ok(result.includes('[data-mog-engine] .b'));
    assert.ok(result.includes('[data-mog-engine] .c'));
  });

  test('@layer components selectors are scoped', async () => {
    const input = '@layer components { .text-body { font-size: 14px; line-height: 1.5; } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .text-body'));
  });

  test('@layer utilities selectors are scoped', async () => {
    const input = '@layer utilities { .z-ss-modal { z-index: 1000; } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .z-ss-modal'));
  });

  test('@media inside @layer is scoped', async () => {
    const input = '@layer utilities { @media (min-width: 768px) { .hidden { display: none; } } }';
    const result = await process(input);
    assert.ok(result.includes('[data-mog-engine] .hidden'));
  });
});
