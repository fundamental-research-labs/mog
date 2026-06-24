use std::collections::{BTreeMap, BTreeSet};

use formula_types::IdentityFormulaRef;
use snapshot_types::versioning::{
    CanonicalFormula, CanonicalFormulaRef, SemanticObjectDigest, SemanticObjectKind,
    canonical_digest,
};

use crate::storage::engine::YrsComputeEngine;

use super::SemanticStateReadError;
use super::semantic_ids::{canonical_cell_key, canonical_column_key, canonical_row_key};

pub(super) const UNSUPPORTED_CELL_FORMULAS_DOMAIN: &str = "unsupported-cell-formulas";

pub(super) fn canonical_formula(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
    sheet_id: &cell_types::SheetId,
    cell_key: &str,
    cell_id: &cell_types::CellId,
    formula: &formula_types::IdentityFormula,
    unsupported_formulas: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<CanonicalFormula, SemanticStateReadError> {
    match engine.storage().read_cell_from_yrs(sheet_id, cell_id) {
        Some((_value, legacy_formula, Some(persisted_identity))) => {
            if persisted_identity != *formula {
                let object_id =
                    format!("{cell_key}:formula:unsupported:persisted-identity-mismatch");
                unsupported_formulas.insert(
                    object_id.clone(),
                    opaque_formula_digest(
                        object_id,
                        "persisted-identity-mismatch",
                        &(legacy_formula, persisted_identity, formula),
                    )?,
                );
            }
        }
        Some((_value, legacy_formula @ Some(_), None)) => {
            let object_id = format!("{cell_key}:formula:unsupported:legacy-without-identity");
            unsupported_formulas.insert(
                object_id.clone(),
                opaque_formula_digest(
                    object_id,
                    "legacy-without-identity",
                    &(legacy_formula, formula),
                )?,
            );
        }
        Some((_value, None, None)) => {
            let object_id = format!("{cell_key}:formula:unsupported:missing-persisted-formula");
            unsupported_formulas.insert(
                object_id.clone(),
                opaque_formula_digest(object_id, "missing-persisted-formula", formula)?,
            );
        }
        None => {
            let object_id = format!("{cell_key}:formula:unsupported:missing-persisted-cell");
            unsupported_formulas.insert(
                object_id.clone(),
                opaque_formula_digest(object_id, "missing-persisted-cell", formula)?,
            );
        }
    }

    let mut refs = Vec::with_capacity(formula.refs.len());
    let mut dependency_object_ids = BTreeSet::new();
    for (index, formula_ref) in formula.refs.iter().enumerate() {
        match canonical_formula_ref(engine, sheet_keys, formula_ref) {
            Ok(canonical_ref) => {
                dependency_object_ids.extend(canonical_formula_ref_object_ids(&canonical_ref));
                refs.push(canonical_ref);
            }
            Err(reason) => {
                let object_id =
                    format!("{cell_key}:formula-ref:{index}:unsupported:{}", reason.code);
                unsupported_formulas.insert(
                    object_id.clone(),
                    opaque_formula_digest(object_id, reason.code, formula_ref)?,
                );
            }
        }
    }

    Ok(CanonicalFormula {
        normalized_formula: formula.template.clone(),
        dependency_object_ids: dependency_object_ids.into_iter().collect(),
        refs,
        dynamic_array: formula.is_dynamic_array,
        volatile: formula.is_volatile,
        aggregate: formula.is_aggregate,
        digest: None,
    })
}

pub(super) fn record_unrepresented_persisted_formula(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    cell_key: &str,
    cell_id: &cell_types::CellId,
    unsupported_formulas: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    match engine.storage().read_cell_from_yrs(sheet_id, cell_id) {
        Some((_value, legacy_formula @ Some(_), None)) => {
            let object_id = format!("{cell_key}:formula:unsupported:legacy-without-identity");
            unsupported_formulas.insert(
                object_id.clone(),
                opaque_formula_digest(object_id, "legacy-without-identity", &legacy_formula)?,
            );
        }
        Some((_value, legacy_formula, Some(persisted_identity))) => {
            let object_id =
                format!("{cell_key}:formula:unsupported:persisted-identity-without-mirror-formula");
            unsupported_formulas.insert(
                object_id.clone(),
                opaque_formula_digest(
                    object_id,
                    "persisted-identity-without-mirror-formula",
                    &(legacy_formula, persisted_identity),
                )?,
            );
        }
        Some((_, None, None)) | None => {}
    }

    Ok(())
}

pub(super) struct FormulaRefUnsupported {
    pub(super) code: &'static str,
}

pub(super) fn canonical_formula_ref(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
    formula_ref: &IdentityFormulaRef,
) -> Result<CanonicalFormulaRef, FormulaRefUnsupported> {
    match formula_ref {
        IdentityFormulaRef::Cell(cell_ref) => {
            let (sheet_key, row, column) =
                canonical_cell_ref_position(engine, sheet_keys, &cell_ref.id)?;
            Ok(CanonicalFormulaRef::Cell {
                object_id: canonical_cell_key(&sheet_key, row, column),
                sheet_id: sheet_key,
                row,
                column,
                row_absolute: cell_ref.row_absolute,
                column_absolute: cell_ref.col_absolute,
            })
        }
        IdentityFormulaRef::Range(range_ref) => {
            let (start_sheet_key, start_row, start_column) =
                canonical_cell_ref_position(engine, sheet_keys, &range_ref.start_id)?;
            let (end_sheet_key, end_row, end_column) =
                canonical_cell_ref_position(engine, sheet_keys, &range_ref.end_id)?;
            if start_sheet_key != end_sheet_key {
                return Err(FormulaRefUnsupported {
                    code: "cross-sheet-cell-range",
                });
            }
            Ok(CanonicalFormulaRef::Range {
                sheet_id: start_sheet_key.clone(),
                start_object_id: canonical_cell_key(&start_sheet_key, start_row, start_column),
                end_object_id: canonical_cell_key(&end_sheet_key, end_row, end_column),
                start_row,
                start_column,
                end_row,
                end_column,
                start_row_absolute: range_ref.start_row_absolute,
                start_column_absolute: range_ref.start_col_absolute,
                end_row_absolute: range_ref.end_row_absolute,
                end_column_absolute: range_ref.end_col_absolute,
            })
        }
        IdentityFormulaRef::RectRange(range_ref) => {
            let sheet_key = canonical_sheet_key_for(sheet_keys, &range_ref.sheet_id)?;
            let (start_row_sheet, start_row) = engine
                .mirror()
                .row_index_lookup(&range_ref.start_row_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-row-id",
                })?;
            let (end_row_sheet, end_row) = engine
                .mirror()
                .row_index_lookup(&range_ref.end_row_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-row-id",
                })?;
            let (start_col_sheet, start_column) = engine
                .mirror()
                .col_index_lookup(&range_ref.start_col_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-column-id",
                })?;
            let (end_col_sheet, end_column) = engine
                .mirror()
                .col_index_lookup(&range_ref.end_col_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-column-id",
                })?;
            if [
                start_row_sheet,
                end_row_sheet,
                start_col_sheet,
                end_col_sheet,
            ]
            .iter()
            .any(|resolved_sheet| resolved_sheet != &range_ref.sheet_id)
            {
                return Err(FormulaRefUnsupported {
                    code: "cross-sheet-rect-range",
                });
            }

            Ok(CanonicalFormulaRef::RectRange {
                sheet_id: sheet_key.clone(),
                start_row_object_id: canonical_row_key(&sheet_key, start_row),
                start_column_object_id: canonical_column_key(&sheet_key, start_column),
                end_row_object_id: canonical_row_key(&sheet_key, end_row),
                end_column_object_id: canonical_column_key(&sheet_key, end_column),
                start_row,
                start_column,
                end_row,
                end_column,
                start_row_absolute: range_ref.start_row_absolute,
                start_column_absolute: range_ref.start_col_absolute,
                end_row_absolute: range_ref.end_row_absolute,
                end_column_absolute: range_ref.end_col_absolute,
            })
        }
        IdentityFormulaRef::FullRow(row_ref) => {
            let (sheet_id, row) =
                engine
                    .mirror()
                    .row_index_lookup(&row_ref.row_id)
                    .ok_or(FormulaRefUnsupported {
                        code: "unresolved-row-id",
                    })?;
            let sheet_key = canonical_sheet_key_for(sheet_keys, &sheet_id)?;
            Ok(CanonicalFormulaRef::FullRow {
                object_id: canonical_row_key(&sheet_key, row),
                sheet_id: sheet_key,
                row,
                absolute: row_ref.absolute,
            })
        }
        IdentityFormulaRef::RowRange(row_ref) => {
            let (start_sheet_id, start_row) = engine
                .mirror()
                .row_index_lookup(&row_ref.start_row_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-row-id",
                })?;
            let (end_sheet_id, end_row) = engine
                .mirror()
                .row_index_lookup(&row_ref.end_row_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-row-id",
                })?;
            if start_sheet_id != end_sheet_id {
                return Err(FormulaRefUnsupported {
                    code: "cross-sheet-row-range",
                });
            }
            let sheet_key = canonical_sheet_key_for(sheet_keys, &start_sheet_id)?;
            Ok(CanonicalFormulaRef::RowRange {
                sheet_id: sheet_key.clone(),
                start_object_id: canonical_row_key(&sheet_key, start_row),
                end_object_id: canonical_row_key(&sheet_key, end_row),
                start_row,
                end_row,
                start_absolute: row_ref.start_absolute,
                end_absolute: row_ref.end_absolute,
            })
        }
        IdentityFormulaRef::FullCol(column_ref) => {
            let (sheet_id, column) = engine.mirror().col_index_lookup(&column_ref.col_id).ok_or(
                FormulaRefUnsupported {
                    code: "unresolved-column-id",
                },
            )?;
            let sheet_key = canonical_sheet_key_for(sheet_keys, &sheet_id)?;
            Ok(CanonicalFormulaRef::FullColumn {
                object_id: canonical_column_key(&sheet_key, column),
                sheet_id: sheet_key,
                column,
                absolute: column_ref.absolute,
            })
        }
        IdentityFormulaRef::ColRange(column_ref) => {
            let (start_sheet_id, start_column) = engine
                .mirror()
                .col_index_lookup(&column_ref.start_col_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-column-id",
                })?;
            let (end_sheet_id, end_column) = engine
                .mirror()
                .col_index_lookup(&column_ref.end_col_id)
                .ok_or(FormulaRefUnsupported {
                    code: "unresolved-column-id",
                })?;
            if start_sheet_id != end_sheet_id {
                return Err(FormulaRefUnsupported {
                    code: "cross-sheet-column-range",
                });
            }
            let sheet_key = canonical_sheet_key_for(sheet_keys, &start_sheet_id)?;
            Ok(CanonicalFormulaRef::ColumnRange {
                sheet_id: sheet_key.clone(),
                start_object_id: canonical_column_key(&sheet_key, start_column),
                end_object_id: canonical_column_key(&sheet_key, end_column),
                start_column,
                end_column,
                start_absolute: column_ref.start_absolute,
                end_absolute: column_ref.end_absolute,
            })
        }
        IdentityFormulaRef::ExternalCell(_)
        | IdentityFormulaRef::ExternalRange(_)
        | IdentityFormulaRef::ExternalName(_) => Err(FormulaRefUnsupported {
            code: "external-reference",
        }),
    }
}

