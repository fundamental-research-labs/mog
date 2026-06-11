/**
 * Dev App Entry Point
 *
 * This is the main entry point for the development application.
 * It renders the App component which demonstrates the public DocumentFactory API.
 */

// DevTools must be the first import so __OS_DEVTOOLS__ is available when actors are created
import '@mog/devtools';
// Register the spreadsheet app in the shell's app registry
import '@mog/app-spreadsheet/register';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// Global styles from the spreadsheet app (includes shell base styles)
import '@mog/app-spreadsheet/globals.css';

const APP_EVAL_MAC_PLATFORM_PARAM = 'app-eval-platform-mac';
const APP_EVAL_MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type NavigatorUADataLike = {
  platform: string;
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
};

function installAppEvalPlatformOverride(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }

  if (!new URLSearchParams(window.location.search).has(APP_EVAL_MAC_PLATFORM_PARAM)) {
    return;
  }

  const defineNavigatorGetter = <T,>(key: string, value: T) => {
    try {
      Object.defineProperty(Navigator.prototype, key, {
        configurable: true,
        get: () => value,
      });
    } catch {
      // Best-effort app-eval shim; shell platform detection still has fallbacks.
    }
  };

  // Chromium's userAgentData does not follow Playwright init-script platform
  // shims. Keep all platform surfaces coherent before shell bootstrap reads them.
  defineNavigatorGetter('platform', 'MacIntel');
  defineNavigatorGetter('userAgent', APP_EVAL_MAC_USER_AGENT);
  defineNavigatorGetter('vendor', 'Apple Computer, Inc.');
  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: NavigatorUADataLike;
    }
  ).userAgentData;
  defineNavigatorGetter('userAgentData', {
    platform: 'macOS',
    brands: userAgentData?.brands ?? [],
    mobile: userAgentData?.mobile ?? false,
  });
}

installAppEvalPlatformOverride();

// Add spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

// Initialize and render
function main(): void {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Root element not found. Make sure index.html has a <div id="root"></div>');
  }

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main();
