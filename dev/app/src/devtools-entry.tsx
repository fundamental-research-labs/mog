import { createRoot } from 'react-dom/client';
import { DevToolsApp } from '@mog/devtools/ui/devtools-app';

const container = document.getElementById('devtools-root');
if (!container) throw new Error('devtools-root not found');

const root = createRoot(container);
root.render(<DevToolsApp />);
