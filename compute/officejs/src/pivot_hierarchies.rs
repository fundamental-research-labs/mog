//! Office.js PivotTable hierarchy collections.
//!
//! The Office.js layer represents a PivotTable field in five related views:
//! `hierarchies` contains every source field and the four area collections
//! contain the placements currently on the row, column, data, or filter axis.
//! This module owns the wire translation for those views.  The host adapter
//! keeps the persisted PivotTable config in the engine and calls these helpers
//! for each load/set/add/remove operation.
//!
//! A hierarchy collection item descriptor uses a stable placement ID (or the
//! source field ID for the all-fields collection) as `key`.  The descriptor
//! key is separate from the Office.js proxy ID allocated by `bootstrap.js`.
//! Reads always receive the current config, so a fresh `load` observes a
//! rename, move, aggregation change, or number-format change made by an
//! earlier request batch.
//!
//! The JavaScript proxy emits `pivotGetHierarchyCollection` and
//! `pivotHierarchyGetItem` to bind objects, `pivotHierarchyCollectionGetCount`
//! for deferred counts, and `pivotHierarchyAdd`, `pivotHierarchyRemove`, and
//! `pivotHierarchySetToDefault` for mutations.  Generic `load` and `set`
//! operations then call the helpers below through the extension binding.

use std::collections::HashMap;

use domain_types::domain::analytics::AggregateFunction;
use domain_types::domain::pivot::{
    PivotField, PivotFieldArea, PivotFieldPlacementFlat, PivotTableConfig, ShowValuesAs,
    ShowValuesAsBaseItem, ShowValuesAsConfig,
};
use serde_json::{json, Value};
use value_types::CellValue;

/// Errors returned by the hierarchy translation layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PivotHierarchyError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

fn invalid(message: impl Into<String>) -> PivotHierarchyError {
    PivotHierarchyError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn item_not_found(key: &str, kind: PivotHierarchyKind) -> PivotHierarchyError {
    PivotHierarchyError {
        code: "ItemNotFound",
        message: format!("No {kind} PivotHierarchy named '{key}' exists"),
    }
}

fn unsupported(property: &str, owner: &str) -> PivotHierarchyError {
    PivotHierarchyError {
        code: "UnsupportedOperation",
        message: format!("{owner}.{property} is unsupported"),
    }
}

/// The wire selector used by the five PivotTable hierarchy collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PivotHierarchyKind {
    /// `PivotTable.hierarchies` — all fields available from the source.
    All,
    /// `PivotTable.rowHierarchies`.
    Row,
    /// `PivotTable.columnHierarchies`.
    Column,
    /// `PivotTable.dataHierarchies`.
    Data,
    /// `PivotTable.filterHierarchies`.
    Filter,
}

impl PivotHierarchyKind {
    /// Parse the compact selector emitted by `pivot_hierarchies.js`.
    pub(crate) fn from_wire(value: &str) -> Result<Self, PivotHierarchyError> {
        match value {
            "all" => Ok(Self::All),
            "row" => Ok(Self::Row),
            "column" => Ok(Self::Column),
            "data" => Ok(Self::Data),
            "filter" => Ok(Self::Filter),
            _ => Err(invalid(format!(
                "Unsupported PivotHierarchy collection kind '{value}'"
            ))),
        }
    }

    fn area(self) -> Option<PivotFieldArea> {
        match self {
            Self::All => None,
            Self::Row => Some(PivotFieldArea::Row),
            Self::Column => Some(PivotFieldArea::Column),
            Self::Data => Some(PivotFieldArea::Value),
            Self::Filter => Some(PivotFieldArea::Filter),
        }
    }

    fn owner(self) -> &'static str {
        match self {
            Self::All => "PivotHierarchy",
            Self::Row | Self::Column => "RowColumnPivotHierarchy",
            Self::Data => "DataPivotHierarchy",
            Self::Filter => "FilterPivotHierarchy",
        }
    }
}

impl std::fmt::Display for PivotHierarchyKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::All => "PivotHierarchy",
            Self::Row => "row hierarchy",
            Self::Column => "column hierarchy",
            Self::Data => "data hierarchy",
            Self::Filter => "filter hierarchy",
        })
    }
}

