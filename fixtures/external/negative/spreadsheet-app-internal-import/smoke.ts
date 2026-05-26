// The public spreadsheet-app package exposes only "." and "./styles.css".
// Implementation subpaths must not be reachable from packed consumers.

import { createSpreadsheetRuntime as fromInternal } from '@mog-sdk/spreadsheet-app/internal';
import { createSpreadsheetRuntime as fromSrcIndex } from '@mog-sdk/spreadsheet-app/src/index';
import { SpreadsheetRuntime as fromSrcTypes } from '@mog-sdk/spreadsheet-app/src/public-types';
import { MogSpreadsheetApp as fromRepoPath } from 'runtime/spreadsheet-app/src/index';

void fromInternal;
void fromSrcIndex;
void fromSrcTypes;
void fromRepoPath;
