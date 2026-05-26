#!/usr/bin/env node
/**
 * Hand-encode the synthetic-trap WebAssembly module without depending
 * on wat2wasm / binaryen. The output is bit-identical to what
 * `wat2wasm synthetic-trap.wat -o synthetic-trap.wasm` would emit (up
 * to canonical encoder choices for SLEB128/ULEB128 widths — wat2wasm
 * uses minimum-byte encodings, which this script also does).
 *
 * Usage:
 *     node regenerate.mjs
 *     # writes synthetic-trap.wasm next to this script
 *
 * Why hand-encoded: the .wasm is checked into git so tests don't need
 * a binaryen install in CI. This script is the regeneration path of
 * record. It mirrors the .wat source in this directory line-for-line.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function encodeULEB128(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function encodeSLEB128(n) {
  const out = [];
  let more = true;
  while (more) {
    let byte = n & 0x7f;
    n >>= 7;
    const signBit = byte & 0x40;
    if ((n === 0 && !signBit) || (n === -1 && signBit)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte & 0xff);
  }
  return out;
}

function section(id, bytes) {
  return [id, ...encodeULEB128(bytes.length), ...bytes];
}

function vec(items) {
  return [...encodeULEB128(items.length), ...items.flat()];
}

function name(s) {
  const bytes = Array.from(Buffer.from(s, 'utf8'));
  return [...encodeULEB128(bytes.length), ...bytes];
}

function code(body) {
  // Empty locals vec, then body, then `end` (0x0b).
  const inner = [...vec([]), ...body, 0x0b];
  return [...encodeULEB128(inner.length), ...inner];
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION = [0x01, 0x00, 0x00, 0x00];

// Type section: type 0 = () -> (), type 1 = () -> i32
const types = vec([
  [0x60, ...vec([]), ...vec([])],
  [0x60, ...vec([]), ...vec([[0x7f]])],
]);
const typeSec = section(1, types);

// Function section: 3 functions referencing types [0, 1, 1]
const funcSec = section(3, vec([[0x00], [0x01], [0x01]]));

// Memory section: one memory with min=1, no max.
const memSec = section(5, vec([[0x00, 0x01]]));

// Export section: memory + three trap functions.
function exportEntry(exportName, kind, idx) {
  return [...name(exportName), kind, ...encodeULEB128(idx)];
}
const exportSec = section(
  7,
  vec([
    exportEntry('memory', 0x02, 0),
    exportEntry('trap_unreachable', 0x00, 0),
    exportEntry('trap_oob_read', 0x00, 1),
    exportEntry('trap_div_zero', 0x00, 2),
  ]),
);

// Code section.
const fnUnreachable = code([0x00]); // unreachable
const fnOob = code([
  0x41, // i32.const
  ...encodeSLEB128(-2), // 0xFFFFFFFE as signed
  0x28, // i32.load
  0x02, // align=2
  0x00, // offset=0
]);
const fnDivZero = code([
  0x41, // i32.const
  ...encodeSLEB128(1),
  0x41,
  ...encodeSLEB128(0),
  0x6d, // i32.div_s
]);
const codeSec = section(10, vec([fnUnreachable, fnOob, fnDivZero]));

const wasm = Uint8Array.from([
  ...MAGIC,
  ...VERSION,
  ...typeSec,
  ...funcSec,
  ...memSec,
  ...exportSec,
  ...codeSec,
]);

const out = join(__dirname, 'synthetic-trap.wasm');
writeFileSync(out, wasm);
console.log(`wrote ${out} (${wasm.length} bytes)`);
