use super::assembly::WorksheetPrinterSettingsGraphEntry;

const PRINTER_SETTINGS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";

pub(super) fn relationship_for_export(
    sheet_idx: usize,
    sheet_num: usize,
    print_settings: &domain_types::PrintSettings,
    package_fidelity: Option<&domain_types::PackageFidelityMetadata>,
) -> Option<WorksheetPrinterSettingsGraphEntry> {
    let imported_identity = current_imported_printer_settings_identity(print_settings)?;
    let path = normalize_printer_settings_path(&imported_identity.path)?;
    if !is_supported_printer_settings_path(&path) {
        return None;
    }

    let imported_part = package_fidelity?.opaque_parts.iter().find(|part| {
        normalize_printer_settings_path(&part.path).as_deref() == Some(path.as_str())
    })?;

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
        bytes: imported_part.bytes.clone(),
        content_type: PRINTER_SETTINGS_CONTENT_TYPE.to_string(),
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

fn normalize_printer_settings_path(path: &str) -> Option<String> {
    let path = path.trim_start_matches('/');
    if path.contains('\\') {
        return None;
    }
    let resolved = crate::infra::opc::resolve_relationship_target(None, path).ok()?;
    (resolved == path).then_some(resolved)
}

fn is_supported_printer_settings_path(path: &str) -> bool {
    let Some(name) = path.strip_prefix("xl/printerSettings/printerSettings") else {
        return false;
    };
    let Some(number) = name.strip_suffix(".bin") else {
        return false;
    };
    !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
}