fn canonical_cell_ref_position(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
    cell_id: &cell_types::CellId,
) -> Result<(String, u32, u32), FormulaRefUnsupported> {
    let sheet_id = engine
        .mirror()
        .sheet_for_cell(cell_id)
        .ok_or(FormulaRefUnsupported {
            code: "unresolved-cell-id",
        })?;
    let sheet_key = canonical_sheet_key_for(sheet_keys, &sheet_id)?;
    let (row, column) = engine
        .grid_index(&sheet_id)
        .and_then(|grid| grid.cell_position(cell_id))
        .ok_or(FormulaRefUnsupported {
            code: "unresolved-cell-position",
        })?;

    Ok((sheet_key, row, column))
}

fn canonical_sheet_key_for(
    sheet_keys: &[(cell_types::SheetId, String)],
    sheet_id: &cell_types::SheetId,
) -> Result<String, FormulaRefUnsupported> {
    sheet_keys
        .iter()
        .find(|(candidate_sheet_id, _)| candidate_sheet_id == sheet_id)
        .map(|(_, sheet_key)| sheet_key.clone())
        .ok_or(FormulaRefUnsupported {
            code: "unresolved-sheet-id",
        })
}

pub(super) fn canonical_formula_ref_object_ids(formula_ref: &CanonicalFormulaRef) -> Vec<String> {
    match formula_ref {
        CanonicalFormulaRef::Cell { object_id, .. }
        | CanonicalFormulaRef::FullRow { object_id, .. }
        | CanonicalFormulaRef::FullColumn { object_id, .. } => vec![object_id.clone()],
        CanonicalFormulaRef::Range {
            start_object_id,
            end_object_id,
            ..
        }
        | CanonicalFormulaRef::RowRange {
            start_object_id,
            end_object_id,
            ..
        }
        | CanonicalFormulaRef::ColumnRange {
            start_object_id,
            end_object_id,
            ..
        } => vec![start_object_id.clone(), end_object_id.clone()],
        CanonicalFormulaRef::RectRange {
            start_row_object_id,
            start_column_object_id,
            end_row_object_id,
            end_column_object_id,
            ..
        } => vec![
            start_row_object_id.clone(),
            start_column_object_id.clone(),
            end_row_object_id.clone(),
            end_column_object_id.clone(),
        ],
    }
}

fn opaque_formula_digest<T: serde::Serialize>(
    object_id: String,
    reason: &str,
    payload: &T,
) -> Result<SemanticObjectDigest, SemanticStateReadError> {
    Ok(SemanticObjectDigest {
        object_id,
        object_kind: SemanticObjectKind::CellFormula,
        domain_id: UNSUPPORTED_CELL_FORMULAS_DOMAIN.to_string(),
        digest: canonical_digest(&(reason, payload))?,
    })
}
