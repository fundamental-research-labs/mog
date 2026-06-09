import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToNumberArray, numberArrayToBytes, parseWebviewMessage } from '../../src/protocol.js';

test('byte helpers round-trip Uint8Array payloads', () => {
  const bytes = new Uint8Array([0, 1, 127, 255]);
  const numbers = bytesToNumberArray(bytes);
  assert.deepEqual(numbers, [0, 1, 127, 255]);
  assert.deepEqual(Array.from(numberArrayToBytes(numbers)), [0, 1, 127, 255]);
});

test('parseWebviewMessage accepts valid save-result payloads', () => {
  const parsed = parseWebviewMessage({
    type: 'save-result',
    requestId: 'request-1',
    saveRequestId: 'save-1',
    workbookId: 'workbook-1',
    epoch: 1,
    dirtyEpoch: 1,
    changeSequence: 3,
    bytes: [80, 75, 3, 4],
    bytesHash: 'hash',
  });
  assert.equal(parsed?.type, 'save-result');
});

test('parseWebviewMessage rejects invalid byte arrays', () => {
  const parsed = parseWebviewMessage({
    type: 'backup-result',
    requestId: 'request-1',
    bytes: [1, 2, 999],
  });
  assert.equal(parsed, null);
});

test('parseWebviewMessage preserves request ids on errors', () => {
  const parsed = parseWebviewMessage({
    type: 'error',
    operation: 'request-save',
    requestId: 'request-1',
    message: 'failed',
  });
  assert.deepEqual(parsed, {
    type: 'error',
    operation: 'request-save',
    requestId: 'request-1',
    message: 'failed',
    stack: undefined,
  });
});
