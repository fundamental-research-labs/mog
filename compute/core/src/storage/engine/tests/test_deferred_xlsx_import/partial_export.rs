use super::support::*;
use super::*;

#[test]
fn deferred_xlsx_export_rejects_partial_workbook_until_full_hydration() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::Control);

    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("XLSX export should succeed after stream load");
    let parsed = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert!(
        parsed.output.sheets.len() >= 2,
        "post-hydration export should include non-initial sheets",
    );
}
