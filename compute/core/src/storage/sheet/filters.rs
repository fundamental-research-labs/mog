//! Filter CRUD operations and evaluation bridge on Yrs storage.
//!
//! Port of `spreadsheet-model/src/filters.ts` (spreadsheet-model elimination).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `filters` map storing filter state as structured Y.Maps keyed by filter ID.
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- filters: Y.Map
//!           +-- {filterId}: Y.Map (structured StoredFilterState fields)
//! ```
//!
//! ## Cell Identity Model
//!
//! Filter ranges are defined by CellId corner references, NOT position-based
//! ranges. This ensures filters survive row/col insert/delete operations.
//!
//! Bridge pattern:
//!   FilterState (CellId-based) -> Resolve Positions -> Evaluate -> hideRows/unhideRows
//!
//! ## Separation of Concerns
//!
//! - This module: STORAGE of filter state (CRUD in Yrs) + evaluation bridge
//! - `table/filter.rs`: Pure filter EVALUATION (bitmap computation on CellValue columns)
//!
//! We do NOT duplicate the evaluation logic from `table/filter.rs`. Instead, the
//! `evaluate_filter` method here resolves CellId positions and delegates column-level
//! evaluation to the table filter engine where possible.

use std::collections::HashMap;
use std::sync::Arc;

use yrs::{Any, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::yrs_helpers::now_millis;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_FILTERS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::{CellValue, ComputeError};
use yrs::Doc;

// Domain types (canonical definitions in domain_types::domain::filter)
pub use domain_types::domain::filter::{
    AdvancedFilterCriteriaRange, AdvancedFilterMode, AdvancedFilterRequest, AdvancedFilterResult,
    AdvancedFilterState, ColumnFilter, DynamicFilterRule, FilterCondition, FilterEvaluationResult,
    FilterHeaderInfo, FilterKind, FilterLogic, FilterOperator, FilterRecordCount, FilterSortState,
    FilterState, SortBy, SortOrder, TopBottomBy, TopBottomDirection,
};

/// The storage serialization of FilterState.
///
/// `column_filters` and `sort_state` are native Rust types.  Individual
/// `ColumnFilter` values are still written as JSON strings per-column inside
/// the Yrs Y.Map (escape hatch for complex tagged enum), but this struct no
/// longer forces a JSON round-trip for the Rust intermediary layer.
#[derive(Debug, Clone)]
struct StoredFilterState {
    id: String,
    filter_type: FilterKind,
    header_start_cell_id: String,
    header_end_cell_id: String,
    data_end_cell_id: String,
    column_filters: HashMap<String, ColumnFilter>,
    advanced_filter: Option<AdvancedFilterState>,
    sort_state: Option<FilterSortState>,
    table_id: Option<String>,
    created_at: Option<u64>,
    updated_at: Option<u64>,
}

#[allow(dead_code)] // pub(crate) module — type alias for filter range operations
pub type CellRange = crate::PositionRange;

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get the `filters` MapRef for a given sheet (read-only).
fn get_filters_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_FILTERS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Structured Y.Map read/write helpers
// =============================================================================

/// Y.Map key constants for StoredFilterState fields.
mod filter_keys {
    pub const ID: &str = "id";
    pub const FILTER_TYPE: &str = "type";
    pub const HEADER_START_CELL_ID: &str = "headerStartCellId";
    pub const HEADER_END_CELL_ID: &str = "headerEndCellId";
    pub const DATA_END_CELL_ID: &str = "dataEndCellId";
    pub const COLUMN_FILTERS: &str = "columnFilters";
    pub const ADVANCED_FILTER: &str = "advancedFilter";
    pub const SORT_STATE: &str = "sortState";
    pub const TABLE_ID: &str = "tableId";
    pub const CREATED_AT: &str = "createdAt";
    pub const UPDATED_AT: &str = "updatedAt";
}

/// Read a string from a Y.Map.
fn flt_read_str<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn flt_read_num<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Write a StoredFilterState into a parent Y.Map at the given key.
///
/// Creates an empty Y.Map sub-entry, then populates all fields as native
/// Yrs keys.  `column_filters` is serialized to a JSON string per the
/// escape-hatch pattern (complex tagged enum).  `sort_state` is likewise
/// serialized to JSON for the Yrs layer.
fn write_stored_filter(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    stored: &StoredFilterState,
) {
    use filter_keys::*;
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    let ft_str = match stored.filter_type {
        FilterKind::AutoFilter => "autoFilter",
        FilterKind::TableFilter => "tableFilter",
        FilterKind::AdvancedFilter => "advancedFilter",
    };
    map.insert(txn, ID, Any::String(Arc::from(stored.id.as_str())));
    map.insert(txn, FILTER_TYPE, Any::String(Arc::from(ft_str)));
    map.insert(
        txn,
        HEADER_START_CELL_ID,
        Any::String(Arc::from(stored.header_start_cell_id.as_str())),
    );
    map.insert(
        txn,
        HEADER_END_CELL_ID,
        Any::String(Arc::from(stored.header_end_cell_id.as_str())),
    );
    map.insert(
        txn,
        DATA_END_CELL_ID,
        Any::String(Arc::from(stored.data_end_cell_id.as_str())),
    );
    // Write column_filters as a JSON string per the Yrs escape-hatch pattern
    let cf_json =
        serde_json::to_string(&stored.column_filters).unwrap_or_else(|_| "{}".to_string());
    map.insert(
        txn,
        COLUMN_FILTERS,
        Any::String(Arc::from(cf_json.as_str())),
    );
    if let Some(ref advanced_filter) = stored.advanced_filter {
        let af_json = serde_json::to_string(advanced_filter).unwrap_or_else(|_| "null".to_string());
        map.insert(
            txn,
            ADVANCED_FILTER,
            Any::String(Arc::from(af_json.as_str())),
        );
    }
    if let Some(ref ss) = stored.sort_state {
        let ss_json = serde_json::to_string(ss).unwrap_or_else(|_| "null".to_string());
        map.insert(txn, SORT_STATE, Any::String(Arc::from(ss_json.as_str())));
    }
    if let Some(ref tid) = stored.table_id {
        map.insert(txn, TABLE_ID, Any::String(Arc::from(tid.as_str())));
    }
    if let Some(ts) = stored.created_at {
        map.insert(txn, CREATED_AT, Any::Number(ts as f64));
    }
    if let Some(ts) = stored.updated_at {
        map.insert(txn, UPDATED_AT, Any::Number(ts as f64));
    }
}

/// Read a StoredFilterState from a structured Y.Map.
fn stored_filter_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<StoredFilterState> {
    use filter_keys::*;
    let id = flt_read_str(map, txn, ID)?;
    let ft_str = flt_read_str(map, txn, FILTER_TYPE).unwrap_or_else(|| "autoFilter".to_string());
    let filter_type = match ft_str.as_str() {
        "tableFilter" => FilterKind::TableFilter,
        "advancedFilter" => FilterKind::AdvancedFilter,
        _ => FilterKind::AutoFilter,
    };
    Some(StoredFilterState {
        id,
        filter_type,
        header_start_cell_id: flt_read_str(map, txn, HEADER_START_CELL_ID).unwrap_or_default(),
        header_end_cell_id: flt_read_str(map, txn, HEADER_END_CELL_ID).unwrap_or_default(),
        data_end_cell_id: flt_read_str(map, txn, DATA_END_CELL_ID).unwrap_or_default(),
        column_filters: {
            let cf_str = flt_read_str(map, txn, COLUMN_FILTERS).unwrap_or_else(|| "{}".to_string());
            serde_json::from_str(&cf_str).unwrap_or_default()
        },
        advanced_filter: flt_read_str(map, txn, ADVANCED_FILTER)
            .and_then(|s| serde_json::from_str(&s).ok()),
        sort_state: flt_read_str(map, txn, SORT_STATE).and_then(|s| serde_json::from_str(&s).ok()),
        table_id: flt_read_str(map, txn, TABLE_ID),
        created_at: flt_read_num(map, txn, CREATED_AT).map(|n| n as u64),
        updated_at: flt_read_num(map, txn, UPDATED_AT).map(|n| n as u64),
    })
}

/// Read a StoredFilterState from a Yrs Out value.
fn read_stored_filter_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<StoredFilterState> {
    match out {
        Out::YMap(map) => stored_filter_from_yrs_map(map, txn),
        _ => None,
    }
}

/// Convert StoredFilterState to FilterState (runtime representation).
fn stored_to_filter_state(stored: &StoredFilterState) -> FilterState {
    FilterState {
        id: stored.id.clone(),
        filter_kind: stored.filter_type.clone(),
        header_start_cell_id: stored.header_start_cell_id.clone(),
        header_end_cell_id: stored.header_end_cell_id.clone(),
        data_end_cell_id: stored.data_end_cell_id.clone(),
        column_filters: stored.column_filters.clone(),
        advanced_filter: stored.advanced_filter.clone(),
        sort_state: stored.sort_state.clone(),
        table_id: stored.table_id.clone(),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    }
}

/// Convert FilterState to StoredFilterState for storage.
fn filter_state_to_stored(state: &FilterState) -> StoredFilterState {
    StoredFilterState {
        id: state.id.clone(),
        filter_type: state.filter_kind.clone(),
        header_start_cell_id: state.header_start_cell_id.clone(),
        header_end_cell_id: state.header_end_cell_id.clone(),
        data_end_cell_id: state.data_end_cell_id.clone(),
        column_filters: state.column_filters.clone(),
        advanced_filter: state.advanced_filter.clone(),
        sort_state: state.sort_state.clone(),
        table_id: state.table_id.clone(),
        created_at: state.created_at,
        updated_at: state.updated_at,
    }
}

/// Public wrapper for hydration to write a FilterState to Y.Map.
///
/// Converts FilterState -> StoredFilterState and writes it as a structured
/// Y.Map entry, using the same path as runtime CRUD operations.
pub fn write_filter_state_to_ymap(
    filters_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    state: &FilterState,
) {
    let stored = filter_state_to_stored(state);
    write_stored_filter(filters_map, txn, &state.id, &stored);
}

/// Create and persist a filter inside an existing Yrs transaction.
///
/// This is used by composite model mutations, such as table creation, where
/// the dependent filter must share the same undo/redo entry as its parent.
#[allow(clippy::too_many_arguments)]
pub fn create_filter_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
    filter_type: FilterKind,
    table_id: Option<String>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<FilterState, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let filters_map =
        get_filters_map(txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;

    let id = format!("{:032x}", id_alloc.next_u128());
    let now = now_millis();
    let state = FilterState {
        id: id.clone(),
        filter_kind: filter_type,
        header_start_cell_id: header_start_cell_id.to_string(),
        header_end_cell_id: header_end_cell_id.to_string(),
        data_end_cell_id: data_end_cell_id.to_string(),
        column_filters: HashMap::new(),
        advanced_filter: None,
        sort_state: None,
        table_id,
        created_at: Some(now),
        updated_at: Some(now),
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };

    let stored = filter_state_to_stored(&state);
    write_stored_filter(&filters_map, txn, &id, &stored);
    Ok(state)
}

/// Upsert a complete FilterState into the sheet filters map.
pub fn upsert_filter_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    state: &FilterState,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map =
        get_filters_map(&txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;
    let stored = filter_state_to_stored(state);
    write_stored_filter(&filters_map, &mut txn, &state.id, &stored);
    Ok(())
}

/// Read all filters from a filters map.
fn read_all_filters<T: yrs::ReadTxn>(txn: &T, filters_map: &MapRef) -> Vec<FilterState> {
    let mut result = Vec::new();
    for (_key, value) in filters_map.iter(txn) {
        if let Some(stored) = read_stored_filter_from_out(&value, txn) {
            result.push(stored_to_filter_state(&stored));
        }
    }
    result
}

// =============================================================================
// ColumnFilter → compute_table::FilterCriteria conversion
// =============================================================================
//
// Instead of duplicating evaluation logic, we convert domain-types ColumnFilter
// to compute-table FilterCriteria and delegate evaluation to
// compute_table::filter::evaluate_column_filter.

/// Convert a `serde_json::Value` to a `CellValue`.
fn json_value_to_cell_value(v: &serde_json::Value) -> CellValue {
    match v {
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                CellValue::from(f)
            } else {
                CellValue::Null
            }
        }
        serde_json::Value::String(s) => CellValue::Text(std::sync::Arc::from(s.as_str())),
        serde_json::Value::Bool(b) => CellValue::Boolean(*b),
        serde_json::Value::Null => CellValue::Null,
        _ => CellValue::Null,
    }
}

