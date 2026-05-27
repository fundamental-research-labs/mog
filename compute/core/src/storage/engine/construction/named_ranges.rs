use super::*;

fn defined_name_scope(scope_hex: Option<&str>) -> Scope {
    scope_hex
        .and_then(hex_to_id)
        .map_or(Scope::Workbook, |raw| Scope::Sheet(SheetId::from_raw(raw)))
}

fn named_range_raw_expression_from_a1(a1: &str, fallback: &str) -> String {
    let a1 = a1.strip_prefix('=').unwrap_or(a1);
    if a1.is_empty() {
        fallback.to_string()
    } else {
        format!("={a1}")
    }
}

/// Convert canonical Yrs defined names into evaluator-ready named-range defs.
///
/// Yrs stores `DefinedName.refers_to` as JSON-serialized `IdentityFormula`.
/// Readers must decode that typed shape first; treating the JSON bytes as raw
/// formula text makes provider replay diverge from first-load import.
pub(in crate::storage::engine) fn defined_names_to_named_range_defs<F>(
    defined_names: Vec<workbook_named_ranges::DefinedName>,
    mut identity_to_a1: F,
) -> Vec<NamedRangeDef>
where
    F: FnMut(&formula_types::IdentityFormula) -> String,
{
    defined_names
        .into_iter()
        .filter_map(|dn| {
            let scope = defined_name_scope(dn.scope.as_deref());
            let identity = match serde_json::from_str::<formula_types::IdentityFormula>(
                &dn.refers_to,
            ) {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(
                        name = %dn.name,
                        error = %e,
                        "Yrs DefinedName.refers_to is not a valid IdentityFormula JSON; \
                         skipping. After typed formula boundary the only canonical on-disk format \
                         is IdentityFormula JSON."
                    );
                    return None;
                }
            };

            if identity.refs.is_empty() {
                let mut def = NamedRangeDef::from_expression(dn.name, scope, identity.template);
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            let a1 = identity_to_a1(&identity);
            if identity_formula_uses_axis_identity_refs(&identity) {
                let mut def = NamedRangeDef::from_expression(
                    dn.name,
                    scope,
                    named_range_raw_expression_from_a1(&a1, &dn.refers_to),
                );
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            Some(NamedRangeDef {
                name: dn.name,
                scope,
                refers_to: identity,
                raw_expression: Some(named_range_raw_expression_from_a1(&a1, &dn.refers_to)),
                linked_range_id: dn.linked_range_id,
            })
        })
        .collect()
}

fn identity_formula_uses_axis_identity_refs(identity: &formula_types::IdentityFormula) -> bool {
    identity.refs.iter().any(|reference| {
        matches!(
            reference,
            formula_types::IdentityFormulaRef::RectRange(_)
                | formula_types::IdentityFormulaRef::FullRow(_)
                | formula_types::IdentityFormulaRef::RowRange(_)
                | formula_types::IdentityFormulaRef::FullCol(_)
                | formula_types::IdentityFormulaRef::ColRange(_)
        )
    })
}

pub(in crate::storage::engine) struct YrsIdentityFormulaLookup {
    formula_sheet: SheetId,
    cell_positions: HashMap<CellId, (SheetId, u32, u32)>,
    row_indices: HashMap<RowId, (SheetId, u32)>,
    col_indices: HashMap<ColId, (SheetId, u32)>,
    sheet_names: HashMap<SheetId, String>,
}

impl YrsIdentityFormulaLookup {
    pub(in crate::storage::engine) fn from_storage(storage: &YrsStorage) -> Self {
        let sheet_order = storage.sheet_order();
        let formula_sheet = sheet_order
            .first()
            .copied()
            .unwrap_or_else(|| SheetId::from_raw(0));
        let mut lookup = Self {
            formula_sheet,
            cell_positions: HashMap::new(),
            row_indices: HashMap::new(),
            col_indices: HashMap::new(),
            sheet_names: HashMap::new(),
        };

        for sheet_id in sheet_order {
            if let Some(name) = crate::storage::sheet::properties::get_sheet_name(
                storage.doc(),
                storage.sheets(),
                &sheet_id,
            ) {
                lookup.sheet_names.insert(sheet_id, name);
            }
            lookup.read_sheet(storage, sheet_id);
        }

        lookup
    }

    fn read_sheet(&mut self, storage: &YrsStorage, sheet_id: SheetId) {
        use compute_document::schema::{KEY_GRID_ID_TO_POS, KEY_GRID_INDEX, KEY_GRID_POS_TO_ID};

        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex) else {
            return;
        };

        let row_index_by_hex: HashMap<String, u32> =
            match crate::storage::infra::grid_helpers::get_row_order_array(&sheet_map, &txn) {
                Some(arr) => (0..arr.len(&txn))
                    .filter_map(|i| match arr.get(&txn, i) {
                        Some(yrs::Out::Any(yrs::Any::String(row_hex))) => {
                            let raw = hex_to_id(&row_hex)?;
                            self.row_indices.insert(RowId::from_raw(raw), (sheet_id, i));
                            Some((row_hex.to_string(), i))
                        }
                        _ => None,
                    })
                    .collect(),
                None => HashMap::new(),
            };

        let col_index_by_hex: HashMap<String, u32> =
            match crate::storage::infra::grid_helpers::get_col_order_array(&sheet_map, &txn) {
                Some(arr) => (0..arr.len(&txn))
                    .filter_map(|i| match arr.get(&txn, i) {
                        Some(yrs::Out::Any(yrs::Any::String(col_hex))) => {
                            let raw = hex_to_id(&col_hex)?;
                            self.col_indices.insert(ColId::from_raw(raw), (sheet_id, i));
                            Some((col_hex.to_string(), i))
                        }
                        _ => None,
                    })
                    .collect(),
                None => HashMap::new(),
            };

        let Some(yrs::Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) else {
            return;
        };

        let mut inserted_from_pos_to_id = false;
        if let Some(yrs::Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
            for (pos_key, value) in pos_to_id.iter(&txn) {
                let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                    continue;
                };
                let (Some(&row), Some(&col)) =
                    (row_index_by_hex.get(row_hex), col_index_by_hex.get(col_hex))
                else {
                    continue;
                };
                let yrs::Out::Any(yrs::Any::String(cell_hex)) = value else {
                    continue;
                };
                let Some(raw) = hex_to_id(&cell_hex) else {
                    continue;
                };
                self.cell_positions
                    .insert(CellId::from_raw(raw), (sheet_id, row, col));
                inserted_from_pos_to_id = true;
            }
        }

        if !inserted_from_pos_to_id
            && let Some(yrs::Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS)
        {
            for (cell_hex, value) in id_to_pos.iter(&txn) {
                let yrs::Out::Any(yrs::Any::String(pos_key)) = value else {
                    continue;
                };
                let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                    continue;
                };
                let (Some(&row), Some(&col)) =
                    (row_index_by_hex.get(row_hex), col_index_by_hex.get(col_hex))
                else {
                    continue;
                };
                let Some(raw) = hex_to_id(cell_hex) else {
                    continue;
                };
                self.cell_positions
                    .insert(CellId::from_raw(raw), (sheet_id, row, col));
            }
        }
    }
}