/// One `{key, properties}` descriptor consumed by the shared collection hook.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct PivotHierarchyCollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A resolved hierarchy identity.  The aggregate `hierarchies` collection is
/// backed by `PivotTableConfig.fields`, while an axis collection is backed by
/// one of the flat placement records.  Keeping these as distinct variants is
/// deliberate: treating every item as a placement makes the all-fields path
/// resolve to `None` and turns every lookup into `ItemNotFound`.
#[derive(Debug, Clone, Copy)]
pub(crate) enum PivotHierarchyItemRef<'a> {
    Field(&'a PivotField),
    Placement(&'a PivotFieldPlacementFlat),
}

/// Return collection items for a current pivot config.
pub(crate) fn collection_items(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    properties: &[String],
) -> Result<Vec<PivotHierarchyCollectionItem>, PivotHierarchyError> {
    let mut result = Vec::new();
    match kind {
        PivotHierarchyKind::All => {
            for field in &config.fields {
                result.push(PivotHierarchyCollectionItem {
                    key: field.id.to_string(),
                    properties: hierarchy_properties(
                        config,
                        kind,
                        &field.id.to_string(),
                        properties,
                    )?,
                });
            }
        }
        PivotHierarchyKind::Row
        | PivotHierarchyKind::Column
        | PivotHierarchyKind::Data
        | PivotHierarchyKind::Filter => {
            let placements = placements_for_area(config, kind);
            for placement in placements {
                result.push(PivotHierarchyCollectionItem {
                    key: placement_key(placement),
                    properties: hierarchy_properties(
                        config,
                        kind,
                        &placement_key(placement),
                        properties,
                    )?,
                });
            }
        }
    }
    Ok(result)
}

/// Load collection-level properties.  Collection items are requested through
/// `items` or `items/<property>` paths and are returned as descriptors.
pub(crate) fn load_collection(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    properties: &[String],
) -> Result<HashMap<String, Value>, PivotHierarchyError> {
    let mut result = HashMap::new();
    let mut item_properties = Vec::new();
    let mut wants_items = false;
    for property in properties {
        if property == "items" {
            wants_items = true;
        } else if let Some(item_property) = property.strip_prefix("items/") {
            if item_property.is_empty() {
                return Err(unsupported(property, kind.owner()));
            }
            wants_items = true;
            if !item_properties
                .iter()
                .any(|existing| existing == item_property)
            {
                item_properties.push(item_property.to_string());
            }
        } else if property == "isNullObject" {
            result.insert(property.clone(), Value::Bool(false));
        } else if property == "count" {
            result.insert(property.clone(), json!(count(config, kind)));
        } else {
            return Err(unsupported(property, kind.owner()));
        }
    }
    if wants_items {
        result.insert(
            "items".to_string(),
            serde_json::to_value(collection_items(config, kind, &item_properties)?).map_err(
                |error| PivotHierarchyError {
                    code: "GeneralException",
                    message: format!("failed to encode PivotHierarchy items: {error}"),
                },
            )?,
        );
    }
    Ok(result)
}

/// Return the collection count without materializing item properties.
pub(crate) fn count(config: &PivotTableConfig, kind: PivotHierarchyKind) -> usize {
    match kind {
        PivotHierarchyKind::All => config.fields.len(),
        PivotHierarchyKind::Row
        | PivotHierarchyKind::Column
        | PivotHierarchyKind::Data
        | PivotHierarchyKind::Filter => placements_for_area(config, kind).len(),
    }
}

/// Resolve one collection item by its Office.js name or ID and return the
/// requested scalar properties.  Name matching is case-insensitive, as it is
/// for the Excel collection `getItem` methods.
pub(crate) fn load_item(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
    properties: &[String],
) -> Result<HashMap<String, Value>, PivotHierarchyError> {
    let _ = resolve_item(config, kind, key)?;
    hierarchy_properties(config, kind, key, properties)
}

/// Resolve whether a collection lookup has a matching item.
pub(crate) fn contains_item(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> bool {
    resolve_item(config, kind, key).is_ok()
}

/// Apply one writable Office.js hierarchy property to a persisted config.
///
/// The caller is responsible for persisting the returned config through the
/// PivotRef/engine update operation.  This function performs strict type and
/// enum conversion, and therefore keeps the host adapter free of ad-hoc JSON
/// translation.
pub(crate) fn apply_set(
    config: &mut PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
    property: &str,
    value: &Value,
) -> Result<(), PivotHierarchyError> {
    if kind == PivotHierarchyKind::All {
        if property != "name" {
            return Err(unsupported(property, kind.owner()));
        }
        let name = value
            .as_str()
            .ok_or_else(|| invalid("PivotHierarchy.name must be a string"))?;
        let field = resolve_field_mut(config, key)?;
        field.name = name.to_string();
        return Ok(());
    }

    let placement_index = resolve_placement_index(config, kind, key)?;
    match property {
        "name" => {
            let name = value
                .as_str()
                .ok_or_else(|| invalid(format!("{}.name must be a string", kind.owner())))?;
            config.placements[placement_index].display_name = Some(name.to_string());
        }
        "position" => {
            let position = value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| {
                    invalid(format!(
                        "{}.position must be a non-negative integer",
                        kind.owner()
                    ))
                })?;
            let area = kind.area().expect("non-all hierarchy has an area");
            // Reordering through the config primitive gives equal-position
            // writes deterministic Office ordering: a hierarchy assigned an
            // existing position is inserted after the item already there.
            if !config.reorder_placement(placement_index, area, position) {
                return Err(item_not_found(key, kind));
            }
        }
        "enableMultipleFilterItems" if kind == PivotHierarchyKind::Filter => {
            let enabled = value.as_bool().ok_or_else(|| {
                invalid("FilterPivotHierarchy.enableMultipleFilterItems must be a boolean")
            })?;
            config.allow_multiple_filters_per_field = Some(enabled);
        }
        "numberFormat" if kind == PivotHierarchyKind::Data => {
            let format = value
                .as_str()
                .ok_or_else(|| invalid("DataPivotHierarchy.numberFormat must be a string"))?;
            config.placements[placement_index].number_format = Some(format.to_string());
        }
        "summarizeBy" if kind == PivotHierarchyKind::Data => {
            let text = value
                .as_str()
                .ok_or_else(|| invalid("DataPivotHierarchy.summarizeBy must be a string"))?;
            config.placements[placement_index].aggregate_function =
                Some(aggregate_from_office(text)?);
        }
        "showAs" if kind == PivotHierarchyKind::Data => {
            config.placements[placement_index].show_values_as = Some(show_as_from_office(value)?);
        }
        _ => return Err(unsupported(property, kind.owner())),
    }
    Ok(())
}

/// Reset an axis/filter/data hierarchy's optional placement state to Excel's
/// default.  The all-fields collection has no `setToDefault` member.
pub(crate) fn set_to_default(
    config: &mut PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<(), PivotHierarchyError> {
    if kind == PivotHierarchyKind::All {
        return Err(unsupported("setToDefault", kind.owner()));
    }
    let index = resolve_placement_index(config, kind, key)?;
    let field_id = config.placements[index].field_id.clone();
    let placement = &mut config.placements[index];
    placement.display_name = None;
    match kind {
        PivotHierarchyKind::Row | PivotHierarchyKind::Column => {
            placement.aggregate_function = None;
            placement.number_format = None;
            placement.show_values_as = None;
            placement.sort_order = None;
            placement.custom_sort_list = None;
            placement.sort_by_value = None;
            placement.date_grouping = None;
            placement.number_grouping = None;
            placement.show_subtotals = None;
        }
        PivotHierarchyKind::Data => {
            placement.aggregate_function = Some(AggregateFunction::Sum);
            placement.number_format = None;
            placement.show_values_as = None;
        }
        PivotHierarchyKind::Filter => {}
        PivotHierarchyKind::All => unreachable!(),
    }
    // The public pivot reset operation clears the field's filter alongside
    // placement-specific options.  Keep that behavior for every hierarchy
    // view so a reset cannot leave stale filtering in the materialized matrix.
    config.filters.retain(|filter| filter.field_id != field_id);
    Ok(())
}

/// Add a source hierarchy to one of the four mutable axis collections.
/// Existing placements of the same field in another area are removed, as
/// required by the Office.js `add(PivotHierarchy)` contract.
pub(crate) fn add(
    config: &mut PivotTableConfig,
    kind: PivotHierarchyKind,
    source_key: &str,
) -> Result<String, PivotHierarchyError> {
    let area = kind
        .area()
        .ok_or_else(|| invalid("PivotHierarchyCollection.add is unavailable on hierarchies"))?;
    let field = resolve_field(config, source_key)?.clone();
    let field_id = field.id.to_string();

    // Excel moves an existing hierarchy between row, column, and filter
    // collections.  Value placements are independent: a source field may be
    // present on an axis and in the data area at the same time (for example,
    // Region as row labels and Count of Region as a value).  Preserve value
    // placements while moving among the three structural axes.
    if let Some(existing) = config
        .placements
        .iter()
        .find(|placement| placement.field_id == field.id && placement.area == area)
    {
        return Ok(placement_key(existing));
    }
    if area != PivotFieldArea::Value {
        config.placements.retain(|placement| {
            !(placement.field_id == field.id
                && placement.area != area
                && placement.area != PivotFieldArea::Value)
        });
    }

    let position = config
        .placements
        .iter()
        .filter(|placement| placement.area == area)
        .count();
    let placement_id = new_placement_id(config, kind, &field_id);
    config.placements.push(PivotFieldPlacementFlat {
        placement_id: placement_id.clone().into(),
        field_id: field.id,
        calculated_field_id: None,
        area,
        position,
        aggregate_function: (kind == PivotHierarchyKind::Data).then_some(AggregateFunction::Sum),
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: None,
        number_format: None,
        show_values_as: None,
    });
    reindex_area(config, area);
    Ok(placement_id)
}

/// Remove a hierarchy placement from its current area.
pub(crate) fn remove(
    config: &mut PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<(), PivotHierarchyError> {
    let area = kind
        .area()
        .ok_or_else(|| invalid("PivotHierarchyCollection.remove is unavailable on hierarchies"))?;
    let index = resolve_placement_index(config, kind, key)?;
    config.placements.remove(index);
    reindex_area(config, area);
    Ok(())
}

fn placements_for_area(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
) -> Vec<&PivotFieldPlacementFlat> {
    let Some(area) = kind.area() else {
        return Vec::new();
    };
    let mut placements: Vec<_> = config
        .placements
        .iter()
        .filter(|placement| placement.area == area)
        .collect();
    placements.sort_by_key(|placement| placement.position);
    placements
}

/// Resolve a hierarchy against the current config.
///
/// This is intentionally public within the Office.js crate so the extension
/// host can bind a hierarchy object using the same source-field lookup as
/// collection loads.  In particular, `All` resolves from `config.fields`; it
/// does not have a placement and must never be represented by `None`.
pub(crate) fn resolve_item<'a>(
    config: &'a PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<PivotHierarchyItemRef<'a>, PivotHierarchyError> {
    if kind == PivotHierarchyKind::All {
        resolve_field(config, key).map(PivotHierarchyItemRef::Field)
    } else {
        resolve_placement(config, kind, key).map(PivotHierarchyItemRef::Placement)
    }
}

/// Resolve the source field represented by a hierarchy item.
///
/// Axis placements carry only `field_id`, so the helper performs the second
/// lookup for those views.  The all-fields view already resolves to its field
/// directly and therefore succeeds even though it has no placement record.
pub(crate) fn hierarchy_field<'a>(
    config: &'a PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<&'a PivotField, PivotHierarchyError> {
    match resolve_item(config, kind, key)? {
        PivotHierarchyItemRef::Field(field) => Ok(field),
        PivotHierarchyItemRef::Placement(placement) => config
            .get_field(placement.field_id.as_str())
            .ok_or_else(|| item_not_found(key, kind)),
    }
}

fn resolve_placement_index(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<usize, PivotHierarchyError> {
    let area = kind
        .area()
        .ok_or_else(|| invalid("The all-fields hierarchy has no placement"))?;
    config
        .placements
        .iter()
        .position(|placement| placement.area == area && placement_matches(config, placement, key))
        .ok_or_else(|| item_not_found(key, kind))
}

fn resolve_field<'a>(
    config: &'a PivotTableConfig,
    key: &str,
) -> Result<&'a PivotField, PivotHierarchyError> {
    config
        .fields
        .iter()
        .find(|field| field_matches(field, key))
        .ok_or_else(|| item_not_found(key, PivotHierarchyKind::All))
}

fn resolve_field_mut<'a>(
    config: &'a mut PivotTableConfig,
    key: &str,
) -> Result<&'a mut PivotField, PivotHierarchyError> {
    config
        .fields
        .iter_mut()
        .find(|field| field_matches(field, key))
        .ok_or_else(|| item_not_found(key, PivotHierarchyKind::All))
}

