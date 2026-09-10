use compute_core::storage::engine::ComputeEngine;
use xlsx_parser::parse_xlsx_to_output;

#[test]
fn copying_imported_sheet_allocates_unique_id_and_preserves_custom_views() {
    let input =
        include_bytes!("../../../file-io/xlsx/parser/tests/data/custom-view-printer-settings.xlsx");
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(input).unwrap();
    let source = *engine
        .cell_store()
        .sheet_ids()
        .find(|id| engine.cell_store().get_sheet(id).unwrap().name == "Summary")
        .unwrap();
    engine.copy_sheet(&source, "Copy").unwrap();
    let exported = engine.export_to_xlsx_bytes().unwrap();
    let output = parse_xlsx_to_output(&exported).unwrap().0;
    assert_eq!(output.sheets.len(), 3);
    let ids: std::collections::HashSet<_> =
        output.sheets.iter().map(|s| s.sheet_id.unwrap()).collect();
    assert_eq!(ids.len(), 3);
    assert!(!ids.contains(&0));
    let original = output.sheets.iter().find(|s| s.name == "Summary").unwrap();
    let copy = output.sheets.iter().find(|s| s.name == "Copy").unwrap();
    assert_eq!(
        copy.worksheet_semantic_containers,
        original.worksheet_semantic_containers
    );
    assert_eq!(copy.print_settings, original.print_settings);
    assert_ne!(copy.sheet_id, original.sheet_id);
}
