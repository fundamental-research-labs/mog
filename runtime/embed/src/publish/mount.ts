/**
 * Imperative mount for the read-only publish view.
 *
 * The actual Rust-side redaction pipeline and artifact loading are not yet
 * available. This module provides the correct TS API surface with validation,
 * no-mutation enforcement, and placeholder rendering. When the Rust side is
 * ready, the internals change but the public contract does not.
 */

import type {
  MogPublishConfig,
  MogPublishEffectiveState,
  PublishMetadata,
  PublishSecurityPolicy,
  PublishViewHandle,
  PublishViewStatus,
  PublishChromeOptions,
} from './types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PublishConfigValidationError {
  field: string;
  message: string;
}

/**
 * Validate a publish config before mounting. Returns an array of validation
 * errors (empty = valid).
 */
export function validatePublishConfig(config: MogPublishConfig): PublishConfigValidationError[] {
  const errors: PublishConfigValidationError[] = [];

  if (!config.snapshotRef || typeof config.snapshotRef !== 'string') {
    errors.push({
      field: 'snapshotRef',
      message: 'snapshotRef is required and must be a non-empty string',
    });
  }

  if (!config.metadata) {
    errors.push({ field: 'metadata', message: 'metadata is required' });
  } else {
    if (typeof config.metadata.title !== 'string') {
      errors.push({ field: 'metadata.title', message: 'title must be a string' });
    }
    if (typeof config.metadata.description !== 'string') {
      errors.push({ field: 'metadata.description', message: 'description must be a string' });
    }
    if (typeof config.metadata.authorDisplayName !== 'string') {
      errors.push({
        field: 'metadata.authorDisplayName',
        message: 'authorDisplayName must be a string',
      });
    }
    if (typeof config.metadata.publishDate !== 'string') {
      errors.push({ field: 'metadata.publishDate', message: 'publishDate must be a string' });
    }
    if (
      typeof config.metadata.snapshotVersion !== 'number' ||
      !Number.isFinite(config.metadata.snapshotVersion)
    ) {
      errors.push({
        field: 'metadata.snapshotVersion',
        message: 'snapshotVersion must be a finite number',
      });
    }
  }

  if (config.cachePolicy !== undefined) {
    const valid = ['immutable', 'revalidate', 'versioned'];
    if (!valid.includes(config.cachePolicy)) {
      errors.push({
        field: 'cachePolicy',
        message: `cachePolicy must be one of: ${valid.join(', ')}`,
      });
    }
  }

  return errors;
}

/**
 * Create a default security policy with maximum redaction.
 */
export function createDefaultSecurityPolicy(): PublishSecurityPolicy {
  return {
    redactFormulas: true,
    stripComments: true,
    sanitizeMetadata: true,
    stripNamedRanges: false,
    stripRevisionHistory: true,
  };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function resolveChrome(chrome?: PublishChromeOptions): Required<PublishChromeOptions> {
  return {
    sheetTabs: chrome?.sheetTabs ?? true,
    headers: chrome?.headers ?? true,
    gridlines: chrome?.gridlines ?? true,
  };
}

/**
 * Mount a read-only publish view into a container element.
 *
 * The returned handle has NO mutation methods. The effective state is locked
 * to read-only values that cannot be promoted.
 *
 * @throws Error if config validation fails.
 */
export function createPublishView(
  container: HTMLElement,
  config: MogPublishConfig,
): PublishViewHandle {
  // --- Validate ---
  const validationErrors = validatePublishConfig(config);
  if (validationErrors.length > 0) {
    const msg = validationErrors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new Error(`Invalid publish config: ${msg}`);
  }

  // --- Internal state ---
  let status: PublishViewStatus = 'initializing';
  let resolveReady: () => void;
  let rejectReady: (err: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => {});

  const resolvedChrome = resolveChrome(config.chrome);

  // --- DOM setup (placeholder until Rust renderer is available) ---
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-mog-role', 'publish-view');
  wrapper.style.cssText = [
    'position: relative',
    'width: 100%',
    'height: 100%',
    'overflow: hidden',
    'display: flex',
    'flex-direction: column',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  ].join('; ');
  container.appendChild(wrapper);

  // Placeholder: show loading, then transition to ready.
  // Real implementation will load the redacted artifact via Rust bridge.
  const loadingEl = document.createElement('div');
  loadingEl.setAttribute('data-mog-role', 'publish-loading');
  loadingEl.style.cssText = [
    'position: absolute',
    'inset: 0',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'background: #FAFAFA',
    'font-size: 14px',
    'color: #999',
    'z-index: 100',
  ].join('; ');
  loadingEl.textContent = 'Loading published view…';
  wrapper.appendChild(loadingEl);

  // Simulate async artifact load (placeholder).
  status = 'loading';
  queueMicrotask(() => {
    if (status === 'disposed') return;
    loadingEl.remove();
    status = 'ready';
    resolveReady!();
  });

  // --- Effective state (frozen: no mutation paths) ---
  const effectiveState: MogPublishEffectiveState = {
    mode: 'readonly',
    savePolicy: 'none',
    collaboration: 'none',
    dirty: false,
    saveState: 'idle',
    canExport: false,
    canMutate: false,
    get status() {
      return status;
    },
    chrome: resolvedChrome,
    deterministicRender: config.deterministicRender ?? false,
  };

  // --- Handle ---
  const handle: PublishViewHandle = {
    ready: readyPromise,

    getStatus() {
      return status;
    },

    getEffectiveState() {
      return effectiveState;
    },

    getMetadata() {
      return config.metadata;
    },

    async setSheet(_indexOrName: number | string) {
      // Placeholder — real implementation navigates the rendered artifact.
    },

    async getSheetNames() {
      // Placeholder — real implementation reads from the redacted artifact.
      return [];
    },

    resize(width: number, height: number) {
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
    },

    dispose() {
      if (status === 'disposed') return;
      const wasLoading = status === 'initializing' || status === 'loading';
      status = 'disposed';
      wrapper.remove();
      if (wasLoading) {
        rejectReady!(new Error('PublishView disposed before ready'));
      }
    },
  };

  return handle;
}
