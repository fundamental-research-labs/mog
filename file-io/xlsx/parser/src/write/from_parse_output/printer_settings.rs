use super::assembly::WorksheetPrinterSettingsGraphEntry;
use super::{has_clean_opaque_part, package_authority};
use crate::write::REL_PRINTER_SETTINGS;
use crate::write::relationships::RelationshipManager;

pub(super) fn add_relationship_for_export(
    sheet_idx: usize,
    sheet_num: usize,
    print_settings: &domain_types::PrintSettings,
    original_sheet_rels: &[domain_types::OpcRelationship],
    round_trip_ctx: Option<&domain_types::RoundTripContext>,
    rels: &mut RelationshipManager,
) -> Option<WorksheetPrinterSettingsGraphEntry> {
    let default_path = format!("xl/printerSettings/printerSettings{sheet_num}.bin");
    let path = imported_printer_settings_path(
        sheet_num,
        print_settings,
        original_sheet_rels,
        round_trip_ctx,
    )
    .unwrap_or(default_path);

    if !has_clean_opaque_part(round_trip_ctx, &path) {
        return None;
    }

    let target = worksheet_relative_target(&path);
    let r_id = print_settings
        .r_id
        .clone()
        .filter(|r_id| rels.get_by_id(r_id).is_none())
        .or_else(|| {
            package_authority::relationship_id_hint(
                original_sheet_rels,
                REL_PRINTER_SETTINGS,
                &target,
                None,
            )
            .filter(|r_id| rels.get_by_id(r_id).is_none())
        })
        .unwrap_or_else(|| rels.add(REL_PRINTER_SETTINGS, &target));

    if rels.find_by_target(&target).is_none() {
        rels.add_with_id(&r_id, REL_PRINTER_SETTINGS, &target);
    }

    Some(WorksheetPrinterSettingsGraphEntry {
        sheet_idx,
        path,
        target,
        relationship_id_hint: r_id,
    })
}

fn imported_printer_settings_path(
    sheet_num: usize,
    print_settings: &domain_types::PrintSettings,
    original_sheet_rels: &[domain_types::OpcRelationship],
    round_trip_ctx: Option<&domain_types::RoundTripContext>,
) -> Option<String> {
    let r_id = print_settings.r_id.as_ref()?;
    let owner_path = format!("xl/worksheets/sheet{sheet_num}.xml");
    let path = original_sheet_rels
        .iter()
        .find(|rel| {
            &rel.id == r_id
                && rel.rel_type == REL_PRINTER_SETTINGS
                && rel.target_mode.as_deref() != Some("External")
        })
        .and_then(|rel| {
            crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target).ok()
        })?;

    has_clean_opaque_part(round_trip_ctx, &path).then_some(path)
}

fn worksheet_relative_target(zip_path: &str) -> String {
    let path = zip_path.trim_start_matches('/');
    path.strip_prefix("xl/")
        .map(|rest| format!("../{rest}"))
        .unwrap_or_else(|| path.to_string())
}