/// Convert a domain-types `FilterOperator` to a compute-table `FilterOperator`.
///
/// The domain-types enum has AboveAverage/BelowAverage variants that don't exist
/// in compute-table (those are handled as DynamicFilterRule). This function handles
/// the 14 shared operators; AboveAverage/BelowAverage must be handled separately
/// at the `ColumnFilter` conversion level.
fn convert_filter_operator(op: &FilterOperator) -> compute_table::types::FilterOperator {
    match op {
        FilterOperator::Equals => compute_table::types::FilterOperator::Equals,
        FilterOperator::NotEquals => compute_table::types::FilterOperator::NotEquals,
        FilterOperator::GreaterThan => compute_table::types::FilterOperator::GreaterThan,
        FilterOperator::GreaterThanOrEqual => {
            compute_table::types::FilterOperator::GreaterThanOrEqual
        }
        FilterOperator::LessThan => compute_table::types::FilterOperator::LessThan,
        FilterOperator::LessThanOrEqual => compute_table::types::FilterOperator::LessThanOrEqual,
        FilterOperator::BeginsWith => compute_table::types::FilterOperator::BeginsWith,
        FilterOperator::EndsWith => compute_table::types::FilterOperator::EndsWith,
        FilterOperator::Contains => compute_table::types::FilterOperator::Contains,
        FilterOperator::NotContains => compute_table::types::FilterOperator::NotContains,
        FilterOperator::Between => compute_table::types::FilterOperator::Between,
        FilterOperator::NotBetween => compute_table::types::FilterOperator::NotBetween,
        FilterOperator::IsBlank => compute_table::types::FilterOperator::IsBlank,
        FilterOperator::IsNotBlank => compute_table::types::FilterOperator::IsNotBlank,
        // AboveAverage/BelowAverage are not compute-table FilterOperator variants.
        // They should be converted to DynamicFilter at the ColumnFilter level.
        // If we somehow reach here, fall back to IsNotBlank (passes most rows).
        FilterOperator::AboveAverage | FilterOperator::BelowAverage => {
            compute_table::types::FilterOperator::IsNotBlank
        }
    }
}

