use super::support::*;
use super::*;

#[test]
fn deferred_xlsx_export_rejects_partial_workbook_until_full_hydration() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::Control);

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let parse_err = engine
        .export_to_parse_output()
        .expect_err("parse output export must not read a partial deferred workbook");
    assert!(
        parse_err.to_string().contains("deferred XLSX hydration"),
        "partial export should fail with a materialization error, got {parse_err}",
    );
    let bytes_err = engine
        .export_to_xlsx_bytes()
        .expect_err("XLSX export must not serialize a partial deferred workbook");
    assert!(
        bytes_err.to_string().contains("deferred XLSX hydration"),
        "partial XLSX export should fail with a materialization error, got {bytes_err}",
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("XLSX export should succeed after full hydration");
    let parsed = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert!(
        parsed.output.sheets.len() >= 2,
        "post-hydration export should include non-initial sheets",
    );
}
