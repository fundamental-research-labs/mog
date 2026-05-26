import type {
  EmbedMode,
  MogEmbedCollaborationMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedSavePolicy,
} from './config';

// ---------------------------------------------------------------------------
// Trust context
// ---------------------------------------------------------------------------

/** @stability bundled-implementation */
export type TrustBoundary =
  | 'iframe-child'
  | 'publish'
  | 'same-origin-trusted'
  | 'same-origin-untrusted';

/** @stability bundled-implementation */
export interface TrustContext {
  boundary: TrustBoundary;
  availableCapabilities: readonly string[];
  availableSavePolicies: readonly MogEmbedSavePolicy[];
  availableCollaborationModes: readonly MogEmbedCollaborationMode[];
  /** Max mode the host will grant. Defaults to 'full-edit' for trusted contexts. */
  maxMode?: EmbedMode;
}

// ---------------------------------------------------------------------------
// Ordered enums for narrowing comparisons
// ---------------------------------------------------------------------------

const MODE_RANK: Record<EmbedMode, number> = {
  readonly: 0,
  comment: 1,
  review: 2,
  'protected-edit': 3,
  'full-edit': 4,
};

const SAVE_RANK: Record<MogEmbedSavePolicy, number> = {
  none: 0,
  'export-only': 1,
  'host-callback': 2,
  autosave: 3,
};

const COLLAB_RANK: Record<MogEmbedCollaborationMode, number> = {
  none: 0,
  'local-only': 1,
  live: 2,
};

// ---------------------------------------------------------------------------
// Defaults per trust boundary
// ---------------------------------------------------------------------------

const IFRAME_DEFAULT_MAX_MODE: EmbedMode = 'protected-edit';
const TRUSTED_DEFAULT_MAX_MODE: EmbedMode = 'full-edit';

function defaultMaxMode(boundary: TrustBoundary): EmbedMode {
  if (boundary === 'same-origin-trusted') return TRUSTED_DEFAULT_MAX_MODE;
  if (boundary === 'publish') return 'readonly';
  return IFRAME_DEFAULT_MAX_MODE;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function narrowMode(requested: EmbedMode, ceiling: EmbedMode): EmbedMode {
  return MODE_RANK[requested] <= MODE_RANK[ceiling] ? requested : ceiling;
}

function narrowSave(
  requested: MogEmbedSavePolicy,
  available: readonly MogEmbedSavePolicy[],
): MogEmbedSavePolicy {
  if (available.includes(requested)) return requested;
  // Pick the highest available that doesn't exceed the requested rank.
  const requestedRank = SAVE_RANK[requested];
  let best: MogEmbedSavePolicy = 'none';
  for (const p of available) {
    if (SAVE_RANK[p] <= requestedRank && SAVE_RANK[p] > SAVE_RANK[best]) {
      best = p;
    }
  }
  return best;
}

function narrowCollab(
  requested: MogEmbedCollaborationMode,
  available: readonly MogEmbedCollaborationMode[],
): MogEmbedCollaborationMode {
  if (available.includes(requested)) return requested;
  const requestedRank = COLLAB_RANK[requested];
  let best: MogEmbedCollaborationMode = 'none';
  for (const m of available) {
    if (COLLAB_RANK[m] <= requestedRank && COLLAB_RANK[m] > COLLAB_RANK[best]) {
      best = m;
    }
  }
  return best;
}

function intersectCapabilities(
  requested: readonly string[],
  available: readonly string[],
): { granted: readonly string[]; denied: readonly string[] } {
  const availSet = new Set(available);
  const granted: string[] = [];
  const denied: string[] = [];
  for (const cap of requested) {
    if (availSet.has(cap)) {
      granted.push(cap);
    } else {
      denied.push(cap);
    }
  }
  return { granted, denied };
}

/** @stability bundled-implementation */
export function resolveEffectiveState(
  config: MogEmbedConfig,
  trust: TrustContext,
): MogEmbedEffectiveState {
  const maxMode = trust.maxMode ?? defaultMaxMode(trust.boundary);
  const requestedMode = config.requestedMode ?? 'readonly';

  const mode = narrowMode(requestedMode, maxMode);

  const { granted, denied } = intersectCapabilities(
    config.requestedCapabilities ?? [],
    trust.availableCapabilities,
  );

  const savePolicy = narrowSave(config.requestedSavePolicy ?? 'none', trust.availableSavePolicies);

  const collaboration = narrowCollab(
    config.requestedCollaboration ?? 'none',
    trust.availableCollaborationModes,
  );

  return {
    mode,
    capabilities: granted,
    deniedCapabilities: denied,
    savePolicy,
    collaboration,
    dirty: false,
    saveState: 'idle',
  };
}
