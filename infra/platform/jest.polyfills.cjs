// TextEncoder/TextDecoder polyfill for jsdom under ESM mode.
// Node's `util` provides them; jsdom leaves them off `globalThis` under ESM.
const { TextEncoder, TextDecoder } = require('util');
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;