/// Convert a domain-types `DynamicFilterRule` to a compute-table `DynamicFilterRule`.
pub fn convert_dynamic_rule(rule: &DynamicFilterRule) -> compute_table::types::DynamicFilterRule {
    match rule {
        DynamicFilterRule::AboveAverage => compute_table::types::DynamicFilterRule::AboveAverage,
        DynamicFilterRule::BelowAverage => compute_table::types::DynamicFilterRule::BelowAverage,
        DynamicFilterRule::Today => compute_table::types::DynamicFilterRule::Today,
        DynamicFilterRule::Yesterday => compute_table::types::DynamicFilterRule::Yesterday,
        DynamicFilterRule::Tomorrow => compute_table::types::DynamicFilterRule::Tomorrow,
        DynamicFilterRule::ThisWeek => compute_table::types::DynamicFilterRule::ThisWeek,
        DynamicFilterRule::LastWeek => compute_table::types::DynamicFilterRule::LastWeek,
        DynamicFilterRule::NextWeek => compute_table::types::DynamicFilterRule::NextWeek,
        DynamicFilterRule::ThisMonth => compute_table::types::DynamicFilterRule::ThisMonth,
        DynamicFilterRule::LastMonth => compute_table::types::DynamicFilterRule::LastMonth,
        DynamicFilterRule::NextMonth => compute_table::types::DynamicFilterRule::NextMonth,
        DynamicFilterRule::ThisQuarter => compute_table::types::DynamicFilterRule::ThisQuarter,
        DynamicFilterRule::LastQuarter => compute_table::types::DynamicFilterRule::LastQuarter,
        DynamicFilterRule::NextQuarter => compute_table::types::DynamicFilterRule::NextQuarter,
        DynamicFilterRule::ThisYear => compute_table::types::DynamicFilterRule::ThisYear,
        DynamicFilterRule::LastYear => compute_table::types::DynamicFilterRule::LastYear,
        DynamicFilterRule::NextYear => compute_table::types::DynamicFilterRule::NextYear,
    }
}

/// Convert a domain-types `ColumnFilter` to a compute-table `FilterCriteria`.
///
/// Handles the type mapping between `serde_json::Value` and `CellValue` for filter
/// values, and maps `AboveAverage`/`BelowAverage` condition operators to
/// `FilterCriteria::Dynamic` (since compute-table treats those as dynamic filters,
/// not condition operators).
fn column_filter_to_table_criteria(cf: &ColumnFilter) -> compute_table::types::FilterCriteria {
    match cf {
        ColumnFilter::Values {
            values,
            include_blanks,
        } => compute_table::types::FilterCriteria::Values(compute_table::types::ValueFilter {
            included: values.iter().map(json_value_to_cell_value).collect(),
            include_blanks: *include_blanks,
        }),
        ColumnFilter::Condition { conditions, logic } => {
            // Check if all conditions use AboveAverage or BelowAverage — if so,
            // convert to a DynamicFilter instead. These operators don't exist in
            // compute-table's FilterOperator enum.
            if conditions.len() == 1 {
                match conditions[0].operator {
                    FilterOperator::AboveAverage => {
                        return compute_table::types::FilterCriteria::Dynamic(
                            compute_table::types::DynamicFilter {
                                rule: compute_table::types::DynamicFilterRule::AboveAverage,
                            },
                        );
                    }
                    FilterOperator::BelowAverage => {
                        return compute_table::types::FilterCriteria::Dynamic(
                            compute_table::types::DynamicFilter {
                                rule: compute_table::types::DynamicFilterRule::BelowAverage,
                            },
                        );
                    }
                    _ => {}
                }
            }

            compute_table::types::FilterCriteria::Condition(compute_table::types::ConditionFilter {
                conditions: conditions
                    .iter()
                    .map(|c| compute_table::types::TableFilterCondition {
                        operator: convert_filter_operator(&c.operator),
                        value: c.value.clone().unwrap_or(CellValue::Null),
                        value2: c.value2.clone(),
                    })
                    .collect(),
                logic: match logic {
                    FilterLogic::And => compute_table::types::FilterLogic::And,
                    FilterLogic::Or => compute_table::types::FilterLogic::Or,
                },
            })
        }
        ColumnFilter::TopBottom {
            direction,
            count,
            by,
        } => compute_table::types::FilterCriteria::TopBottom(
            compute_table::types::TableTopBottomFilter {
                direction: match direction {
                    TopBottomDirection::Top => compute_table::types::TopBottomDirection::Top,
                    TopBottomDirection::Bottom => compute_table::types::TopBottomDirection::Bottom,
                },
                count: *count,
                by: match by {
                    TopBottomBy::Items => compute_table::types::TopBottomBy::Items,
                    TopBottomBy::Percent => compute_table::types::TopBottomBy::Percent,
                    TopBottomBy::Sum => compute_table::types::TopBottomBy::Sum,
                },
            },
        ),
        ColumnFilter::Dynamic { rule } => {
            compute_table::types::FilterCriteria::Dynamic(compute_table::types::DynamicFilter {
                rule: convert_dynamic_rule(rule),
            })
        }
        ColumnFilter::Color { color, by_font } => {
            // Forward the requested hex into the table-engine criterion. The
            // engine's `evaluate_column_filter` does the per-row compare against
            // the resolved CellFormat slice that the caller materializes.
            //
            // `by_font == false` ⇒ filter by cell fill (background); the request
            // hex goes into `cell_color`. `by_font == true` ⇒ filter by font
            // color; the hex goes into `font_color`.
            let parsed = value_types::Color::from_hex(color).ok();
            compute_table::types::FilterCriteria::Color(compute_table::types::TableColorFilter {
                cell_color: if *by_font { None } else { parsed },
                font_color: if *by_font { parsed } else { None },
            })
        }
        ColumnFilter::Icon {
            icon_set_name,
            icon_index,
        } => {
            // Icon filters require CF rule context that is not available at the storage
            // level — the bridge layer performs the actual match. Forward the payload so
            // the bridge can read it from the stored FilterCriteria.
            compute_table::types::FilterCriteria::Icon(compute_table::types::IconFilter {
                icon_set_name: icon_set_name.clone(),
                icon_index: *icon_index,
            })
        }
    }
}

// =============================================================================
// YrsStorage Filter Operations
// =============================================================================

// -------------------------------------------------------------------
// Create
// -------------------------------------------------------------------

/// Create a new filter for a range.
///
/// Stores the filter definition in the Yrs filters map. The range corners
/// are specified as CellId strings (Cell Identity Model).
///
/// Returns the created filter state.
#[allow(clippy::too_many_arguments)]
pub fn create_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
    filter_type: FilterKind,
    table_id: Option<String>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<FilterState, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    create_filter_in_txn(
        &mut txn,
        sheets,
        sheet_id,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        filter_type,
        table_id,
        id_alloc,
    )
}

// -------------------------------------------------------------------
// Read
// -------------------------------------------------------------------

/// Get a filter by ID.
pub fn get_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterState> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = get_filters_map(&txn, sheets, &sheet_hex)?;
    let out = filters_map.get(&txn, filter_id)?;
    let stored = read_stored_filter_from_out(&out, &txn)?;
    Some(stored_to_filter_state(&stored))
}

/// Get all filters in a sheet.
pub fn get_filters_in_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<FilterState> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    read_all_filters(&txn, &filters_map)
}

/// Get the count of filters in a sheet.
pub fn get_filter_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    filters_map.len(&txn) as usize
}

/// Get the filter associated with a table by table ID.
pub fn get_table_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<FilterState> {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters
        .into_iter()
        .find(|f| f.table_id.as_deref() == Some(table_id))
}

/// Get all active filters in a sheet (filters with non-empty column_filters).
pub fn get_active_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<FilterState> {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters
        .into_iter()
        .filter(|f| !f.column_filters.is_empty())
        .collect()
}

/// Get count of active column filters across all filters in a sheet.
pub fn get_active_filter_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters.iter().map(|f| f.column_filters.len()).sum()
}

// -------------------------------------------------------------------
// Update — Column Filters
// -------------------------------------------------------------------

/// Set filter criteria for a specific column (by header CellId).
pub fn set_column_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
    criteria: ColumnFilter,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    // Add the new column filter directly
    stored
        .column_filters
        .insert(header_cell_id.to_string(), criteria);
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Clear filter criteria for a specific column.
pub fn clear_column_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.column_filters.remove(header_cell_id);
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Clear all column filters (show all rows).
pub fn clear_all_column_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, filter_id: &str) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.column_filters.clear();
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

// -------------------------------------------------------------------
// Update — Sort State
// -------------------------------------------------------------------

