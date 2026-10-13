use compute_api::Workbook;
use mog::run_office_js_with_workbook;
#[test]
fn exponent_precedence_and_controls() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
    return await Excel.run(async c => {
      const s=c.workbook.worksheets.getItem("Sheet1");
      s.getRange("A1:A10").formulas=[
        ["=-2^2"],["=2^3^2"],["=-(2^2)"],["=2^(3^2)"],
        ["=2^-2"],["=2^3%"],["=-2%^2"],["=+2^2"],["=--2^2"],["=2*3^2"]
      ];
      const r=s.getRange("A1:A10");r.load("values");await c.sync();return r.values;
    });
    "#,
    )
    .unwrap();
    let values = output.value.as_array().unwrap();
    for (i, expected) in [
        (0, 4.0),
        (1, 64.0),
        (2, -4.0),
        (3, 512.0),
        (4, 0.25),
        (6, 0.0004),
        (7, 4.0),
        (8, 4.0),
        (9, 18.0),
    ] {
        assert!(
            (values[i][0].as_f64().unwrap() - expected).abs() < 1e-12,
            "row {i}: {}",
            values[i]
        );
    }
    assert!((values[5][0].as_f64().unwrap() - 2f64.powf(0.03)).abs() < 1e-12);
}

#[test]
fn negative_integer_power_preserves_quotient_boundary() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async c => {
            const s = c.workbook.worksheets.getItem("Sheet1");
            s.getRange("A1:C2").formulas = [
                ["=10^(-307)", "=-10^(-307)", "=QUOTIENT(B1,A1)"],
                ["=POWER(10,-307)", "=POWER(-10,-307)", "=QUOTIENT(B2,A2)"]
            ];
            const r = s.getRange("A1:C2");
            r.load("values"); await c.sync(); return r.values;
        });
    "#,
    )
    .unwrap();
    for row in output.value.as_array().unwrap() {
        assert_eq!(row[1].as_f64().unwrap(), -9.999999999999995e-308);
        assert_eq!(row[2].as_f64().unwrap(), 0.0);
    }
}

#[test]
fn positive_power_and_sinh_match_native_numeric_controls() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async c => {
            const s=c.workbook.worksheets.getItem("Sheet1");
            s.getRange("A1:A6").formulas=[
                ["=POWER(42.5,42.5)"], ["=42.5^(-42.5)"],
                ["=10^(-307)"], ["=(-10^(-307))/(10^(-307))"],
                ["=SINH(PI())"], ["=1/SINH(PI())"]
            ];
            const r=s.getRange("A1:A6");r.load("values");await c.sync();return r.values;
        });
    "#,
    )
    .unwrap();
    assert_eq!(output.value.as_array().unwrap().len(), 6);
    // Inspect the engine's stored doubles directly: the JSON return-value
    // parser can round the very small C10-style number during deserialization.
    for (index, expected) in [
        1.6089017613873198e69,
        6.215419884541132e-70,
        1.0000000000000001e-307,
        -0.9999999999999994,
        11.548739357257748,
        0.08658953753004694,
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            workbook
                .sheet_by_index(0)
                .unwrap()
                .get_cell_value(format!("A{}", index + 1).as_str())
                .unwrap(),
            value_types::CellValue::number(expected)
        );
    }
}
