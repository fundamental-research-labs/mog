//! Office.js write/load comparison through the same entry point as the CLI.
use std::time::Instant;

fn main() {
    let start = Instant::now();
    let output = mog::run_office_js(
        r#"
        return await Excel.run(async (context) => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            const range = sheet.getRange("A1:J100");
            range.values = Array.from({ length: 100 }, (_, row) =>
                Array.from({ length: 10 }, (_, col) => row * 10 + col + 1));
            range.load("values");
            await context.sync();
            for (let row = 0; row < 100; row++) {
                for (let col = 0; col < 10; col++) {
                    if (range.values[row][col] !== row * 10 + col + 1) {
                        throw new Error(`Incorrect value at ${row},${col}`);
                    }
                }
            }
            return range.values.reduce((sum, row) =>
                sum + row.reduce((subtotal, value) => subtotal + value, 0), 0);
        });
    "#,
    )
    .expect("Office.js write/load");
    assert_eq!(output.value.as_f64(), Some(500_500.0));
    println!(
        "phase\tofficejs_write_load\t{:.9}",
        start.elapsed().as_secs_f64()
    );
}