/// Set the sort state for a filter.
pub fn set_filter_sort_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<FilterSortState>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.sort_state = sort_state;
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Get the sort state for a filter.
pub fn get_filter_sort_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterSortState> {
    let filter = get_filter(doc, sheets, sheet_id, filter_id)?;
    filter.sort_state
}

// -------------------------------------------------------------------
// Delete
// -------------------------------------------------------------------

/// Delete a filter. Returns true if the filter was found and deleted.
pub fn delete_filter_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let filters_map = match get_filters_map(txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    if filters_map.get(txn, filter_id).is_none() {
        return false;
    }

    filters_map.remove(txn, filter_id);
    true
}

/// Delete a filter. Returns true if the filter was found and deleted.
pub fn delete_filter(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, filter_id: &str) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    delete_filter_in_txn(&mut txn, sheets, sheet_id, filter_id)
}

/// Clear all filters for a sheet.
pub fn clear_all_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let keys: Vec<String> = filters_map
        .iter(&txn)
        .map(|(key, _)| key.to_string())
        .collect();

    for key in &keys {
        filters_map.remove(&mut txn, key.as_str());
    }
}

// -------------------------------------------------------------------
// Evaluation Bridge
// -------------------------------------------------------------------

/// Evaluate filter criteria and return which rows match.
///
/// Delegates per-column evaluation to `compute_table::filter::evaluate_column_filter`,
/// which handles Values, Condition, TopBottom, Dynamic, and Color filter types.
///
/// The `get_cell_value` callback provides cell values for a given (row, col).
/// The `resolve_cell_id_to_pos` callback resolves a CellId string to (row, col).
///
/// Returns evaluation results for each data row. An empty result means
/// no column filters are active (all rows match).
pub fn evaluate_filter<F, G, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    get_cell_value: F,
    get_cell_format: G,
    resolve_cell_id_to_pos: R,
) -> Vec<FilterEvaluationResult>
where
    F: Fn(u32, u32) -> CellValue,
    G: Fn(u32, u32) -> domain_types::CellFormat,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let filter = match get_filter(doc, sheets, sheet_id, filter_id) {
        Some(f) => f,
        None => return vec![],
    };

    // Resolve filter range corners to current positions
    let header_start = match resolve_cell_id_to_pos(&filter.header_start_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let data_end = match resolve_cell_id_to_pos(&filter.data_end_cell_id) {
        Some(p) => p,
        None => return vec![],
    };

    let data_start_row = header_start.0 + 1;
    let data_end_row = data_end.0;

    if data_start_row > data_end_row {
        return vec![];
    }

    let row_count = (data_end_row - data_start_row + 1) as usize;

    if filter.column_filters.is_empty() {
        return (0..row_count)
            .map(|i| FilterEvaluationResult {
                row: data_start_row + i as u32,
                matches: true,
            })
            .collect();
    }

    // Current date for dynamic filters (today, this week, etc.). Reads through
    // the injected clock so cloud workers honor the session userTimezone — same
    // source as NOW()/TODAY().
    let now = Some(crate::eval::clock::current_calendar_date());

    // Build per-column bitmaps by delegating to compute-table
    let mut bitmaps: Vec<Vec<u8>> = Vec::new();

    for (header_cell_id, criteria) in &filter.column_filters {
        // Resolve header CellId to current column position
        let header_pos = match resolve_cell_id_to_pos(header_cell_id) {
            Some(p) => p,
            None => continue, // Header cell deleted — skip
        };
        let col = header_pos.1;

        // Convert domain-types ColumnFilter to compute-table FilterCriteria
        let table_criteria = column_filter_to_table_criteria(criteria);

        // Materialize column data as Vec<CellValue>
        let column_data: Vec<CellValue> = (0..row_count)
            .map(|i| get_cell_value(data_start_row + i as u32, col))
            .collect();

        // Materialize per-row CellFormat only when the criterion needs it
        // (color filter). Other criteria don't pay the resolution cost.
        let column_formats: Option<Vec<domain_types::CellFormat>> =
            if matches!(criteria, ColumnFilter::Color { .. }) {
                Some(
                    (0..row_count)
                        .map(|i| get_cell_format(data_start_row + i as u32, col))
                        .collect(),
                )
            } else {
                None
            };

        // Delegate evaluation to compute-table
        let bitmap = compute_table::filter::evaluate_column_filter(
            &table_criteria,
            &column_data,
            column_formats.as_deref(),
            now,
            None, // week_start_day — defaults to Sunday inside compute-table
        );

        bitmaps.push(bitmap);
    }

    if bitmaps.is_empty() {
        return vec![];
    }

    // Compose all per-column bitmaps (AND — row must pass all)
    let final_bitmap = if bitmaps.len() == 1 {
        bitmaps.into_iter().next().unwrap()
    } else {
        let mut composed = bitmaps[0].clone();
        for bitmap in &bitmaps[1..] {
            for i in 0..composed.len() {
                composed[i] &= bitmap[i];
            }
        }
        composed
    };

    // Convert bitmap to FilterEvaluationResult[]
    let mut results = Vec::with_capacity(row_count);
    for (i, &bit) in final_bitmap.iter().enumerate().take(row_count) {
        results.push(FilterEvaluationResult {
            row: data_start_row + i as u32,
            matches: bit == 1,
        });
    }

    results
}

/// Get unique values in a filter column for populating dropdown.
///
/// Returns deduplicated cell values sorted: nulls first, then numbers, then strings.
pub fn get_unique_values<F, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
    get_cell_value: F,
    resolve_cell_id_to_pos: R,
) -> Vec<CellValue>
where
    F: Fn(u32, u32) -> CellValue,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let filter = match get_filter(doc, sheets, sheet_id, filter_id) {
        Some(f) => f,
        None => return vec![],
    };

    // Resolve filter range
    let header_start = match resolve_cell_id_to_pos(&filter.header_start_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let data_end = match resolve_cell_id_to_pos(&filter.data_end_cell_id) {
        Some(p) => p,
        None => return vec![],
    };

    // Resolve header CellId to current column position
    let header_pos = match resolve_cell_id_to_pos(header_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let col = header_pos.1;

    let data_start_row = header_start.0 + 1;
    let data_end_row = data_end.0;

    if data_start_row > data_end_row {
        return vec![];
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_values = Vec::new();

    for row in data_start_row..=data_end_row {
        let value = get_cell_value(row, col);
        let key = cell_value_dedup_key(&value);
        if seen.insert(key) {
            unique_values.push(value);
        }
    }

    // Sort: nulls first, then numbers, then strings
    unique_values.sort_by(|a, b| {
        use std::cmp::Ordering;
        let a_null = matches!(a, CellValue::Null);
        let b_null = matches!(b, CellValue::Null);
        if a_null && b_null {
            return Ordering::Equal;
        }
        if a_null {
            return Ordering::Less;
        }
        if b_null {
            return Ordering::Greater;
        }
        match (a, b) {
            (CellValue::Number(na), CellValue::Number(nb)) => {
                na.get().partial_cmp(&nb.get()).unwrap_or(Ordering::Equal)
            }
            _ => a.to_string().cmp(&b.to_string()),
        }
    });

    unique_values
}

/// Get filtered vs total record count for a specific filter.
pub fn get_filtered_record_count<F, G, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    get_cell_value: F,
    get_cell_format: G,
    resolve_cell_id_to_pos: R,
) -> Option<FilterRecordCount>
where
    F: Fn(u32, u32) -> CellValue,
    G: Fn(u32, u32) -> domain_types::CellFormat,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let results = evaluate_filter(
        doc,
        sheets,
        sheet_id,
        filter_id,
        get_cell_value,
        get_cell_format,
        resolve_cell_id_to_pos,
    );
    if results.is_empty() {
        return None;
    }

    let visible = results.iter().filter(|r| r.matches).count();
    let total = results.len();

    Some(FilterRecordCount { visible, total })
}

// =============================================================================
// Dedup Helper
// =============================================================================

