// The legacy @mog/sheet-view package name must NOT be resolvable outside
// the monorepo. Only @mog-sdk/sheet-view is the published package name.

// This import must fail to resolve — @mog/sheet-view is not published.
import { SheetView } from '@mog/sheet-view';
