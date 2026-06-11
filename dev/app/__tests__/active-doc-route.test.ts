import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextSearchForActiveDoc } from '../src/routing/active-doc-route.ts';

describe('nextSearchForActiveDoc', () => {
  it('sets doc and removes one-shot new while preserving unrelated params', () => {
    assert.equal(
      nextSearchForActiveDoc('?new=1&theme=dark', 'file-123'),
      '?theme=dark&doc=file-123',
    );
  });

  it('removes doc on close-to-null without clearing other params', () => {
    assert.equal(nextSearchForActiveDoc('?doc=file-123&view=grid', null), '?view=grid');
  });

  it('returns an empty search when no params remain', () => {
    assert.equal(nextSearchForActiveDoc('?new=1&doc=file-123', null), '');
  });

  it('keeps collaboration documents on the collab route', () => {
    assert.equal(
      nextSearchForActiveDoc('?doc=file-123&view=grid', 'file-123', {
        kind: 'collaboration',
        roomId: 'room-abc',
      }),
      '?view=grid&collab=room-abc',
    );
  });

  it('removes stale collab params for normal documents', () => {
    assert.equal(
      nextSearchForActiveDoc('?collab=room-abc&view=grid', 'file-123', {
        kind: 'normal',
      }),
      '?view=grid&doc=file-123',
    );
  });
});