/// Create a typed string key for CellValue deduplication.
fn cell_value_dedup_key(value: &CellValue) -> String {
    match value {
        CellValue::Null => "__NULL__".to_string(),
        CellValue::Boolean(b) => format!("__BOOL__:{}", b),
        CellValue::Number(n) => format!("__NUM__:{}", n.get()),
        CellValue::Text(s) => format!("__STR__:{}", s),
        CellValue::Error(e, _) => format!("__ERROR__:{}", e.as_str()),
        CellValue::Array(_) => "__ARRAY__".to_string(),
        CellValue::Control(c) => format!("__BOOL__:{}", c.value),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use value_types::FiniteF64;

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a YrsStorage with one sheet and return (storage, sheet_id).
    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        (storage, sheet_id)
    }

    /// Default-format cell-format closure for tests that don't care about
    /// color filters (the only criterion that consults format data).
    fn test_get_cell_format(_row: u32, _col: u32) -> domain_types::CellFormat {
        domain_types::CellFormat::default()
    }

    // -------------------------------------------------------------------
    // Test 1: Create filter and retrieve
    // -------------------------------------------------------------------

    #[test]
    fn test_create_filter_and_retrieve() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start-id",
            "header-end-id",
            "data-end-id",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("create_filter should succeed");

        assert!(!filter.id.is_empty());
        assert_eq!(filter.filter_kind, FilterKind::AutoFilter);
        assert_eq!(filter.header_start_cell_id, "header-start-id");
        assert_eq!(filter.header_end_cell_id, "header-end-id");
        assert_eq!(filter.data_end_cell_id, "data-end-id");
        assert!(filter.column_filters.is_empty());
        assert!(filter.sort_state.is_none());
        assert!(filter.table_id.is_none());
        assert!(filter.created_at.is_some());
        assert!(filter.updated_at.is_some());

        // Retrieve by ID
        let fetched = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id);
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().id, filter.id);
    }

    // -------------------------------------------------------------------
    // Test 2: Create filter with table ID
    // -------------------------------------------------------------------

    #[test]
    fn test_create_filter_with_table_id() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "h-start",
            "h-end",
            "d-end",
            FilterKind::TableFilter,
            Some("table-1".to_string()),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("create_filter should succeed");

        assert_eq!(filter.filter_kind, FilterKind::TableFilter);
        assert_eq!(filter.table_id, Some("table-1".to_string()));

        // Look up by table ID
        let table_filter = get_table_filter(storage.doc(), storage.sheets(), &sheet_id, "table-1");
        assert!(table_filter.is_some());
        assert_eq!(table_filter.unwrap().id, filter.id);
    }

    // -------------------------------------------------------------------
    // Test 3: Get all filters in sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_get_filters_in_sheet() {
        let (storage, sheet_id) = storage_with_sheet();

        create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "d",
            "e",
            "f",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "g",
            "h",
            "i",
            FilterKind::TableFilter,
            Some("t1".into()),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let filters = get_filters_in_sheet(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(filters.len(), 3);
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            3
        );
    }

    // -------------------------------------------------------------------
    // Test 4: Set column filter
    // -------------------------------------------------------------------

    #[test]
    fn test_set_column_filter() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![
                serde_json::Value::String("Apple".to_string()),
                serde_json::Value::String("Banana".to_string()),
            ],
            include_blanks: false,
        };

        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-1",
            criteria.clone(),
        );

        // Verify the filter was updated
        let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
        assert_eq!(updated.column_filters.len(), 1);
        assert!(matches!(
            updated.column_filters["col-header-1"],
            ColumnFilter::Values { .. }
        ));
        assert!(updated.updated_at >= filter.updated_at);
    }

    // -------------------------------------------------------------------
    // Test 5: Set multiple column filters
    // -------------------------------------------------------------------

    #[test]
    fn test_set_multiple_column_filters() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Set criteria on two columns
        let criteria1 = ColumnFilter::Values {
            values: vec![serde_json::Value::String("A".to_string())],
            include_blanks: false,
        };
        let criteria2 = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::GreaterThan,
                value: Some(CellValue::number(100.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        };

        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-1",
            criteria1,
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-2",
            criteria2,
        );

        let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
        assert_eq!(updated.column_filters.len(), 2);
        assert!(matches!(
            updated.column_filters["col-1"],
            ColumnFilter::Values { .. }
        ));
        assert!(matches!(
            updated.column_filters["col-2"],
            ColumnFilter::Condition { .. }
        ));
    }

    // -------------------------------------------------------------------
    // Test 6: Clear column filter
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_column_filter() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![serde_json::Value::String("A".to_string())],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-1",
            criteria.clone(),
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-2",
            criteria,
        );

        assert_eq!(
            get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id)
                .unwrap()
                .column_filters
                .len(),
            2
        );

        // Clear one column
        clear_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-1",
        );
        let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
        assert_eq!(updated.column_filters.len(), 1);
        assert!(updated.column_filters.contains_key("col-2"));
        assert!(!updated.column_filters.contains_key("col-1"));
    }

    // -------------------------------------------------------------------
    // Test 7: Clear all column filters
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_all_column_filters() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![serde_json::Value::String("A".to_string())],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-1",
            criteria.clone(),
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-2",
            criteria,
        );

        clear_all_column_filters(storage.doc(), storage.sheets(), &sheet_id, &filter.id);

        let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
        assert!(updated.column_filters.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 8: Delete filter
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_filter() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            1
        );
        assert!(delete_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id
        ));
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
        assert!(get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none());

        // Deleting again returns false
        assert!(!delete_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id
        ));
    }

    // -------------------------------------------------------------------
    // Test 9: Clear all filters
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_all_filters() {
        let (storage, sheet_id) = storage_with_sheet();

        for i in 0..5 {
            create_filter(
                storage.doc(),
                storage.sheets(),
                &sheet_id,
                &format!("a{}", i),
                &format!("b{}", i),
                &format!("c{}", i),
                FilterKind::AutoFilter,
                None,
                &crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        }
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            5
        );

        clear_all_filters(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 10: Sort state
    // -------------------------------------------------------------------

    #[test]
    fn test_filter_sort_state() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Initially no sort state
        assert!(
            get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none()
        );

        // Set sort state
        let sort_state = FilterSortState {
            column_cell_id: "col-header-1".to_string(),
            order: SortOrder::Asc,
            sort_by: SortBy::Value,
        };
        set_filter_sort_state(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            Some(sort_state.clone()),
        );

        let fetched_sort =
            get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id);
        assert!(fetched_sort.is_some());
        let fetched_sort = fetched_sort.unwrap();
        assert_eq!(fetched_sort.column_cell_id, "col-header-1");
        assert_eq!(fetched_sort.order, SortOrder::Asc);
        assert_eq!(fetched_sort.sort_by, SortBy::Value);

        // Clear sort state
        set_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id, None);
        assert!(
            get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 11: Evaluate filter - value filter
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_filter_value() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Set value filter: only show "Apple" and "Cherry"
        let criteria = ColumnFilter::Values {
            values: vec![
                serde_json::Value::String("Apple".to_string()),
                serde_json::Value::String("Cherry".to_string()),
            ],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-0",
            criteria,
        );

        // Mock data: header at (0,0), data at rows 1-4, col 0
        // Row 1: "Apple", Row 2: "Banana", Row 3: "Cherry", Row 4: "Date"
        let get_cell_value = |row: u32, _col: u32| -> CellValue {
            match row {
                1 => CellValue::Text("Apple".into()),
                2 => CellValue::Text("Banana".into()),
                3 => CellValue::Text("Cherry".into()),
                4 => CellValue::Text("Date".into()),
                _ => CellValue::Null,
            }
        };

        // Mock resolve: header-start -> (0, 0), header-end -> (0, 2), data-end -> (4, 0)
        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 2)),
                "data-end" => Some((4, 0)),
                "col-header-0" => Some((0, 0)),
                _ => None,
            }
        };

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );

        assert_eq!(results.len(), 4);
        assert!(results[0].matches); // Apple - matches
        assert!(!results[1].matches); // Banana - no match
        assert!(results[2].matches); // Cherry - matches
        assert!(!results[3].matches); // Date - no match
    }

    // -------------------------------------------------------------------
    // Test 12: Evaluate filter - condition filter (greaterThan)
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_filter_condition() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Set condition filter: greaterThan 50
        let criteria = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::GreaterThan,
                value: Some(CellValue::number(50.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-0",
            criteria,
        );

        // Mock data: rows 1-4
        let get_cell_value = |row: u32, _col: u32| -> CellValue {
            match row {
                1 => CellValue::Number(FiniteF64::must(10.0)),
                2 => CellValue::Number(FiniteF64::must(75.0)),
                3 => CellValue::Number(FiniteF64::must(50.0)),
                4 => CellValue::Number(FiniteF64::must(100.0)),
                _ => CellValue::Null,
            }
        };

        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 0)),
                "data-end" => Some((4, 0)),
                "col-header-0" => Some((0, 0)),
                _ => None,
            }
        };

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );

        assert_eq!(results.len(), 4);
        assert!(!results[0].matches); // 10 <= 50
        assert!(results[1].matches); // 75 > 50
        assert!(!results[2].matches); // 50 == 50 (not >)
        assert!(results[3].matches); // 100 > 50
    }

    // -------------------------------------------------------------------
    // Test 13: Evaluate filter - multiple column AND
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_filter_multi_column_and() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Col 0: value filter for "Apple"
        let criteria1 = ColumnFilter::Values {
            values: vec![serde_json::Value::String("Apple".to_string())],
            include_blanks: false,
        };
        // Col 1: condition filter > 50
        let criteria2 = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::GreaterThan,
                value: Some(CellValue::number(50.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        };

        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-0",
            criteria1,
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-1",
            criteria2,
        );

        // Mock data:
        // Row 1: "Apple", 75  -> matches both -> visible
        // Row 2: "Banana", 80 -> col0 fails   -> hidden
        // Row 3: "Apple", 30  -> col1 fails   -> hidden
        let get_cell_value = |row: u32, col: u32| -> CellValue {
            match (row, col) {
                (1, 0) => CellValue::Text("Apple".into()),
                (1, 1) => CellValue::Number(FiniteF64::must(75.0)),
                (2, 0) => CellValue::Text("Banana".into()),
                (2, 1) => CellValue::Number(FiniteF64::must(80.0)),
                (3, 0) => CellValue::Text("Apple".into()),
                (3, 1) => CellValue::Number(FiniteF64::must(30.0)),
                _ => CellValue::Null,
            }
        };

        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 1)),
                "data-end" => Some((3, 0)),
                "col-header-0" => Some((0, 0)),
                "col-header-1" => Some((0, 1)),
                _ => None,
            }
        };

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );

        assert_eq!(results.len(), 3);
        assert!(results[0].matches); // Apple + 75 > 50
        assert!(!results[1].matches); // Banana (not Apple)
        assert!(!results[2].matches); // Apple but 30 <= 50
    }

    // -------------------------------------------------------------------
    // Test 14: Evaluate with no column filters returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_no_filters_returns_empty() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let get_cell_value = |_: u32, _: u32| CellValue::Null;
        let resolve = |_: &str| Some((0u32, 0u32));

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );
        assert!(results.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 15: Get unique values
    // -------------------------------------------------------------------

    #[test]
    fn test_get_unique_values() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Mock data: rows 1-5
        let get_cell_value = |row: u32, _col: u32| -> CellValue {
            match row {
                1 => CellValue::Text("Apple".into()),
                2 => CellValue::Text("Banana".into()),
                3 => CellValue::Text("Apple".into()), // Duplicate
                4 => CellValue::Null,
                5 => CellValue::Text("Cherry".into()),
                _ => CellValue::Null,
            }
        };

        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 0)),
                "data-end" => Some((5, 0)),
                "col-header-0" => Some((0, 0)),
                _ => None,
            }
        };

        let unique = get_unique_values(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-0",
            get_cell_value,
            resolve,
        );

        // Should be: Null, Apple, Banana, Cherry (sorted: null first, then strings)
        assert_eq!(unique.len(), 4);
        assert_eq!(unique[0], CellValue::Null);
        assert_eq!(unique[1], CellValue::Text("Apple".into()));
        assert_eq!(unique[2], CellValue::Text("Banana".into()));
        assert_eq!(unique[3], CellValue::Text("Cherry".into()));
    }

    // -------------------------------------------------------------------
    // Test 16: Get filtered record count
    // -------------------------------------------------------------------

    #[test]
    fn test_get_filtered_record_count() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![serde_json::Value::String("Apple".to_string())],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-header-0",
            criteria,
        );

        let get_cell_value = |row: u32, _col: u32| -> CellValue {
            match row {
                1 => CellValue::Text("Apple".into()),
                2 => CellValue::Text("Banana".into()),
                3 => CellValue::Text("Apple".into()),
                _ => CellValue::Null,
            }
        };

        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 0)),
                "data-end" => Some((3, 0)),
                "col-header-0" => Some((0, 0)),
                _ => None,
            }
        };

        let count = get_filtered_record_count(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );

        assert!(count.is_some());
        let count = count.unwrap();
        assert_eq!(count.visible, 2); // Two "Apple" rows
        assert_eq!(count.total, 3);
    }

    // -------------------------------------------------------------------
    // Test 17: Active filters and count
    // -------------------------------------------------------------------

    #[test]
    fn test_active_filters() {
        let (storage, sheet_id) = storage_with_sheet();

        let f1 = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let f2 = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "d",
            "e",
            "f",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _f3 = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "g",
            "h",
            "i",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // f1 has 2 column filters, f2 has 1
        let criteria = ColumnFilter::Values {
            values: vec![serde_json::Value::String("X".to_string())],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &f1.id,
            "col-1",
            criteria.clone(),
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &f1.id,
            "col-2",
            criteria.clone(),
        );
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &f2.id,
            "col-3",
            criteria,
        );

        let active = get_active_filters(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(active.len(), 2); // f1 and f2 have filters; f3 does not

        let count = get_active_filter_count(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(count, 3); // 2 + 1
    }

    // -------------------------------------------------------------------
    // Test 18: Empty sheet returns empty/zero
    // -------------------------------------------------------------------

    #[test]
    fn test_empty_sheet_returns_empty() {
        let (storage, sheet_id) = storage_with_sheet();

        assert!(get_filter(storage.doc(), storage.sheets(), &sheet_id, "nonexistent").is_none());
        assert!(get_filters_in_sheet(storage.doc(), storage.sheets(), &sheet_id).is_empty());
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
        assert!(get_table_filter(storage.doc(), storage.sheets(), &sheet_id, "t1").is_none());
        assert!(get_active_filters(storage.doc(), storage.sheets(), &sheet_id).is_empty());
        assert_eq!(
            get_active_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 19: Nonexistent sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let fake_sheet = make_sheet_id(999);

        assert!(get_filter(storage.doc(), storage.sheets(), &fake_sheet, "id").is_none());
        assert!(get_filters_in_sheet(storage.doc(), storage.sheets(), &fake_sheet).is_empty());
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &fake_sheet),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 20: Create filter on nonexistent sheet returns error
    // -------------------------------------------------------------------

    #[test]
    fn test_create_filter_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let fake_sheet = make_sheet_id(999);

        let result = create_filter(
            storage.doc(),
            storage.sheets(),
            &fake_sheet,
            "a",
            "b",
            "c",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 21: Set column filter on nonexistent filter is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_set_column_filter_nonexistent() {
        let (storage, sheet_id) = storage_with_sheet();

        let criteria = ColumnFilter::Values {
            values: vec![],
            include_blanks: false,
        };

        // Should not panic
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "nonexistent",
            "col-1",
            criteria,
        );
    }

    // -------------------------------------------------------------------
    // Test 22: Clear column filter on nonexistent filter is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_column_filter_nonexistent() {
        let (storage, sheet_id) = storage_with_sheet();

        // Should not panic
        clear_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "nonexistent",
            "col-1",
        );
    }

    // -------------------------------------------------------------------
    // Test 23: FilterState serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_filter_state_serde_roundtrip() {
        let mut column_filters = HashMap::new();
        column_filters.insert(
            "col-1".to_string(),
            ColumnFilter::Values {
                values: vec![serde_json::Value::String("A".to_string())],
                include_blanks: false,
            },
        );
        column_filters.insert(
            "col-2".to_string(),
            ColumnFilter::Condition {
                conditions: vec![FilterCondition {
                    operator: FilterOperator::Equals,
                    value: Some(CellValue::number(42.0)),
                    value2: None,
                }],
                logic: FilterLogic::And,
            },
        );

        let state = FilterState {
            id: "filter-001".to_string(),
            filter_kind: FilterKind::AutoFilter,
            header_start_cell_id: "cell-a1".to_string(),
            header_end_cell_id: "cell-c1".to_string(),
            data_end_cell_id: "cell-a10".to_string(),
            column_filters,
            advanced_filter: None,
            sort_state: Some(FilterSortState {
                column_cell_id: "col-1".to_string(),
                order: SortOrder::Asc,
                sort_by: SortBy::Value,
            }),
            table_id: Some("table-1".to_string()),
            created_at: Some(1700000000000),
            updated_at: Some(1700000001000),
            start_row: None,
            start_col: None,
            end_row: None,
            end_col: None,
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: FilterState = serde_json::from_str(&json).unwrap();
        assert_eq!(state, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 24: ColumnFilter serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_column_filter_serde_roundtrip() {
        let criteria = ColumnFilter::Values {
            values: vec![serde_json::json!("A")],
            include_blanks: false,
        };

        let json = serde_json::to_string(&criteria).unwrap();
        let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(criteria, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 25: Condition filter — isBlank / isNotBlank (via compute-table delegation)
    // -------------------------------------------------------------------

    /// Helper: evaluate a single ColumnFilter against a slice of CellValues via compute-table.
    /// Returns a Vec<bool> indicating which rows are visible.
    fn eval_column_filter(criteria: &ColumnFilter, data: &[CellValue]) -> Vec<bool> {
        let table_criteria = column_filter_to_table_criteria(criteria);
        let bitmap =
            compute_table::filter::evaluate_column_filter(&table_criteria, data, None, None, None);
        bitmap.iter().map(|&b| b == 1).collect()
    }

    #[test]
    fn test_condition_is_blank() {
        let data = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("hello".into()),
        ];

        let blank_filter = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::IsBlank,
                value: None,
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        let result = eval_column_filter(&blank_filter, &data);
        assert_eq!(result, vec![true, true, false]);

        let not_blank_filter = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::IsNotBlank,
                value: None,
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        let result = eval_column_filter(&not_blank_filter, &data);
        assert_eq!(result, vec![false, false, true]);
    }

    // -------------------------------------------------------------------
    // Test 26: Condition filter — contains / startsWith / endsWith (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_condition_string_operators() {
        let data = vec![CellValue::Text("Hello World".into())];

        let contains = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::Contains,
                value: Some(CellValue::from("world")),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&contains, &data), vec![true]);

        let not_contains = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::NotContains,
                value: Some(CellValue::from("xyz")),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&not_contains, &data), vec![true]);

        let starts = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::BeginsWith,
                value: Some(CellValue::from("hello")),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&starts, &data), vec![true]);

        let ends = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::EndsWith,
                value: Some(CellValue::from("world")),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&ends, &data), vec![true]);
    }

    // -------------------------------------------------------------------
    // Test 27: Condition filter — between / notBetween (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_condition_between() {
        let data = vec![
            CellValue::Number(FiniteF64::must(50.0)),
            CellValue::Number(FiniteF64::must(75.0)),
            CellValue::Number(FiniteF64::must(150.0)),
        ];

        let between = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::Between,
                value: Some(CellValue::number(40.0)),
                value2: Some(CellValue::number(100.0)),
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&between, &data), vec![true, true, false]);

        let not_between = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::NotBetween,
                value: Some(CellValue::number(40.0)),
                value2: Some(CellValue::number(100.0)),
            }],
            logic: FilterLogic::And,
        };
        assert_eq!(
            eval_column_filter(&not_between, &data),
            vec![false, false, true]
        );
    }

    // -------------------------------------------------------------------
    // Test 28: Value filter — case-insensitive string matching (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_value_filter_case_insensitive() {
        let data = vec![CellValue::Text("Apple".into())];

        let filter1 = ColumnFilter::Values {
            values: vec![serde_json::Value::String("apple".to_string())],
            include_blanks: false,
        };
        assert_eq!(eval_column_filter(&filter1, &data), vec![true]);

        let filter2 = ColumnFilter::Values {
            values: vec![serde_json::Value::String("APPLE".to_string())],
            include_blanks: false,
        };
        assert_eq!(eval_column_filter(&filter2, &data), vec![true]);

        let filter3 = ColumnFilter::Values {
            values: vec![serde_json::Value::String("Banana".to_string())],
            include_blanks: false,
        };
        assert_eq!(eval_column_filter(&filter3, &data), vec![false]);
    }

    // -------------------------------------------------------------------
    // Test 29: Value filter — blank matching (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_value_filter_blanks() {
        let data = vec![CellValue::Null, CellValue::Text("".into())];

        // include_blanks: true
        let filter_with_blanks = ColumnFilter::Values {
            values: vec![serde_json::json!("Apple")],
            include_blanks: true,
        };
        let result = eval_column_filter(&filter_with_blanks, &data);
        assert_eq!(result, vec![true, true]);

        // include_blanks: false
        let filter_no_blanks = ColumnFilter::Values {
            values: vec![serde_json::json!("Apple")],
            include_blanks: false,
        };
        let result = eval_column_filter(&filter_no_blanks, &data);
        assert_eq!(result, vec![false, false]);
    }

    // -------------------------------------------------------------------
    // Test 30: Condition filter — OR logic (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_condition_filter_or_logic() {
        let data = vec![CellValue::Number(FiniteF64::must(10.0))];

        let conditions = vec![
            FilterCondition {
                operator: FilterOperator::Equals,
                value: Some(CellValue::number(10.0)),
                value2: None,
            },
            FilterCondition {
                operator: FilterOperator::Equals,
                value: Some(CellValue::number(20.0)),
                value2: None,
            },
        ];

        // OR: 10 == 10 -> true
        let or_filter = ColumnFilter::Condition {
            conditions: conditions.clone(),
            logic: FilterLogic::Or,
        };
        assert_eq!(eval_column_filter(&or_filter, &data), vec![true]);

        // AND: 10 == 10 && 10 == 20 -> false
        let and_filter = ColumnFilter::Condition {
            conditions,
            logic: FilterLogic::And,
        };
        assert_eq!(eval_column_filter(&and_filter, &data), vec![false]);
    }

    // -------------------------------------------------------------------
    // Test 31: FilterKind serde
    // -------------------------------------------------------------------

    #[test]
    fn test_filter_kind_serde() {
        let json = serde_json::to_string(&FilterKind::AutoFilter).unwrap();
        assert_eq!(json, "\"autoFilter\"");

        let json = serde_json::to_string(&FilterKind::TableFilter).unwrap();
        assert_eq!(json, "\"tableFilter\"");

        let json = serde_json::to_string(&FilterKind::AdvancedFilter).unwrap();
        assert_eq!(json, "\"advancedFilter\"");

        let parsed: FilterKind = serde_json::from_str("\"autoFilter\"").unwrap();
        assert_eq!(parsed, FilterKind::AutoFilter);
    }

    // -------------------------------------------------------------------
    // Test 32: StoredFilterState roundtrip through Yrs
    // -------------------------------------------------------------------

    #[test]
    fn test_filter_yrs_roundtrip() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "cell-a1",
            "cell-c1",
            "cell-a10",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Set criteria
        let criteria = ColumnFilter::Condition {
            conditions: vec![
                FilterCondition {
                    operator: FilterOperator::GreaterThan,
                    value: Some(CellValue::number(50.0)),
                    value2: None,
                },
                FilterCondition {
                    operator: FilterOperator::LessThan,
                    value: Some(CellValue::number(200.0)),
                    value2: None,
                },
            ],
            logic: FilterLogic::And,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "header-col-1",
            criteria,
        );

        // Set sort
        let sort_state = FilterSortState {
            column_cell_id: "header-col-1".to_string(),
            order: SortOrder::Desc,
            sort_by: SortBy::Value,
        };
        set_filter_sort_state(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            Some(sort_state),
        );

        // Read back and verify
        let fetched = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
        assert_eq!(fetched.header_start_cell_id, "cell-a1");
        assert_eq!(fetched.header_end_cell_id, "cell-c1");
        assert_eq!(fetched.data_end_cell_id, "cell-a10");
        assert_eq!(fetched.column_filters.len(), 1);
        let col_filter = &fetched.column_filters["header-col-1"];
        assert!(
            matches!(col_filter, ColumnFilter::Condition { conditions, logic } if conditions.len() == 2 && *logic == FilterLogic::And)
        );
        let sort = fetched.sort_state.unwrap();
        assert_eq!(sort.column_cell_id, "header-col-1");
        assert_eq!(sort.order, SortOrder::Desc);
    }

    // -------------------------------------------------------------------
    // Test 33: Evaluate filter with deleted header returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_deleted_header() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![serde_json::json!("X")],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "deleted-header",
            criteria,
        );

        let get_cell_value = |_: u32, _: u32| CellValue::Null;

        // Resolve header-start but not the deleted column header
        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 2)),
                "data-end" => Some((5, 0)),
                // "deleted-header" -> None (deleted)
                _ => None,
            }
        };

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );
        // Column header was deleted, so its bitmap is skipped.
        // Since no other bitmaps exist, result is empty.
        assert!(results.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 34: Evaluate filter with deleted range corners returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_evaluate_deleted_range_corners() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let criteria = ColumnFilter::Values {
            values: vec![serde_json::json!("X")],
            include_blanks: false,
        };
        set_column_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-1",
            criteria,
        );

        let get_cell_value = |_: u32, _: u32| CellValue::Null;

        // header-start can't be resolved -> filter range invalid
        let resolve = |_: &str| -> Option<(u32, u32)> { None };

        let results = evaluate_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            get_cell_value,
            test_get_cell_format,
            resolve,
        );
        assert!(results.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 35: Unique values dedup with numbers
    // -------------------------------------------------------------------

    #[test]
    fn test_unique_values_with_numbers() {
        let (storage, sheet_id) = storage_with_sheet();

        let filter = create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            "header-start",
            "header-end",
            "data-end",
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let get_cell_value = |row: u32, _col: u32| -> CellValue {
            match row {
                1 => CellValue::Number(FiniteF64::must(10.0)),
                2 => CellValue::Number(FiniteF64::must(20.0)),
                3 => CellValue::Number(FiniteF64::must(10.0)), // Dup
                4 => CellValue::Number(FiniteF64::must(30.0)),
                _ => CellValue::Null,
            }
        };

        let resolve = |cell_id: &str| -> Option<(u32, u32)> {
            match cell_id {
                "header-start" => Some((0, 0)),
                "header-end" => Some((0, 0)),
                "data-end" => Some((4, 0)),
                "col-0" => Some((0, 0)),
                _ => None,
            }
        };

        let unique = get_unique_values(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &filter.id,
            "col-0",
            get_cell_value,
            resolve,
        );

        assert_eq!(unique.len(), 3); // 10, 20, 30 (no dup)
        assert_eq!(unique[0], CellValue::Number(FiniteF64::must(10.0)));
        assert_eq!(unique[1], CellValue::Number(FiniteF64::must(20.0)));
        assert_eq!(unique[2], CellValue::Number(FiniteF64::must(30.0)));
    }

    // -------------------------------------------------------------------
    // Test 36: Color filter criteria serde
    // -------------------------------------------------------------------

    #[test]
    fn test_color_filter_serde() {
        let criteria = ColumnFilter::Color {
            color: "#ff0000".to_string(),
            by_font: false,
        };

        let json = serde_json::to_string(&criteria).unwrap();
        let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(criteria, deserialized);
        if let ColumnFilter::Color { color, .. } = &deserialized {
            assert_eq!(color, "#ff0000");
        } else {
            panic!("Expected ColumnFilter::Color");
        }
    }

    // -------------------------------------------------------------------
    // Test 37: Top/bottom filter criteria serde
    // -------------------------------------------------------------------

    #[test]
    fn test_top_bottom_filter_serde() {
        let criteria = ColumnFilter::TopBottom {
            direction: TopBottomDirection::Top,
            count: 10.0,
            by: TopBottomBy::Items,
        };

        let json = serde_json::to_string(&criteria).unwrap();
        let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(criteria, deserialized);
        if let ColumnFilter::TopBottom { direction, .. } = &deserialized {
            assert_eq!(*direction, TopBottomDirection::Top);
        } else {
            panic!("Expected ColumnFilter::TopBottom");
        }
    }

    // -------------------------------------------------------------------
    // Test 38: cell_value_dedup_key uniqueness
    // -------------------------------------------------------------------

    #[test]
    fn test_dedup_key_uniqueness() {
        // Number 1 and string "1" should have different keys
        let num_key = cell_value_dedup_key(&CellValue::Number(FiniteF64::must(1.0)));
        let str_key = cell_value_dedup_key(&CellValue::Text("1".into()));
        assert_ne!(num_key, str_key);

        // Boolean true and string "true" should have different keys
        let bool_key = cell_value_dedup_key(&CellValue::Boolean(true));
        let str_true_key = cell_value_dedup_key(&CellValue::Text("true".into()));
        assert_ne!(bool_key, str_true_key);

        // Null should have a unique key
        let null_key = cell_value_dedup_key(&CellValue::Null);
        assert_ne!(null_key, num_key);
        assert_ne!(null_key, str_key);
    }

    // -------------------------------------------------------------------
    // Test 39: Condition filter — aboveAverage / belowAverage (via compute-table)
    // -------------------------------------------------------------------

    #[test]
    fn test_condition_above_below_average() {
        // Data: 80, 20, text. Average of numeric values = 50.
        let data = vec![
            CellValue::Number(FiniteF64::must(80.0)),
            CellValue::Number(FiniteF64::must(20.0)),
            CellValue::Text("text".into()),
        ];

        // AboveAverage via Condition operator (converted to DynamicFilter internally)
        let above_filter = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::AboveAverage,
                value: None,
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        let result = eval_column_filter(&above_filter, &data);
        // 80 > 50 (above avg), 20 < 50 (not above), "text" (not numeric, not above)
        assert_eq!(result, vec![true, false, false]);

        // BelowAverage via Condition operator
        let below_filter = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::BelowAverage,
                value: None,
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        let result = eval_column_filter(&below_filter, &data);
        // 80 > 50 (not below), 20 < 50 (below avg), "text" (not numeric, not below)
        assert_eq!(result, vec![false, true, false]);
    }

    // -------------------------------------------------------------------
    // Test 40: Clear all on empty sheet is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_all_empty_sheet() {
        let (storage, sheet_id) = storage_with_sheet();
        // Should not panic
        clear_all_filters(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(
            get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
    }
}
