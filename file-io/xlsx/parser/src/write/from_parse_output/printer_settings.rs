use super::assembly::WorksheetPrinterSettingsGraphEntry;

const PRINTER_SETTINGS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";

pub(super) fn append_relationship_for_export(
    sheet_idx: usize,
    sheet_num: usize,
    print_settings: Option<&domain_types::PrintSettings>,
    package_fidelity: Option<&domain_types::PackageFidelityMetadata>,
    sheet_writer: &mut crate::write::SheetWriter,
    relationships: &mut Vec<WorksheetPrinterSettingsGraphEntry>,
) {
    let Some(print_settings) = print_settings else {
        return;
    };
    if print_settings.r_id.is_none() {
        return;
    }
    if let Some(entry) =
        relationship_for_export(sheet_idx, sheet_num, print_settings, package_fidelity)
    {
        relationships.push(entry);
    } else {
        sheet_writer
            .ensure_print_writer()
            .set_printer_settings_r_id(None);
    }
}

fn relationship_for_export(
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
        is_main: true,
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
    crate::infra::opc::resolve_relationship_target(None, path).ok()
}

fn is_supported_printer_settings_path(path: &str) -> bool {
    path.starts_with("xl/printerSettings/")
        && path.ends_with(".bin")
        && path.len() > "xl/printerSettings/.bin".len()
}

/// Register only printer payloads referenced by retained custom views. Their
/// imported targets travel with sheet state rather than the current sheet index.
pub(super) fn append_custom_view_relationships(
    sheet_idx: usize,
    containers: &domain_types::WorksheetSemanticContainers,
    package_fidelity: Option<&domain_types::PackageFidelityMetadata>,
    relationships: &mut Vec<WorksheetPrinterSettingsGraphEntry>,
) -> Result<(), crate::write::WriteError> {
    let Some(views) = &containers.custom_sheet_views else {
        return Ok(());
    };
    let ids: std::collections::BTreeSet<_> =
        crate::infra::xml::relationship_attr_values(&views.raw_xml)
            .into_iter()
            .collect();
    for id in ids {
        let unresolved = || {
            crate::write::WriteError::PackageIntegrity(format!(
                "custom sheet view on sheet {} has unresolved printer relationship {}",
                sheet_idx + 1,
                id
            ))
        };
        let path = containers
            .custom_sheet_view_printer_settings
            .get(&id)
            .and_then(|path| normalize_printer_settings_path(path))
            .filter(|path| is_supported_printer_settings_path(path))
            .ok_or_else(unresolved)?;
        let part = package_fidelity
            .and_then(|metadata| {
                metadata.opaque_parts.iter().find(|part| {
                    normalize_printer_settings_path(&part.path).as_deref() == Some(path.as_str())
                })
            })
            .ok_or_else(unresolved)?;
        relationships.push(WorksheetPrinterSettingsGraphEntry {
            sheet_idx,
            is_main: false,
            target: worksheet_relative_target(&path),
            path,
            relationship_id_hint: id,
            bytes: part.bytes.clone(),
            content_type: PRINTER_SETTINGS_CONTENT_TYPE.to_string(),
        });
    }
    Ok(())
}

pub(super) fn finalize_relationships(
    sheet_idx: usize,
    writer: &mut crate::write::SheetWriter,
    relationships: &[WorksheetPrinterSettingsGraphEntry],
    graph: &crate::write::package_graph::ResolvedPackageGraph,
) -> Result<(), crate::write::WriteError> {
    let owner = crate::write::package_graph::PackageOwner::Worksheet {
        index: sheet_idx,
        path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
    };
    let mut ids = std::collections::HashMap::new();
    for entry in relationships
        .iter()
        .filter(|entry| entry.sheet_idx == sheet_idx)
    {
        let resolved = graph
            .relationship_id(
                &owner,
                crate::infra::opc::REL_PRINTER_SETTINGS,
                &entry.target,
            )
            .ok_or_else(|| {
                crate::write::WriteError::PackageIntegrity(format!(
                    "missing worksheet printer-settings relationship for sheet {} target {}",
                    sheet_idx + 1,
                    entry.target
                ))
            })?;
        if entry.is_main {
            writer
                .ensure_print_writer()
                .set_printer_settings_r_id(Some(resolved.to_string()));
        } else {
            ids.insert(entry.relationship_id_hint.clone(), resolved.to_string());
        }
    }
    if let Some(views) = &mut writer.worksheet_semantic_containers.custom_sheet_views {
        views.raw_xml = crate::infra::xml::remap_relationship_attrs(&views.raw_xml, &ids);
    }
    Ok(())
}
