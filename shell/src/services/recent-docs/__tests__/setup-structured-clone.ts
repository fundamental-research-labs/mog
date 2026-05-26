/**
 * Polyfill `globalThis.structuredClone` in the jsdom test environment.
 *
 * jsdom 26 doesn't define `structuredClone` on its Window, and Jest's
 * jsdom env makes `globalThis === window` — so the fake-indexeddb
 * value-cloning path sees `structuredClone is not defined`.
 *
 * Node 17+ has `structuredClone` on the *Node* global; we pull it onto
 * the jsdom global via the V8 serialization API (round-trip through
 * `serialize`/`deserialize`) when the runtime doesn't provide it.
 *
 * Loaded via `setupFiles` in jest config so it runs before any test
 * module's imports. Safe to load multiple times — the install is
 * idempotent (`if (!globalThis.structuredClone)`).
 */

import { deserialize, serialize } from 'node:v8';

if (
  typeof (globalThis as { structuredClone?: typeof structuredClone }).structuredClone !== 'function'
) {
  (globalThis as { structuredClone: (v: unknown) => unknown }).structuredClone = (v: unknown) =>
    deserialize(serialize(v));
}
