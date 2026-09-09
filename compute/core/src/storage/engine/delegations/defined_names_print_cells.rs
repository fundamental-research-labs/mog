use crate::snapshot::{
    ChangeKind, MutationResult, NamedRangeChange, PrintSettingsChange, RecalcResult,
};
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::history::metadata::{MetadataImpact, capture_workbook_entry};
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::engine::services;
use crate::storage::sheet::print;
use crate::storage::workbook::named_ranges;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_named_range(
    engine: &mut ComputeEngine,
    input: named_ranges::DefinedNameInput,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::CreateNamedRange { input })? {
        MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn update_named_range(
    engine: &mut ComputeEngine,
    id: &str,
    updates: named_ranges::NamedRangeUpdate,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::UpdateNamedRange {
        id: id.to_string(),
        updates,
    })? {
        MutationOutput::Plain(result) | MutationOutput::Recalc(result) => {
            let patches = engine.flush_viewport_patches();
            Ok((patches, result))
        }
        MutationOutput::SheetId(_, result) => Ok((serialize_multi_viewport_patches(&[]), result)),
    }
}

pub(in crate::storage::engine) fn remove_named_range_by_id(
    engine: &mut ComputeEngine,
    id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let existing = named_ranges::get_named_range_by_id(&engine.stores.storage.metadata, id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Defined name with ID {} not found", id),
        })?;

    let scope = match &existing.scope {
        Some(sheet_uuid) => {
            let sheet_id = SheetId::from_uuid_str(sheet_uuid).map_err(|_| ComputeError::Eval {
                message: format!("Invalid sheet UUID in named range scope: {}", sheet_uuid),
            })?;
            formula_types::Scope::Sheet(sheet_id)
        }
        None => formula_types::Scope::Workbook,
    };

    let key = existing.name.to_ascii_lowercase();
    let seed_id = engine.mirror.variables.get_variable_cell_id(&scope, &key);

    engine
        .stores
        .compute
        .remove_named_range_scoped(&mut engine.mirror, &scope, &existing.name);

    capture_workbook_entry!(
        engine.stores.storage,
        named_ranges,
        named_ranges::get_defined_name_key(&existing.name, existing.scope.as_deref()),
        MetadataImpact::Names
    );
    named_ranges::remove_named_range_by_id(&mut engine.stores.storage.metadata, id)?;

    let mut recalc = match seed_id {
        Some(cell_id) => engine
            .stores
            .compute
            .recalc(&mut engine.mirror, &[cell_id])?,
        None => RecalcResult::empty(),
    };
    engine.prepare_recalc_for_flush(&mut recalc);
    let patches = engine.flush_viewport_patches();

    let mut result = MutationResult::from_recalc(recalc);
    result.named_range_changes.push(NamedRangeChange {
        name: existing.name.clone(),
        kind: ChangeKind::Removed,
    });
    Ok((patches, result))
}

pub(in crate::storage::engine) fn remove_named_ranges_by_scope(
    engine: &mut ComputeEngine,
    scope: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let removed =
        named_ranges::get_named_ranges_by_scope(&engine.stores.storage.metadata, scope.as_deref());

    for name in &removed {
        capture_workbook_entry!(
            engine.stores.storage,
            named_ranges,
            named_ranges::get_defined_name_key(&name.name, name.scope.as_deref()),
            MetadataImpact::Names
        );
    }
    named_ranges::remove_named_ranges_by_scope(
        &mut engine.stores.storage.metadata,
        scope.as_deref(),
    );

    for dn in &removed {
        let dn_scope = match &dn.scope {
            Some(sheet_uuid) => match SheetId::from_uuid_str(sheet_uuid) {
                Ok(sid) => formula_types::Scope::Sheet(sid),
                Err(_) => formula_types::Scope::Workbook,
            },
            None => formula_types::Scope::Workbook,
        };
        engine
            .stores
            .compute
            .remove_named_range_scoped(&mut engine.mirror, &dn_scope, &dn.name);
    }

    engine.stores.compute.mark_dirty();

    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: scope.unwrap_or_default(),
        kind: ChangeKind::Removed,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn import_named_ranges(
    engine: &mut ComputeEngine,
    names: Vec<named_ranges::DefinedName>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::ImportNamedRanges { names })? {
        MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn set_print_settings(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    settings: domain_types::domain::print::PrintSettings,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::set_print_settings(&mut engine.stores.storage, sheet_id, &settings);
    let mut result = MutationResult::empty();
    result.print_settings_changes.push(PrintSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        settings,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_hf_image(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    info: domain_types::domain::print::HeaderFooterImageInfo,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut images = print::get_hf_images(&engine.stores.storage, sheet_id);
    let pos = info.position;
    if let Some(existing) = images.iter_mut().find(|i| i.position == pos) {
        *existing = info;
    } else {
        images.push(info);
    }
    print::set_hf_images(&mut engine.stores.storage, sheet_id, &images);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn remove_hf_image(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    position: domain_types::domain::print::HfImagePosition,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut images = print::get_hf_images(&engine.stores.storage, sheet_id);
    images.retain(|i| i.position != position);
    print::set_hf_images(&mut engine.stores.storage, sheet_id, &images);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn clear_range(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::ClearRange {
        sheet_id: *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    })? {
        MutationOutput::Recalc(result) => Ok((engine.flush_viewport_patches(), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn clear_range_and_return_ids(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::ClearRangeAndReturnIds {
        sheet_id: *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    })? {
        MutationOutput::Recalc(result) => Ok((engine.flush_viewport_patches(), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn replace_all_in_range(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    text: String,
    replacement: String,
    options: crate::engine_types::queries::FindInRangeOptions,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let (count, mut recalc) = services::mutation_handlers::replace_all_in_range(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        &text,
        &replacement,
        &options,
    )?;
    engine.prepare_recalc_for_flush(&mut recalc);
    let patches = engine.flush_viewport_patches();
    Ok((
        patches,
        MutationResult::from_recalc(recalc).with_data(&count)?,
    ))
}
