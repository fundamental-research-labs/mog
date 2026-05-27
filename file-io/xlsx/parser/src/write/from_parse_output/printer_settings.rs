use super::assembly::WorksheetPrinterSettingsGraphEntry;
use super::package_authority;
use crate::write::REL_PRINTER_SETTINGS;

pub(super) fn relationship_for_export(
    sheet_idx: usize,
    sheet_num: usize,
    print_settings: &domain_types::PrintSettings,
    original_sheet_rels: &[domain_types::OpcRelationship],
) -> Option<WorksheetPrinterSettingsGraphEntry> {
    let default_path = format!("xl/printerSettings/printerSettings{sheet_num}.bin");
    let imported_identity = current_imported_printer_settings_identity(print_settings);
    let path = imported_identity
        .map(|identity| identity.path.clone())
        .unwrap_or(default_path);

    let target = worksheet_relative_target(&path);
    let r_id = imported_identity
        .and_then(|identity| identity.relationship_id.clone())
        .or_else(|| {
            package_authority::relationship_id_hint(
                original_sheet_rels,
                REL_PRINTER_SETTINGS,
                &target,
                None,
            )
        })
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
