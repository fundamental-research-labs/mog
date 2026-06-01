import assert from 'node:assert/strict';
import test from 'node:test';

import { applySpreadsheetConsolePolicy } from '../console-policy';

test('hidden spreadsheet console policy suppresses and restores console output methods', () => {
  const originalLog = console.log;
  let calls = 0;
  let release: (() => void) | undefined;
  console.log = () => {
    calls += 1;
  };

  try {
    release = applySpreadsheetConsolePolicy('hidden');
    console.log('hidden');
    assert.equal(calls, 0);

    release();
    release = undefined;
    console.log('visible');
    assert.equal(calls, 1);
  } finally {
    release?.();
    console.log = originalLog;
  }
});

test('hidden spreadsheet console policy is ref-counted across runtimes', () => {
  const originalWarn = console.warn;
  let calls = 0;
  let releaseA: (() => void) | undefined;
  let releaseB: (() => void) | undefined;
  console.warn = () => {
    calls += 1;
  };

  try {
    releaseA = applySpreadsheetConsolePolicy('hidden');
    releaseB = applySpreadsheetConsolePolicy('hidden');

    console.warn('still hidden');
    assert.equal(calls, 0);

    releaseA();
    releaseA = undefined;
    console.warn('still hidden after first release');
    assert.equal(calls, 0);

    releaseB();
    releaseB = undefined;
    console.warn('restored after final release');
    assert.equal(calls, 1);
  } finally {
    releaseA?.();
    releaseB?.();
    console.warn = originalWarn;
  }
});

test('visible spreadsheet console policy leaves host console methods untouched', () => {
  const originalInfo = console.info;
  let calls = 0;
  let release: (() => void) | undefined;
  console.info = () => {
    calls += 1;
  };

  try {
    release = applySpreadsheetConsolePolicy('visible');
    console.info('visible');
    release();
    release = undefined;

    assert.equal(calls, 1);
  } finally {
    release?.();
    console.info = originalInfo;
  }
});
