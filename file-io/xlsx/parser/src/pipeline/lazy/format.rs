use crate::domain::hyperlinks;
use crate::domain::print;
use crate::domain::protection::read as protection;
use crate::domain::protection::read::SheetProtectionParse;
use crate::output::results::{HyperlinkOutput, ProtectionOutput};

pub(super) fn format_hyperlinks(xml: &[u8]) -> Vec<HyperlinkOutput> {
    hyperlinks::Hyperlinks::parse(xml)
        .map(|hl| {
            hl.hyperlinks
                .iter()
                .map(|h| HyperlinkOutput {
                    cell_ref: h.cell_ref.clone(),
                    location: h.location.as_deref().unwrap_or("").to_string(),
                    display: h.display.as_deref().unwrap_or("").to_string(),
                    tooltip: h.tooltip.as_deref().unwrap_or("").to_string(),
                    target: h.target.clone(),
                    r_id: h.r_id.clone(),
                    uid: h.uid.clone(),
                    target_kind: h.target_kind,
                    target_mode: h.target_mode.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn format_protection(xml: &[u8]) -> Option<ProtectionOutput> {
    protection::SheetProtection::parse(xml).map(|sp| ProtectionOutput {
        password: sp.password,
        algorithm_name: {
            let alg = sp.algorithm_name.as_str();
            (!alg.is_empty()).then(|| alg.to_string())
        },
        hash_value: sp.hash_value,
        salt_value: sp.salt_value,
        spin_count: sp.spin_count,
        sheet: sp.sheet,
        objects: sp.objects,
        scenarios: sp.scenarios,
        format_cells: sp.format_cells,
        format_columns: sp.format_columns,
        format_rows: sp.format_rows,
        insert_columns: sp.insert_columns,
        insert_rows: sp.insert_rows,
        insert_hyperlinks: sp.insert_hyperlinks,
        delete_columns: sp.delete_columns,
        delete_rows: sp.delete_rows,
        sort: sp.sort,
        auto_filter: sp.auto_filter,
        pivot_tables: sp.pivot_tables,
        select_locked_cells: sp.select_locked_cells,
        select_unlocked_cells: sp.select_unlocked_cells,
    })
}

pub(super) fn format_print_settings(
    xml: &[u8],
) -> (
    Option<crate::output::results::PrintSettingsOutput>,
    Option<crate::output::results::PageBreaksOutput>,
) {
    let ps = print::PrintSettings::parse(xml);
    crate::output::results::build_print_settings_output(&ps)
}
