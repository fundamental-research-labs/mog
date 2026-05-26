import {
  canRequestExportFromEffectiveState,
  canRequestSaveFromEffectiveState,
} from '../host-adapters/effective-state-gates';
import type { MogEmbedEffectiveState } from '../config';

function state(overrides: Partial<MogEmbedEffectiveState> = {}): MogEmbedEffectiveState {
  return {
    mode: 'readonly',
    capabilities: [],
    deniedCapabilities: [],
    savePolicy: 'none',
    collaboration: 'none',
    dirty: false,
    saveState: 'idle',
    ...overrides,
  };
}

describe('same-page host effective-state gates', () => {
  it('denies save when only a callback exists but effective state has no save grant', () => {
    expect(
      canRequestSaveFromEffectiveState(
        state({
          capabilities: [],
          savePolicy: 'host-callback',
        }),
      ),
    ).toBe(false);
  });

  it('denies save for export-only policy even with save capability', () => {
    expect(
      canRequestSaveFromEffectiveState(
        state({
          capabilities: ['save'],
          savePolicy: 'export-only',
        }),
      ),
    ).toBe(false);
  });

  it('allows save when capability and compatible save policy are both effective', () => {
    expect(
      canRequestSaveFromEffectiveState(
        state({
          capabilities: ['save'],
          savePolicy: 'host-callback',
        }),
      ),
    ).toBe(true);
  });

  it('denies manual host-callback save for live collaboration sessions', () => {
    expect(
      canRequestSaveFromEffectiveState(
        state({
          capabilities: ['save'],
          savePolicy: 'host-callback',
          collaboration: 'live',
        }),
      ),
    ).toBe(false);
  });

  it('allows autosave for live collaboration sessions when save is granted', () => {
    expect(
      canRequestSaveFromEffectiveState(
        state({
          capabilities: ['save'],
          savePolicy: 'autosave',
          collaboration: 'live',
        }),
      ),
    ).toBe(true);
  });

  it('denies export without export capability regardless of callback availability', () => {
    expect(
      canRequestExportFromEffectiveState(
        state({
          capabilities: [],
          savePolicy: 'export-only',
        }),
      ),
    ).toBe(false);
  });

  it('denies export when the effective save policy is none', () => {
    expect(
      canRequestExportFromEffectiveState(
        state({
          capabilities: ['export'],
          savePolicy: 'none',
        }),
      ),
    ).toBe(false);
  });

  it('allows export when export capability and export-compatible policy are effective', () => {
    expect(
      canRequestExportFromEffectiveState(
        state({
          capabilities: ['export'],
          savePolicy: 'export-only',
        }),
      ),
    ).toBe(true);
  });
});
