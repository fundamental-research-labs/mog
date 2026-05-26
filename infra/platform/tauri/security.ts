/**
 * Security session management for Tauri desktop app.
 *
 * This module implements HMAC-based request validation for IPC commands.
 * Each request includes:
 * - An operation name
 * - A timestamp (within 30 seconds)
 * - A unique nonce (to prevent replay attacks)
 * - An HMAC-SHA256 signature: HMAC(sessionKey, "operation:timestamp:nonce")
 *
 * The session key is generated at app startup and stored in a closure,
 * making it inaccessible to XSS attacks that can only access global scope.
 *
 * IMPORTANT: Use `ensureSessionInitialized()` before calling `signRequest()`.
 * This handles race conditions during cold start when multiple components
 * may try to initialize simultaneously.
 *
 * @example
 * ```ts
 * // Preferred: Use secureInvoke which handles everything
 * import { secureInvoke } from './secure-invoke';
 * await secureInvoke('credential_store', { key, value });
 *
 * // Manual usage (if needed):
 * import { ensureSessionInitialized, signRequest } from './security';
 * await ensureSessionInitialized();
 * const { timestamp, nonce, signature } = await signRequest('credential_store');
 * await invoke('credential_store', { key, value, timestamp, nonce, signature });
 * ```
 */

import { invoke } from '@tauri-apps/api/core';
import { isDev } from '@mog/env';

/**
 * Session key management - protected in true closure (IIFE).
 * The session key is stored inside the IIFE and is not accessible
 * from the global JavaScript scope, providing protection against XSS attacks.
 */
const sessionManager = (() => {
  let sessionKey: Uint8Array | null = null;

  return {
    setKey: (key: Uint8Array) => {
      if (sessionKey !== null) {
        throw new Error('Session already initialized');
      }
      sessionKey = key;
    },
    getKey: (): Uint8Array | null => sessionKey,
    isInitialized: (): boolean => sessionKey !== null,
  };
})();

/**
 * Initialize the secure session.
 * This should be called once at app startup, before any sensitive operations.
 *
 * The session key is stored in a closure and cannot be accessed from
 * the global JavaScript scope, providing protection against XSS attacks.
 *
 * @throws Error if the session is already initialized
 */
export async function initSecureSession(): Promise<void> {
  if (sessionManager.isInitialized()) {
    throw new Error('Session already initialized');
  }

  const keyHex = await invoke<string>('init_security_session');
  sessionManager.setKey(hexToBytes(keyHex));
}

/**
 * Check if the secure session has been initialized.
 */
export function isSessionInitialized(): boolean {
  return sessionManager.isInitialized();
}

/**
 * Session initialization promise for deduplication.
 * This ensures only one initialization happens even with concurrent calls.
 */
let sessionInitPromise: Promise<void> | null = null;

/**
 * Check if we're in development mode.
 * In dev mode, we skip security entirely to avoid HMR issues.
 *
 * Detection strategy (in order):
 * 1. Vite's import.meta.env.DEV (most reliable in Vite context)
 * 2. import.meta.env.MODE === 'development'
 * 3. Check if URL contains localhost or 127.0.0.1 (fallback for HMR edge cases)
 * 4. Node.js NODE_ENV (for SSR/test contexts)
 */
const isDevelopment: boolean = (() => {
  // Vite injects import.meta.env at build time
  try {
    // Use indirect eval to defer import.meta access, preventing Jest parse errors
    const getImportMeta = new Function('return import.meta');
    const meta = getImportMeta() as ImportMeta & { env?: { DEV?: boolean; MODE?: string } };
    if (meta.env?.DEV === true) return true;
    if (meta.env?.MODE === 'development') return true;
  } catch {
    // import.meta may not be available in all contexts (e.g., Jest, SSR)
  }

  // Fallback: check if running on localhost (dev server)
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return true;
    }
  }

  // Node.js fallback
  if (isDev()) {
    return true;
  }

  return false;
})();

// Log once at module load so we can debug
console.log('[Security] isDevelopment:', isDevelopment);

/**
 * Ensure the security session is initialized.
 *
 * Safe to call multiple times - will only initialize once.
 * Handles race conditions during cold start when multiple components
 * may try to use secure commands simultaneously.
 *
 * In development mode, this is a no-op since security is bypassed anyway.
 *
 * @returns Promise that resolves when session is ready
 */
export async function ensureSessionInitialized(): Promise<void> {
  // In development mode, skip security entirely
  // Rust backend also skips signature verification in debug builds
  if (isDevelopment) {
    return;
  }

  // Already initialized
  if (sessionManager.isInitialized()) {
    return;
  }

  // Initialization in progress - wait for it
  if (sessionInitPromise) {
    return sessionInitPromise;
  }

  // Start initialization
  sessionInitPromise = (async () => {
    try {
      await initSecureSession();
    } catch (error) {
      // Reset promise so next call can retry
      sessionInitPromise = null;
      throw error;
    }
  })();

  return sessionInitPromise;
}

