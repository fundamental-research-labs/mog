// Deep imports into public packages bypass the export map and must fail.
// These subpaths are NOT in the packages' "exports" field.

// Deep imports into @mog-sdk/embed internal paths must fail
import { EmbedRenderOrchestrator } from '@mog-sdk/embed/renderer';
import { FormulaBar } from '@mog-sdk/embed/renderer/formula-bar';

// Deep imports into @mog-sdk/sdk internal paths must fail
import { boot } from '@mog-sdk/sdk/boot';
