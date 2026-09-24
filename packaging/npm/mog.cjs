#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { optionalDependencies } = require('./package.json');
const name = `@mog-sdk/cli-${process.platform}-${process.arch}`;
const executable = process.platform === 'win32' ? 'mog.exe' : 'mog';

let binary;
try {
  if (!optionalDependencies[name]) throw new Error('unsupported OS or CPU');
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('Linux binaries require glibc');
  }
  binary = require.resolve(`${name}/bin/${executable}`);
} catch (error) {
  console.error(`Mog: cannot find a native binary for ${process.platform}/${process.arch}.\n` +
    `Install @mog-sdk/cli with optional dependencies enabled, or build Mog from source.\n${error.message}`);
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
// Keep the launcher alive until the native process exits, including when the
// launcher alone receives a termination signal (rather than the whole group).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(`Mog: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
