/**
 * Scroll-Commit Coordination Tests
 *
 * Verifies that scrolling while editing commits the edit (Excel behavior).
 */
import { jest } from '@jest/globals';
import { setupScrollCommitCoordination } from '../../coordination/scroll-commit-coordination';

// =============================================================================
// Helpers
// =============================================================================

/** Create a mock editor actor with configurable state matching */
function createMockEditorActor(matchingStates: string[] = []) {
  const sent: Array<{ type: string; direction?: string }> = [];
  return {
    actor: {
      getSnapshot: () => ({
        matches: (state: string) => matchingStates.includes(state),
      }),
      subscribe: (listener: (state: { matches: (state: string) => boolean }) => void) => {
        const snapshot = {
          matches: (state: string) => matchingStates.includes(state),
        };
        listener(snapshot);
        return { unsubscribe: jest.fn() };
      },
      send: (event: { type: string; direction?: string }) => {
        sent.push(event);
      },
    } as any,
    sent,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('setupScrollCommitCoordination', () => {
  it('commits edit on scroll while editing', () => {
    const { actor, sent } = createMockEditorActor(['editing']);
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    // Simulate scroll
    scrollCallback!();

    expect(sent).toEqual([{ type: 'COMMIT', direction: 'none' }]);
  });

  it('does not commit formula point-mode on scroll', () => {
    const { actor, sent } = createMockEditorActor(['formulaEditing']);
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    scrollCallback!();

    expect(sent).toEqual([]);
  });

  it('commits edit on scroll while rich text editing', () => {
    const { actor, sent } = createMockEditorActor(['richTextEditing']);
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    scrollCallback!();

    expect(sent).toEqual([{ type: 'COMMIT', direction: 'none' }]);
  });

  it('does not commit on scroll when not editing', () => {
    const { actor, sent } = createMockEditorActor([]); // inactive
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    scrollCallback!();

    expect(sent).toEqual([]);
  });

  it('does not commit on scroll during IME composing', () => {
    // imeComposing is a top-level state — not 'editing'
    const { actor, sent } = createMockEditorActor(['imeComposing']);
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    scrollCallback!();

    expect(sent).toEqual([]);
  });

  it('does not commit on scroll during validating', () => {
    const { actor, sent } = createMockEditorActor(['validating']);
    let scrollCallback: (() => void) | null = null;

    setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    scrollCallback!();

    expect(sent).toEqual([]);
  });

  it('cleanup unsubscribes from scroll', () => {
    const { actor } = createMockEditorActor(['editing']);
    let scrollCallback: (() => void) | null = null;

    const result = setupScrollCommitCoordination({
      editorActor: actor,
      onScrollChange: (cb) => {
        scrollCallback = cb;
        return () => {
          scrollCallback = null;
        };
      },
    });

    expect(scrollCallback).not.toBeNull();

    result.cleanup();

    expect(scrollCallback).toBeNull();
  });
});
