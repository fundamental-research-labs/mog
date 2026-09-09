use cell_types::SheetId;
use compute_document::hex::hex_to_id;
use domain_types::NamedRange;

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::named_ranges as workbook_named_ranges;

use super::print_defined_names::{collides_with_print_defined_name, export_print_defined_names};

/// Export authored native defined names, including hidden package names.
///
/// Hidden names are included here because they are workbook state, not UI query
/// output. Unsupported or opaque references must be present in
/// `DefinedName.raw_refers_to`.
pub(super) fn export_workbook_named_ranges(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_ids: &[SheetId],
) -> Vec<NamedRange> {
    let print_defined_names = export_print_defined_names(stores, sheet_ids);
    let mut named_ranges: Vec<_> =
        workbook_named_ranges::get_all_named_ranges(&stores.storage.metadata)
            .into_iter()
            .filter_map(|dn| {
                let local_sheet_id = dn.scope.as_ref().and_then(|scope_hex| {
                    let raw = hex_to_id(scope_hex)?;
                    let scope_sid = SheetId::from_raw(raw);
                    sheet_ids
                        .iter()
                        .position(|sid| *sid == scope_sid)
                        .map(|i| i as u32)
                });

                let refers_to = if let Some(raw_refers_to) = dn.raw_refers_to.clone() {
                    raw_refers_to
                } else {
                    let identity = &dn.refers_to;

                    if identity.refs.is_empty() {
                        identity.template.clone()
                    } else {
                        let a1 = stores.compute.to_a1_display_qualified(
                            cell_store,
                            &SheetId::from_raw(0),
                            &identity,
                        );
                        let a1 = a1.strip_prefix('=').unwrap_or(&a1);
                        if a1.is_empty() {
                            identity.template.clone()
                        } else {
                            a1.to_string()
                        }
                    }
                };

                Some(NamedRange {
                    name: dn.name,
                    refers_to,
                    local_sheet_id,
                    hidden: !dn.visible,
                    comment: dn.comment,
                    custom_menu: dn.custom_menu,
                    description: dn.description,
                    help: dn.help,
                    status_bar: dn.status_bar,
                    xlm: dn.xlm,
                    function_group_id: None,
                    shortcut_key: None,
                    function: dn.function,
                    vb_procedure: dn.vb_procedure,
                    publish_to_server: dn.publish_to_server,
                    workbook_parameter: dn.workbook_parameter,
                    xml_space_preserve: dn.xml_space_preserve,
                })
            })
            .filter(|nr| !collides_with_print_defined_name(&print_defined_names, nr))
            .collect();

    named_ranges.extend(print_defined_names);
    named_ranges
}