/**
 * Generate a cryptographically secure nonce for replay attack prevention.
 * Uses crypto.randomUUID() which generates a UUID v4.
 */
function generateNonce(): string {
  return crypto.randomUUID();
}

/**
 * Sign a request for a sensitive operation.
 *
 * @param operation - The operation name (e.g., 'credential_store', 'write_file')
 * @returns An object with timestamp, nonce, and signature to pass to the IPC command
 * @throws Error if the session is not initialized (in production)
 */
export async function signRequest(
  operation: string,
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  // In development mode, return dummy values
  // Rust backend skips signature verification in debug builds
  if (isDevelopment) {
    return {
      timestamp: Math.floor(Date.now() / 1000),
      nonce: generateNonce(),
      signature: 'dev-mode-signature',
    };
  }

  const sessionKey = sessionManager.getKey();
  if (!sessionKey) {
    throw new Error('Session not initialized. Call initSecureSession() first.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();
  const message = `${operation}:${timestamp}:${nonce}`;
  const signature = await hmacSha256(sessionKey, message);

  return { timestamp, nonce, signature };
}

/**
 * Create a secure API wrapper that automatically signs requests.
 *
 * This returns an object with methods that:
 * 1. Generate a fresh signature and nonce for each request
 * 2. Include the timestamp, nonce, and signature in the IPC call
 *
 * The session key is captured in the closure and cannot be accessed
 * from the global scope.
 *
 * @example
 * ```ts
 * const api = await createSecureApi();
 * await api.credentialStore('my_key', 'my_secret');
 * ```
 */
export async function createSecureApi(): Promise<SecureApi> {
  // In development mode, skip session initialization
  // Rust backend also skips signature verification in debug builds
  if (!isDevelopment && !sessionManager.isInitialized()) {
    await initSecureSession();
  }

  return {
    /**
     * Store a credential with automatic request signing.
     */
    credentialStore: async (key: string, value: string): Promise<void> => {
      const { timestamp, nonce, signature } = await signRequest('credential_store');
      return invoke('credential_store', {
        key,
        value,
        timestamp,
        nonce,
        signature,
      });
    },

    /**
     * Delete a credential with automatic request signing.
     */
    credentialDelete: async (key: string): Promise<void> => {
      const { timestamp, nonce, signature } = await signRequest('credential_delete');
      return invoke('credential_delete', { key, timestamp, nonce, signature });
    },

    /**
     * Get a credential with automatic request signing.
     */
    credentialGet: async (key: string): Promise<string | null> => {
      const { timestamp, nonce, signature } = await signRequest('credential_get');
      return invoke('credential_get', { key, timestamp, nonce, signature });
    },

    /**
     * Check if a credential exists with automatic request signing.
     */
    credentialExists: async (key: string): Promise<boolean> => {
      const { timestamp, nonce, signature } = await signRequest('credential_exists');
      return invoke('credential_exists', { key, timestamp, nonce, signature });
    },

    /**
     * List all credential keys with automatic request signing.
     */
    credentialListKeys: async (): Promise<string[]> => {
      const { timestamp, nonce, signature } = await signRequest('credential_list_keys');
      return invoke('credential_list_keys', { timestamp, nonce, signature });
    },

    /**
     * List all credentials with existence status with automatic request signing.
     */
    credentialList: async (): Promise<Array<{ key: string; exists: boolean }>> => {
      const { timestamp, nonce, signature } = await signRequest('credential_list');
      return invoke('credential_list', { timestamp, nonce, signature });
    },

    /**
     * Sign a request for any operation.
     * Use this for operations not covered by the pre-built methods.
     */
    signRequest,
  };
}

/**
 * Secure API interface with pre-signed methods.
 */
export interface SecureApi {
  credentialStore: (key: string, value: string) => Promise<void>;
  credentialDelete: (key: string) => Promise<void>;
  credentialGet: (key: string) => Promise<string | null>;
  credentialExists: (key: string) => Promise<boolean>;
  credentialListKeys: () => Promise<string[]>;
  credentialList: () => Promise<Array<{ key: string; exists: boolean }>>;
  signRequest: (
    operation: string,
  ) => Promise<{ timestamp: number; nonce: string; signature: string }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Compute HMAC-SHA256 using the Web Crypto API.
 *
 * @param key - The secret key
 * @param message - The message to sign
 * @returns The hex-encoded HMAC signature
 */
async function hmacSha256(key: Uint8Array, message: string): Promise<string> {
  // Create a new ArrayBuffer copy of the key to satisfy strict TypeScript types
  // This avoids issues with SharedArrayBuffer compatibility
  const keyBuffer = new ArrayBuffer(key.length);
  new Uint8Array(keyBuffer).set(key);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
