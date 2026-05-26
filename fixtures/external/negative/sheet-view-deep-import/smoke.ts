// Deep imports into @mog-sdk/sheet-view internal subpaths must fail.
// Only the root '.' export is public. Internal implementation files
// must not be reachable through package subpath imports.

// These imports must all fail to resolve:
import { ViewportWiring } from '@mog-sdk/sheet-view/src/viewport-wiring';
import { SheetView } from '@mog-sdk/sheet-view/src/sheet-view';
import { populateIndicesFromViewport } from '@mog-sdk/sheet-view/src/viewport-wiring';
