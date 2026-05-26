/**
 * Jest Setup File
 *
 * This file runs before all tests and sets up necessary mocks and configurations.
 */

// Mock Worker API for tests that don't actually need to execute workers
global.Worker = class Worker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    // No-op in mock
  }

  terminate() {
    // No-op in mock
  }

  addEventListener(event, handler) {
    // No-op in mock
  }

  removeEventListener(event, handler) {
    // No-op in mock
  }
};

// Mock URL API for Worker creation
if (typeof URL === 'undefined' || !URL.prototype) {
  global.URL = class URL {
    constructor(url, base) {
      this.href = url;
      this.toString = () => this.href;
    }
  };
}

// Polyfill TextEncoder/TextDecoder when running under jsdom — production
// browsers and Node.js have these globally, but the jsdom environment
// configured here doesn't expose them. EXPORT_AS_CSV uses TextEncoder to
// turn the worksheet CSV string into a Uint8Array before writing through
// the platform handle.
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
