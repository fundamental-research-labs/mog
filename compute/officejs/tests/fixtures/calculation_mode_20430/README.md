# Calculation mode observations: Excel 16.0.20430.20146

These synthetic workbooks contain A1=3 and A2=A1*2 cached6, with calculation-on-save disabled. The script/input bytes were used in native Windows Excel tests. They cover Manual→Automatic and Automatic→Manual with same-sync, later-sync and fresh-context property loads, then a precedent edit. They contain no private workbook data.

Observed getter remains the opened mode; requested mode controls runtime scheduling. Manual→Automatic saves manual with7/14. Automatic→Manual saves auto with7/6; a new automatic open produces7/14. These are measured host behaviors, not a universal claim for all Office versions.

The regression prepends a test-only Office metadata adapter reporting MOG and unsupported requirement metadata. It leaves the frozen action scripts unchanged and supplies no calculation behavior. The environment log is asserted separately from all action records. This is same-workbook/action comparison with a metadata adapter, not standalone unchanged-script compatibility with the Office host diagnostics namespace.
