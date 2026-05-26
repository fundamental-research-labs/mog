// SheetView internals must not be reachable through implementation subpaths.
// Consumers who need the class use the root public export; deep construction
// paths must still be blocked by the package export map.

import { SheetView } from '@mog-sdk/sheet-view/sheet-view';

void SheetView;
