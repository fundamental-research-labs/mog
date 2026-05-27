use super::assembly::WorksheetPrinterSettingsGraphEntry;

pub(super) fn relationship_for_export(
    sheet_idx: usize,
    sheet_num: usize,
    print_settings: &domain_types::PrintSettings,
    _original_sheet_rels: &[domain_types::OpcRelationship],
) -> Option<WorksheetPrinterSettingsGraphEntry> {
    let imported_identity = current_imported_printer_settings_identity(print_settings)?;
    let path = imported_identity.path.clone();

    let target = worksheet_relative_target(&path);
    let r_id = imported_identity
        .relationship_id
        .clone()
        .unwrap_or_else(|| format!("rIdPrinterSettings{sheet_num}"));

    Some(WorksheetPrinterSettingsGraphEntry {
        sheet_idx,
        path,
        target,
        relationship_id_hint: r_id,
    })
}

fn current_imported_printer_settings_identity(
    print_settings: &domain_types::PrintSettings,
) -> Option<&domain_types::ImportedPrinterSettingsIdentity> {
    let identity = print_settings.imported_printer_settings.as_ref()?;
    let current =
        domain_types::PrinterSettingsPageSetupFingerprint::from_print_settings(print_settings);
    (identity.page_setup == current).then_some(identity)
}

fn worksheet_relative_target(zip_path: &str) -> String {
    let path = zip_path.trim_start_matches('/');
    path.strip_prefix("xl/")
        .map(|rest| format!("../{rest}"))
        .unwrap_or_else(|| path.to_string())
}
