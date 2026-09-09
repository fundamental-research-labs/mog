use super::*;
use cell_types::CellId;

/// Copy authored table metadata and retarget references only on the copied sheet.
pub(in crate::storage::engine) fn copy_sheet_tables(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    source: &SheetId,
    target: &SheetId,
    formula_cells: &mut [(CellId, String)],
) -> Result<(), ComputeError> {
    let source_uuid = source.to_uuid_string();
    let source_tables: Vec<_> = cell_store
        .all_tables()
        .iter()
        .filter(|table| table.sheet_id == source_uuid)
        .cloned()
        .collect();
    let mut renames = Vec::new();
    let mut table_ids = std::collections::HashMap::new();
    let mut column_ids = std::collections::HashMap::new();
    for mut table in source_tables {
        let old_name = table.name.clone();
        let old_id = table.id.clone();
        let mut suffix = 2u32;
        let name = loop {
            let ending = format!("_{suffix}");
            let base: String = old_name
                .chars()
                .take(255usize.saturating_sub(ending.len()))
                .collect();
            let candidate = format!("{base}{ending}");
            if cell_store.get_table(&candidate).is_none() {
                break candidate;
            }
            suffix += 1;
        };
        table.name = name.clone();
        table.display_name = name.clone();
        table.sheet_id = target.to_uuid_string();
        table.id = next_table_id(stores);
        table.ooxml_table_id = None;
        table.worksheet_relationship_id_hint = None;
        table.table_part_path_hint = None;
        table.worksheet_relationship_target_hint = None;
        for column in &mut table.columns {
            let old_id = std::mem::replace(&mut column.id, next_table_column_id(stores));
            column_ids.insert(old_id, column.id.clone());
        }
        table_ids.insert(old_id, table.id.clone());
        renames.push((old_name, name));
        stores.compute.set_table(cell_store, table);
    }
    if let Some(metadata) = stores.storage.sheet_metadata.get_mut(target) {
        for object in metadata.floating_objects.objects.values_mut() {
            if let domain_types::domain::floating_object::FloatingObjectData::Chart(chart) =
                &mut object.data
            {
                if let Some(new) = chart
                    .source_table_id
                    .as_ref()
                    .and_then(|id| table_ids.get(id))
                {
                    chart.source_table_id = Some(new.clone());
                }
            }
        }
    }
    for slicer in stores
        .storage
        .metadata
        .slicers
        .values()
        .filter(|slicer| SheetId::from_uuid_str(&slicer.sheet_id).ok().as_ref() == Some(target))
    {
        crate::storage::engine::history::metadata::capture_workbook_entry!(
            stores.storage,
            slicers,
            slicer.id
        );
    }
    for slicer in stores
        .storage
        .metadata
        .slicers
        .values_mut()
        .filter(|slicer| SheetId::from_uuid_str(&slicer.sheet_id).ok().as_ref() == Some(target))
    {
        if let domain_types::domain::slicer::SlicerSource::Table {
            table_id,
            column_cell_id,
        } = &mut slicer.source
        {
            if let Some(new_id) = table_ids.get(table_id) {
                *table_id = new_id.clone();
            }
            if let Some(new_id) = column_ids.get(column_cell_id) {
                *column_cell_id = new_id.clone();
            }
        }
    }
    if renames.is_empty() {
        return Ok(());
    }
    let rewrite = |source: &str| {
        renames.iter().fold(source.to_string(), |text, (old, new)| {
            TableReferenceEdit::RenameTable { old, new }.rewrite(&text, None)
        })
    };
    for (_, formula) in formula_cells {
        *formula = rewrite(formula);
    }
    let copied_tables: Vec<_> = cell_store
        .all_tables()
        .iter()
        .filter(|table| table.sheet_id == target.to_uuid_string())
        .cloned()
        .collect();
    for mut table in copied_tables {
        for column in &mut table.columns {
            for formula in [
                &mut column.calculated_formula,
                &mut column.totals_row_formula,
            ]
            .into_iter()
            .flatten()
            {
                *formula = rewrite(formula);
            }
        }
        stores.compute.set_table(cell_store, table);
    }
    for (old, new) in &table_ids {
        if let Some(table) = cell_store.get_table_by_id(new) {
            super::super::objects::copy_table_annotation(stores, old, table)?;
        }
    }
    let copied_filters = filters::get_filters_in_sheet(&stores.storage, target);
    for mut filter in copied_filters {
        if let Some(new_id) = filter.table_id.as_ref().and_then(|id| table_ids.get(id)) {
            filter.table_id = Some(new_id.clone());
            filters::upsert_filter_state(&mut stores.storage, target, &filter)?;
            if let Some(mut binding) =
                filters::get_filter_metadata_binding(&stores.storage, target, &filter.id)
            {
                let table = cell_store
                    .get_table_by_id(new_id)
                    .expect("copied table catalog entry");
                binding.table_id = Some(table.id.clone());
                binding.owner_path = filters::FilterMetadataOwnerPath::TableAutoFilter {
                    sheet_id: target.to_uuid_string(),
                    table_id: table.id.clone(),
                };
                binding.source_key = filters::FilterMetadataSourceKey::TableAutoFilter {
                    sheet_id: target.to_uuid_string(),
                    table_id: table.id.clone(),
                    table_name: table.name.clone(),
                    range_ref: binding.range_ref.clone(),
                };
                binding.table_column_id_to_header_cell_id = binding
                    .table_column_id_to_header_cell_id
                    .into_iter()
                    .map(|(id, header)| (column_ids.get(&id).cloned().unwrap_or(id), header))
                    .collect();
                binding.source_fingerprint =
                    crate::storage::engine::construction::table_filter_binding_fingerprint(
                        &binding.sheet_id,
                        table,
                        &binding.range_ref,
                        &binding.shell,
                    );
                filters::upsert_filter_metadata_binding(&mut stores.storage, target, &binding);
            }
        }
    }
    Ok(())
}
