use super::support::*;
use super::*;

#[test]
fn stream_xlsx_export_includes_every_sheet_immediately() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::Control);

    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    assert!(
        engine
            .export_to_parse_output()
            .unwrap()
            .parse_output
            .sheets
            .len()
            >= 2
    );
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("XLSX export should succeed after stream load");
    let parsed = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert!(
        parsed.output.sheets.len() >= 2,
        "post-hydration export should include non-initial sheets",
    );
}
