# Workbook functions

`context.workbook.functions` exposes these 50 Office.js methods:

| Family | Methods |
| --- | --- |
| Trigonometry | `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`, `cos`, `cosh`, `sin`, `sinh`, `tan`, `tanh`, `degrees`, `radians` |
| Arithmetic | `abs`, `exp`, `ln`, `log`, `log10`, `pi`, `power`, `sqrt`, `sqrtPi`, `sign`, `int`, `trunc`, `round`, `roundUp`, `roundDown`, `mod`, `quotient` |
| Aggregation | `product`, `sum`, `sumSq`, `average`, `min`, `max`, `median`, `count`, `countA` |
| Text | `len`, `left`, `right`, `mid`, `lower`, `upper`, `trim`, `concatenate`, `exact` |

```js
await Excel.run(async context => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1:A3").values = [[1], [2], [3]];
  const f = context.workbook.functions;
  const result = f.sum(sheet.getRange("A1:A3"), f.abs(-4));
  result.load("value,error");
  await context.sync();
  console.log(result.error || result.value); // 10
});
```

Calls evaluate in queue order through the existing formula engine, without
creating temporary cells or sheets. Arguments include scalar values, arrays,
`Range` proxies, `{ address: "Sheet1!A1:A3" }` / defined-name references, and
other `FunctionResult` objects. Strings remain literal text. Range proxies
must belong to the same request context. Optional arguments use formula
defaults. Results are snapshots of the calculation at the queued call.

Load `value` and/or `error`, then sync before reading. Worksheet errors such
as `#NUM!` populate `error` and leave `value` null; they do not reject sync.
Malformed API arguments may reject the call or sync. These methods return
scalar results; this does not expose the remaining `Excel.Functions` methods.
The contracts are documented by Microsoft for
[Functions](https://learn.microsoft.com/javascript/api/excel/excel.functions)
and [FunctionResult](https://learn.microsoft.com/javascript/api/excel/excel.functionresult).

## Verification and Excel goldens

The calipers submodule contains 50 new `officejs/api_function_*` cases,
generated from `scripts/gen-officejs-cases/specs_functions.go`. Each records
a primary and boundary result in `D1:F3`; worksheet errors are recorded as
text. Cases include range inputs, nested calls, optional arguments, text,
rounding, and invalid numeric domains.

`cargo test -p mog --test functions --locked` executes every committed script
and checks its values and errors against independent expected results, plus
shared proxy and argument behavior. These checks do not establish Excel parity.

The first implementation round deliberately leaves the 50 Excel goldens and
Excel-measured budgets ungenerated. On Windows, from `vendor/calipers`:

```bat
calipers excel-run-pass verification\cases\officejs
```

The new cases use blank `init.xlsx` fixtures. Generate `golden.xlsx` with Excel,
then use the usual calipers verification workflow to assess parity. Do not
use Mog output as an Excel golden.