fn field_matches(field: &PivotField, key: &str) -> bool {
    field.id.as_str().eq_ignore_ascii_case(key) || field.name.eq_ignore_ascii_case(key)
}

fn placement_matches(
    config: &PivotTableConfig,
    placement: &PivotFieldPlacementFlat,
    key: &str,
) -> bool {
    placement.placement_id.as_str().eq_ignore_ascii_case(key)
        || placement.field_id.as_str().eq_ignore_ascii_case(key)
        || config
            .get_field(placement.field_id.as_str())
            .is_some_and(|field| field.name.eq_ignore_ascii_case(key))
        || placement
            .display_name
            .as_deref()
            .is_some_and(|name| name.eq_ignore_ascii_case(key))
        // Data hierarchies expose Excel's generated "Sum of <field>" style
        // name when no display override is stored.  Include that name in
        // lookup so `getItem(data.name)` remains valid after a fresh read.
        || (placement.area == PivotFieldArea::Value
            && config.get_field(placement.field_id.as_str()).is_some_and(|field| {
                let aggregate = placement
                    .aggregate_function
                    .unwrap_or(AggregateFunction::Sum);
                format!("{} of {}", aggregate_label(aggregate), field.name)
                    .eq_ignore_ascii_case(key)
            }))
}

fn hierarchy_properties(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
    properties: &[String],
) -> Result<HashMap<String, Value>, PivotHierarchyError> {
    let mut result = HashMap::new();
    let resolved = resolve_item(config, kind, key)?;
    let (field, placement) = match resolved {
        // `hierarchies` resolves directly to a source field.  It has no
        // placement, but the field itself is a valid item and supplies id and
        // name for all collection/object reads.
        PivotHierarchyItemRef::Field(field) => (Some(field), None),
        PivotHierarchyItemRef::Placement(placement) => (
            config.get_field(placement.field_id.as_str()),
            Some(placement),
        ),
    };

    let default_properties: &[&str] = match kind {
        PivotHierarchyKind::All => &["id", "name"],
        PivotHierarchyKind::Row | PivotHierarchyKind::Column => &["id", "name", "position"],
        PivotHierarchyKind::Filter => &["enableMultipleFilterItems", "id", "name", "position"],
        PivotHierarchyKind::Data => &[
            "field",
            "id",
            "name",
            "numberFormat",
            "position",
            "showAs",
            "summarizeBy",
        ],
    };
    let properties: Vec<String> = if properties.is_empty() {
        default_properties
            .iter()
            .map(|property| (*property).to_string())
            .collect()
    } else {
        properties.to_vec()
    };
    for property in &properties {
        match property.as_str() {
            "isNullObject" => {
                result.insert(property.clone(), Value::Bool(false));
            }
            "id" => {
                let id = placement
                    .as_ref()
                    .map(|placement| placement.field_id.to_string())
                    .or_else(|| field.map(|field| field.id.to_string()))
                    .ok_or_else(|| item_not_found(key, kind))?;
                result.insert(property.clone(), Value::String(id));
            }
            "name" => {
                let name = display_name(config, kind, key)?;
                result.insert(property.clone(), Value::String(name));
            }
            "position" if kind != PivotHierarchyKind::All => {
                result.insert(
                    property.clone(),
                    json!(placement.as_ref().expect("placement loaded").position),
                );
            }
            "enableMultipleFilterItems" if kind == PivotHierarchyKind::Filter => {
                result.insert(
                    property.clone(),
                    json!(config.allow_multiple_filters_per_field.unwrap_or(false)),
                );
            }
            "numberFormat" if kind == PivotHierarchyKind::Data => {
                result.insert(
                    property.clone(),
                    Value::String(
                        placement
                            .as_ref()
                            .expect("placement loaded")
                            .number_format
                            .clone()
                            .unwrap_or_else(|| "General".to_string()),
                    ),
                );
            }
            "summarizeBy" if kind == PivotHierarchyKind::Data => {
                let aggregate = placement
                    .as_ref()
                    .expect("placement loaded")
                    .aggregate_function
                    .unwrap_or(AggregateFunction::Sum);
                result.insert(
                    property.clone(),
                    Value::String(aggregate_to_office(aggregate)),
                );
            }
            "showAs" if kind == PivotHierarchyKind::Data => {
                let show_as = placement
                    .as_ref()
                    .expect("placement loaded")
                    .show_values_as
                    .as_ref()
                    .map(show_as_to_office)
                    .unwrap_or_else(|| json!({"calculation": "None"}));
                result.insert(property.clone(), show_as);
            }
            "field" if kind == PivotHierarchyKind::Data => {
                let field = field.ok_or_else(|| item_not_found(key, kind))?;
                result.insert(
                    property.clone(),
                    json!({"id": field.id, "name": field.name}),
                );
            }
            other => return Err(unsupported(other, kind.owner())),
        }
    }
    Ok(result)
}

