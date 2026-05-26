/**
 * Side-effect module that registers the spreadsheet app in the shell's
 * app registry. Import this once at the app entrypoint before rendering.
 *
 * Replaces the old `virtual:app-registry` Vite virtual module.
 */
import { registerApps } from '@mog/shell/host/app-registry';

import manifest from './manifest';

registerApps({ [manifest.id]: manifest }, { [manifest.id]: () => import('./index') });
