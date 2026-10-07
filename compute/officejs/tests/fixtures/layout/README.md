These synthetic workbooks and unchanged scripts test imported worksheet layout.
Expected observations were captured in desktop Excel 16.0 build 20430.

The twelve cases distinguish Normal style font, base column width, explicit
column width, automatic row height, explicit customHeight, and chart setters.
Each case is replayed before and after save/reimport. Values are points in the
Office.js output. This is a bounded set of measured font profiles (Calibri 11,
Calibri 20, Arial 11), not a general font measurement implementation.

unknown-font.xlsx and normal-font-second.xlsx are additional synthetic controls.
They check unsupported geometry without blocking data operations and selection
of the actual Normal style font instead of font record zero.