fn resolve_placement<'a>(
    config: &'a PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<&'a PivotFieldPlacementFlat, PivotHierarchyError> {
    let area = kind
        .area()
        .ok_or_else(|| invalid("The all-fields hierarchy has no placement"))?;
    config
        .placements
        .iter()
        .filter(|placement| placement.area == area)
        .find(|placement| placement_matches(config, placement, key))
        .ok_or_else(|| item_not_found(key, kind))
}

fn display_name(
    config: &PivotTableConfig,
    kind: PivotHierarchyKind,
    key: &str,
) -> Result<String, PivotHierarchyError> {
    if kind == PivotHierarchyKind::All {
        return Ok(resolve_field(config, key)?.name.clone());
    }
    let placement = resolve_placement(config, kind, key)?;
    if let Some(name) = placement.display_name.clone() {
        return Ok(name);
    }
    let field = config
        .get_field(placement.field_id.as_str())
        .ok_or_else(|| item_not_found(key, kind))?;
    if kind == PivotHierarchyKind::Data {
        let aggregate = placement
            .aggregate_function
            .unwrap_or(AggregateFunction::Sum);
        Ok(format!("{} of {}", aggregate_label(aggregate), field.name))
    } else {
        Ok(field.name.clone())
    }
}

fn placement_key(placement: &PivotFieldPlacementFlat) -> String {
    if placement.placement_id.is_empty() {
        placement.field_id.to_string()
    } else {
        placement.placement_id.to_string()
    }
}

