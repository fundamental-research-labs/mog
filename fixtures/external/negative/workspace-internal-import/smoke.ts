// @mog/* workspace-internal packages must not be importable outside the monorepo.

// @mog/kernel (workspace-internal implementation, not the @mog-sdk/kernel facade)
import { createDocumentContext } from '@mog/kernel/context';
import { ComputeBridge } from '@mog/kernel/bridges/compute';

// @mog/sheet-view (workspace-internal implementation)
import { ViewportWiring } from '@mog/sheet-view';

// @mog/shell (workspace-internal)
import { createShell } from '@mog/shell';

// @mog/transport (workspace-internal)
import { Transport } from '@mog/transport';

// @mog/canvas-engine (bundle-only)
import { CanvasEngine } from '@mog/canvas-engine';

// @mog/grid-renderer (bundle-only)
import { GridRenderer } from '@mog/grid-renderer';
