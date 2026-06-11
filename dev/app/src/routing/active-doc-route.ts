/**
 * Host-owned route state for the active user-visible document.
 *
 * The shell owns document lifecycle state; the dev host owns URL state.
 * Keep this helper pure so route synchronization stays testable and no
 * action handler needs to know about `window.history`.
 */
export function nextSearchForActiveDoc(
  currentSearch: string,
  activeFileId: string | null,
  mode?: { readonly kind: string; readonly roomId?: string } | null,
): string {
  const normalized = currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch;
  const params = new URLSearchParams(normalized);

  params.delete('new');
  if (mode?.kind === 'collaboration' && mode.roomId) {
    params.delete('doc');
    params.set('collab', mode.roomId);
    const next = params.toString();
    return next ? `?${next}` : '';
  }

  params.delete('collab');
  if (activeFileId) {
    params.set('doc', activeFileId);
  } else {
    params.delete('doc');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}