fn aggregate_to_office(aggregate: AggregateFunction) -> String {
    match aggregate {
        AggregateFunction::Sum => "Sum",
        AggregateFunction::Count | AggregateFunction::CountA => "Count",
        AggregateFunction::Average => "Average",
        AggregateFunction::Max => "Max",
        AggregateFunction::Min => "Min",
        AggregateFunction::Product => "Product",
        AggregateFunction::CountUnique => "Count",
        AggregateFunction::StdDev => "StandardDeviation",
        AggregateFunction::StdDevP => "StandardDeviationP",
        AggregateFunction::Var => "Variance",
        AggregateFunction::VarP => "VarianceP",
        _ => "Sum",
    }
    .to_string()
}

fn aggregate_from_office(value: &str) -> Result<AggregateFunction, PivotHierarchyError> {
    match value {
        "Unknown" | "Automatic" | "Sum" => Ok(AggregateFunction::Sum),
        "Count" => Ok(AggregateFunction::Count),
        "Average" => Ok(AggregateFunction::Average),
        "Max" => Ok(AggregateFunction::Max),
        "Min" => Ok(AggregateFunction::Min),
        "Product" => Ok(AggregateFunction::Product),
        "CountNumbers" => Ok(AggregateFunction::Count),
        "StandardDeviation" => Ok(AggregateFunction::StdDev),
        "StandardDeviationP" => Ok(AggregateFunction::StdDevP),
        "Variance" => Ok(AggregateFunction::Var),
        "VarianceP" => Ok(AggregateFunction::VarP),
        _ => Err(invalid(format!(
            "DataPivotHierarchy.summarizeBy has an invalid value '{value}'"
        ))),
    }
}

