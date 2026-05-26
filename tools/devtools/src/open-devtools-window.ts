let devtoolsWindowRef: Window | null = null;

/**
 * Open the DevTools window (or focus it if already open).
 * Must be called from a user gesture context (e.g., keydown handler)
 * to avoid popup blockers in web mode.
 */
export async function openDevToolsWindow(): Promise<void> {
  // Tauri mode — use __TAURI_INTERNALS__ (v2) or __TAURI__ (v1)
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_devtools_window');
    return;
  }

  // Web mode — use window.open
  // If we already have a reference and the window is still open, focus it
  if (devtoolsWindowRef && !devtoolsWindowRef.closed) {
    devtoolsWindowRef.focus();
    return;
  }

  devtoolsWindowRef = window.open(
    '/devtools.html',
    'os-devtools',
    'width=560,height=700,resizable=yes',
  );
}