impl WorkbookLookup for YrsIdentityFormulaLookup {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.cell_positions.get(cell_id).copied()
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.row_indices.get(row_id).copied()
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.col_indices.get(col_id).copied()
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.sheet_names
            .get(sheet_id)
            .map(std::string::String::as_str)
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

pub(in crate::storage::engine) fn normalize_named_range_refs(engine: &mut YrsComputeEngine) {
    let all = workbook_named_ranges::get_all_named_ranges(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );

    let to_normalize: Vec<_> = all
        .into_iter()
        .filter(|dn| serde_json::from_str::<formula_types::IdentityFormula>(&dn.refers_to).is_err())
        .collect();

    if to_normalize.is_empty() {
        return;
    }

    // Pick first sheet as context for workbook-scoped names.
    let first_sheet = engine.mirror.sheet_ids().next().copied();

    // RAII guard: observer is restored even if we panic mid-loop.
    let _guard = engine.mutation.suppress_guard();

    for dn in to_normalize {
        if dn.raw_refers_to.is_some() {
            continue;
        }

        // Determine context sheet: use the name's scope if sheet-scoped,
        // otherwise fall back to the first sheet.
        let context_sheet = dn
            .scope
            .as_deref()
            .and_then(hex_to_id)
            .map(SheetId::from_raw)
            .or(first_sheet);

        let context_sheet = match context_sheet {
            Some(s) => s,
            None => continue, // No sheets at all — nothing to resolve against.
        };

        // Ensure formula has '=' prefix for the parser.
        let a1 = if dn.refers_to.starts_with('=') {
            dn.refers_to.clone()
        } else {
            format!("={}", dn.refers_to)
        };

        let identity = match engine.stores.compute.to_identity_formula_with_rect_ranges(
            &mut engine.mirror,
            &context_sheet,
            &a1,
        ) {
            Ok(id) => id,
            Err(_) => {
                // Non-parseable formula (constants, #REF!, array literals, etc.).
                // Wrap as a template-only IdentityFormula with no cell refs.
                // Use the raw refers_to (without '=' prefix) as the template,
                // matching the convention that template holds the formula body.
                let template = dn
                    .refers_to
                    .strip_prefix('=')
                    .unwrap_or(&dn.refers_to)
                    .to_string();
                formula_types::IdentityFormula {
                    template,
                    refs: vec![],
                    is_dynamic_array: false,
                    is_volatile: false,
                    // Non-parseable fallback (constants, #REF!, array
                    // literals). Aggregate detection requires an AST; with
                    // no parse, the conservative default is false.
                    is_aggregate: false,
                }
            }
        };

        let raw_refers_to =
            if normalized_defined_name_text_lost_opaque_ref(&dn.refers_to, &identity) {
                Some(dn.refers_to.clone())
            } else {
                dn.raw_refers_to.clone()
            };

        let json = match serde_json::to_string(&identity) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(
                    name = %dn.name,
                    error = %e,
                    "Failed to serialize normalized IdentityFormula, skipping"
                );
                continue;
            }
        };
        let updated = workbook_named_ranges::DefinedName {
            refers_to: json,
            raw_refers_to,
            ..dn
        };
        workbook_named_ranges::upsert_named_range(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            &updated,
        );
    }
}

pub(in crate::storage::engine) fn normalized_defined_name_text_lost_opaque_ref(
    original_refers_to: &str,
    identity: &formula_types::IdentityFormula,
) -> bool {
    let original_template = original_refers_to
        .strip_prefix('=')
        .unwrap_or(original_refers_to);
    identity.refs.is_empty() && identity.template != original_template
}