fn aggregate_label(aggregate: AggregateFunction) -> &'static str {
    match aggregate {
        AggregateFunction::Count | AggregateFunction::CountA | AggregateFunction::CountUnique => {
            "Count"
        }
        AggregateFunction::Average => "Average",
        AggregateFunction::Max => "Max",
        AggregateFunction::Min => "Min",
        AggregateFunction::Product => "Product",
        AggregateFunction::StdDev => "StdDev",
        AggregateFunction::StdDevP => "StdDevP",
        AggregateFunction::Var => "Var",
        AggregateFunction::VarP => "VarP",
        AggregateFunction::Sum => "Sum",
        _ => "Sum",
    }
}

fn show_as_to_office(config: &ShowValuesAsConfig) -> Value {
    let calculation = match config.calculation_type {
        ShowValuesAs::NoCalculation => "None",
        ShowValuesAs::PercentOfGrandTotal => "PercentOfGrandTotal",
        ShowValuesAs::PercentOfColumnTotal => "PercentOfColumnTotal",
        ShowValuesAs::PercentOfRowTotal => "PercentOfRowTotal",
        ShowValuesAs::PercentOfParentRowTotal => "PercentOfParentRowTotal",
        ShowValuesAs::PercentOfParentColumnTotal => "PercentOfParentColumnTotal",
        ShowValuesAs::Difference => "DifferenceFrom",
        ShowValuesAs::PercentDifference => "PercentDifferenceFrom",
        ShowValuesAs::RunningTotal => "RunningTotal",
        ShowValuesAs::PercentRunningTotal => "PercentRunningTotal",
        ShowValuesAs::RankAscending => "RankAscending",
        ShowValuesAs::RankDescending => "RankDecending",
        ShowValuesAs::Index => "Index",
        _ => "None",
    };
    let mut object = serde_json::Map::new();
    object.insert(
        "calculation".to_string(),
        Value::String(calculation.to_string()),
    );
    if let Some(field) = &config.base_field {
        object.insert("baseField".to_string(), json!({"id": field}));
    }
    if let Some(item) = &config.base_item {
        object.insert("baseItem".to_string(), show_as_base_item_to_office(item));
    }
    Value::Object(object)
}

