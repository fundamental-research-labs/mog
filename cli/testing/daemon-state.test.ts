import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNamedPipePath,
  pidPathForState,
  socketPathForState,
  stateKeyForCwd,
} from '../src/protocol';

const stateKey = 'abc123';
const temp = join(tmpdir(), 'mog-cli-daemon-state-test');

const posixSocket = socketPathForState(stateKey, {
  platform: 'linux',
  tmpDir: temp,
  env: {},
});
assert.equal(posixSocket, join(temp, `mog-${stateKey}.sock`));
assert.equal(isNamedPipePath(posixSocket), false);

const winSocket = socketPathForState(stateKey, {
  platform: 'win32',
  tmpDir: temp,
  env: {},
});
assert.equal(winSocket, `\\\\.\\pipe\\mog-${stateKey}`);
assert.equal(isNamedPipePath(winSocket), true);
assert.equal(winSocket.endsWith('.sock'), false);

const overrideSocket = socketPathForState(stateKey, {
  platform: 'win32',
  env: { MOG_CLI_SOCKET: '\\\\.\\pipe\\custom-mog' },
});
assert.equal(overrideSocket, '\\\\.\\pipe\\custom-mog');

const overridePid = pidPathForState(stateKey, {
  env: { MOG_CLI_PID: join(temp, 'custom.pid') },
});
assert.equal(overridePid, join(temp, 'custom.pid'));

const firstCwdKey = stateKeyForCwd('/tmp/mog-one');
const secondCwdKey = stateKeyForCwd('/tmp/mog-two');
assert.notEqual(firstCwdKey, secondCwdKey);
assert.match(firstCwdKey, /^[a-f0-9]{20}$/);

console.log('daemon-state.test PASSED');
