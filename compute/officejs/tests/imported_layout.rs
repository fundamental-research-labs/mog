use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use std::path::Path;

// Observations from identical synthetic inputs/actions in desktop Excel.
// These are bounded profiles, not a font rasterizer or a universal platform default.
#[test]
fn imported_layout_matches_twelve_frozen_native_observations() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/layout");
    for case in [
        "calibri11-base8",
        "calibri11-base10",
        "calibri11-default10",
        "calibri11-column10",
        "calibri20-base8",
        "arial11-base8",
        "mixed-default",
        "mixed-explicit",
        "calibri20-column10",
        "arial11-column10",
        "calibri20-customheight15",
        "arial11-customheight24",
    ] {
        let dir = root.join(case);
        let (w, _) =
            Workbook::from_xlsx_bytes(&std::fs::read(dir.join("input.xlsx")).unwrap()).unwrap();
        let script = std::fs::read_to_string(dir.join("script.js")).unwrap();
        let expected = std::fs::read_to_string(dir.join("expected.txt")).unwrap();
        let result = run_office_js_with_workbook(&w, &script).unwrap();
        assert_eq!(result.stdout.trim_end(), expected.trim_end(), "{case}");
        let (roundtrip, _) = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap()).unwrap();
        let result = run_office_js_with_workbook(&roundtrip, &script).unwrap();
        assert_eq!(
            result.stdout.trim_end(),
            expected.trim_end(),
            "{case} after save/reimport"
        );
    }
}

#[test]
fn unsupported_font_preserves_data_operations_and_explicit_chart_points() {
    let (w, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/layout/unknown-font.xlsx")).unwrap();
    let result = run_office_js_with_workbook(
        &w,
        r#"return await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem('Sheet1');
        s.getRange('A1:B2').values=[['Category','Sales'],['A',15]];
        const chart=s.charts.add('ColumnClustered',s.getRange('A1:B2'),'Columns');
        chart.left=100;chart.top=20;chart.width=300;chart.height=200;
        chart.load(['left','top','width','height']); await c.sync();
        return [chart.left,chart.top,chart.width,chart.height];
    });"#,
    )
    .unwrap();
    for (actual, expected) in result
        .value
        .as_array()
        .unwrap()
        .iter()
        .zip([100.0, 20.0, 300.0, 200.0])
    {
        assert!((actual.as_f64().unwrap() - expected).abs() < 1e-9);
    }
    let (w, _) = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap()).unwrap();
    let sheet = w.sheet_by_name("Sheet1").unwrap();
    assert!(
        sheet
            .layout()
            .get_col_position(3)
            .unwrap_err()
            .to_string()
            .contains("unsupported")
    );
    assert!(
        sheet
            .layout()
            .get_row_position(1)
            .unwrap_err()
            .to_string()
            .contains("unsupported")
    );
    let result = run_office_js_with_workbook(&w, "return await Excel.run(async c=>{const r=c.workbook.worksheets.getItem('Sheet1').getRange('B2');r.load('values');await c.sync();return r.values;});").unwrap();
    assert_eq!(result.value, serde_json::json!([[15]]));
}

#[test]
fn imported_profile_uses_normal_style_font_not_first_font_record() {
    let (w, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/layout/normal-font-second.xlsx"))
            .unwrap();
    let out =
        run_office_js_with_workbook(&w, include_str!("fixtures/layout/arial11-base8/script.js"))
            .unwrap();
    assert_eq!(
        out.stdout.trim_end(),
        include_str!("fixtures/layout/arial11-base8/expected.txt").trim_end()
    );
}

#[test]
fn unknown_font_two_cell_chart_cannot_bake_unverified_untouched_dimension() {
    for property in ["width", "height", "left", "top"] {
        let (w, _) = Workbook::from_xlsx_bytes(include_bytes!(
            "fixtures/layout/unknown-font-two-cell-chart.xlsx"
        ))
        .unwrap();
        let sheet = w.sheet_by_name("Sheet1").unwrap();
        let before = serde_json::to_value(sheet.charts().get_all().unwrap()).unwrap();
        let script = format!(
            "await Excel.run(async c=>{{const ch=c.workbook.worksheets.getItem('Sheet1').charts.getItem('Guarded');ch.{property}=120;await c.sync();}});"
        );
        let error = run_office_js_with_workbook(&w, &script).unwrap_err();
        assert!(
            error.to_string().contains("unsupported"),
            "{property}: {error}"
        );
        assert_eq!(
            serde_json::to_value(sheet.charts().get_all().unwrap()).unwrap(),
            before,
            "{property} must not mutate geometry"
        );
    }
}