fn show_as_base_item_to_office(item: &ShowValuesAsBaseItem) -> Value {
    match item {
        ShowValuesAsBaseItem::Relative { position } => json!({
            "type": "relative",
            "position": match position {
                domain_types::domain::pivot::RelativePosition::Previous => "previous",
                domain_types::domain::pivot::RelativePosition::Next => "next",
                _ => "previous",
            },
        }),
        ShowValuesAsBaseItem::Specific { value } => json!({"type": "specific", "value": value}),
    }
}

fn show_as_from_office(value: &Value) -> Result<ShowValuesAsConfig, PivotHierarchyError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataPivotHierarchy.showAs must be an object"))?;
    let calculation = object
        .get("calculation")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("DataPivotHierarchy.showAs.calculation is required"))?;
    let calculation_type = match calculation {
        "Unknown" | "None" => ShowValuesAs::NoCalculation,
        "PercentOfGrandTotal" => ShowValuesAs::PercentOfGrandTotal,
        "PercentOfColumnTotal" => ShowValuesAs::PercentOfColumnTotal,
        "PercentOfRowTotal" => ShowValuesAs::PercentOfRowTotal,
        "PercentOfParentRowTotal" => ShowValuesAs::PercentOfParentRowTotal,
        "PercentOfParentColumnTotal" | "PercentOfParentTotal" => {
            ShowValuesAs::PercentOfParentColumnTotal
        }
        "DifferenceFrom" => ShowValuesAs::Difference,
        "PercentDifferenceFrom" => ShowValuesAs::PercentDifference,
        "RunningTotal" => ShowValuesAs::RunningTotal,
        "PercentRunningTotal" => ShowValuesAs::PercentRunningTotal,
        "RankAscending" => ShowValuesAs::RankAscending,
        "RankDecending" => ShowValuesAs::RankDescending,
        "Index" => ShowValuesAs::Index,
        _ => {
            return Err(invalid(format!(
                "DataPivotHierarchy.showAs.calculation has an invalid value '{calculation}'"
            )));
        }
    };
    let base_field = object
        .get("baseField")
        .and_then(|value| value.get("id").or_else(|| value.get("name")))
        .and_then(Value::as_str)
        .map(domain_types::domain::pivot::FieldId::from);
    let base_item = parse_show_as_base_item(object.get("baseItem"))?;
    Ok(ShowValuesAsConfig {
        calculation_type,
        base_field,
        base_item,
    })
}

