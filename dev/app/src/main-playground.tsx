/**
 * Playground Entry Point
 *
 * Used for the Cloudflare Pages deployment.
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
