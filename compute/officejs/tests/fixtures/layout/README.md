These synthetic workbooks and unchanged scripts test imported worksheet layout.
Expected observations were captured in desktop Excel 16.0 build 20430.

The following inputs and their original `script.js` files come from the public
[Calipers corpus at `5f8e8360580ede100eaaa6bac73ee474fe753b3d`](https://github.com/fundamental-research-labs/calipers/tree/5f8e8360580ede100eaaa6bac73ee474fe753b3d/verification/cases):

| Local case | Public Calipers case |
| --- | --- |
| `officejs-align_center` | `officejs/align_center` |
| `officejs-align_wrap` | `officejs/align_wrap` |
| `officejs-col_row_size` | `officejs/col_row_size` |
| `scratch-column_row_sizes` | `scratch/column_row_sizes` |

Each local `input.xlsx` is derived from that case's `init.xlsx` by removing only
the `dc:creator` and `cp:lastModifiedBy` elements from `docProps/core.xml`.
Every other ZIP member retains its exact uncompressed bytes, and the remaining
content in `core.xml` is unchanged. The scripts and expected observations are
unchanged. These sanitized archives are not byte-identical to the historical
inputs used for the measurements; their worksheet, style and layout parts are
unchanged. This cleanup does not alter earlier repository history.

The eighteen cases distinguish Normal style font, base column width, explicit
column width, automatic row height, explicit customHeight, and chart setters.
Each case is replayed before and after save/reimport. Values are points in the
Office.js output. This is a bounded set of measured font profiles (Calibri 11/12/20, Arial 11), not a general font measurement implementation.

unknown-font.xlsx and normal-font-second.xlsx are additional synthetic controls.
They check unsupported geometry without blocking data operations and selection
of the actual Normal style font instead of font record zero.

The four Calibri12 public scripts remain unchanged. Their separately named
observe.js variants capture native numeric readbacks; a requested 28-point
column width reads 27.75 points after grid quantization. Reimport checks read
the saved geometry without reapplying the setters.