fn parse_show_as_base_item(
    value: Option<&Value>,
) -> Result<Option<ShowValuesAsBaseItem>, PivotHierarchyError> {
    let Some(value) = value else { return Ok(None) };
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataPivotHierarchy.showAs.baseItem must be an object"))?;
    let item_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("DataPivotHierarchy.showAs.baseItem.type is required"))?;
    match item_type {
        "relative" => {
            let position = match object.get("position").and_then(Value::as_str) {
                Some("previous") => domain_types::domain::pivot::RelativePosition::Previous,
                Some("next") => domain_types::domain::pivot::RelativePosition::Next,
                Some(other) => {
                    return Err(invalid(format!(
                        "DataPivotHierarchy.showAs.baseItem.position has an invalid value '{other}'"
                    )));
                }
                None => {
                    return Err(invalid(
                        "DataPivotHierarchy.showAs.baseItem.position is required",
                    ));
                }
            };
            Ok(Some(ShowValuesAsBaseItem::Relative { position }))
        }
        "specific" => {
            let raw = object
                .get("value")
                .cloned()
                .or_else(|| object.get("name").cloned())
                .or_else(|| object.get("id").cloned())
                .ok_or_else(|| invalid("DataPivotHierarchy.showAs.baseItem.value is required"))?;
            let value = serde_json::from_value::<CellValue>(raw).map_err(|error| {
                invalid(format!(
                    "DataPivotHierarchy.showAs.baseItem.value is invalid: {error}"
                ))
            })?;
            Ok(Some(ShowValuesAsBaseItem::Specific { value }))
        }
        other => Err(invalid(format!(
            "DataPivotHierarchy.showAs.baseItem.type has an invalid value '{other}'"
        ))),
    }
}

fn new_placement_id(config: &PivotTableConfig, kind: PivotHierarchyKind, field_id: &str) -> String {
    let prefix = match kind {
        PivotHierarchyKind::All => "all",
        PivotHierarchyKind::Row => "row",
        PivotHierarchyKind::Column => "column",
        PivotHierarchyKind::Data => "data",
        PivotHierarchyKind::Filter => "filter",
    };
    let stem = format!("officejs-{prefix}-{field_id}");
    if !config
        .placements
        .iter()
        .any(|placement| placement.placement_id.as_str() == stem)
    {
        return stem;
    }
    for suffix in 1..usize::MAX {
        let candidate = format!("{stem}-{suffix}");
        if !config
            .placements
            .iter()
            .any(|placement| placement.placement_id.as_str() == candidate)
        {
            return candidate;
        }
    }
    // The loop above cannot realistically exhaust a pivot config, but keeping
    // a deterministic fallback avoids an unwrap in a host-facing path.
    format!("{stem}-overflow")
}

fn reindex_area(config: &mut PivotTableConfig, area: PivotFieldArea) {
    let mut indices: Vec<usize> = config
        .placements
        .iter()
        .enumerate()
        .filter(|(_, placement)| placement.area == area)
        .map(|(index, _)| index)
        .collect();
    indices.sort_by_key(|index| config.placements[*index].position);
    for (position, index) in indices.into_iter().enumerate() {
        config.placements[index].position = position;
    }
}
