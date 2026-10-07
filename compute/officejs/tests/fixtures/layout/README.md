These synthetic workbooks and unchanged scripts test imported worksheet layout.
Expected observations were captured in desktop Excel 16.0 build 20430.

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
