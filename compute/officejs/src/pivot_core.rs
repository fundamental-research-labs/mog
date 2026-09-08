//! Office.js PivotTable collection and core object adapters.
//!
//! This module owns the wire translation for PivotTable lifecycle operations
//! and delegates persistence, computation, refresh, and deletion to
//! compute-api/the production compute engine. It never keeps a second workbook
//! map or copies calculated values into host state.
//
// Wire operations consumed by the host integrator:
//
// * getPivotTableCollection { id, worksheetId }
// * pivotTableAdd { id, collectionId, worksheetId?, name,
//   sourceRangeId?|sourceTableId?|sourceAddress?, destinationRangeId?
//   |destinationAddress? }
// * pivotTableGetItem { id, collectionId, worksheetId?, key, orNullObject }
// * pivotTableCollectionGetCount { collectionId, worksheetId?, resultId }
// * pivotTableCollectionRefreshAll { collectionId, worksheetId? }
// * pivotTableDelete { id }, pivotTableRefresh { id }
// * pivotTableGetDataSourceString { id, resultId }
// * pivotTableGetDataSourceType { id, resultId }
// * pivotGetLayout { id, pivotId, pivotObjectId }
// * pivotLayoutGetRange { id, layoutId, pivotId, pivotObjectId, kind }
// * pivotTableGetWorksheet { id, pivotId, pivotObjectId }
//
// A host handler should bind PivotRef for PivotTable objects, PivotLayoutRef
// for layout objects, and a real RangeRef for layout range operations.
// Hierarchy objects use the PivotRef config, update_config, worksheet, and
// stable_id methods.

use std::collections::HashMap;

use compute_api::pure::{self, PivotTableConfig, PivotTableResult};
use compute_api::{CellRange, ComputeApiError, Sheet, Workbook};
use serde::Serialize;
use serde_json::{json, Value};

use crate::range_navigation::{parse_range_address, RangeAddress, RangeNavigationError};
use crate::tables::{TableError, TableRangeKind, TableRef};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PivotError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl PivotError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<ComputeApiError> for PivotError {
    fn from(error: ComputeApiError) -> Self {
        let code = match error {
            ComputeApiError::InvalidAddress { .. }
            | ComputeApiError::InvalidRange { .. }
            | ComputeApiError::InvalidOperation(_) => "InvalidArgument",
            ComputeApiError::SheetNotFound { .. } => "ItemNotFound",
            ComputeApiError::CellError(_) => "InvalidArgument",
            ComputeApiError::EngineShutdown
            | ComputeApiError::ThreadSpawn(_)
            | ComputeApiError::Compute(_) => "GeneralException",
        };
        Self::new(code, error.to_string())
    }
}

impl From<RangeNavigationError> for PivotError {
    fn from(error: RangeNavigationError) -> Self {
        Self::new(error.code, error.message)
    }
}

impl From<TableError> for PivotError {
    fn from(error: TableError) -> Self {
        Self::new(error.code, error.message)
    }
}

fn invalid(message: impl Into<String>) -> PivotError {
    PivotError::new("InvalidArgument", message)
}

fn item_not_found(key: impl Into<String>) -> PivotError {
    PivotError::new(
        "ItemNotFound",
        format!("PivotTable '{}' was not found", key.into()),
    )
}

fn unsupported(owner: &str, property: &str) -> PivotError {
    PivotError::new(
        "UnsupportedOperation",
        format!("{owner}.{property} is unsupported by this Office.js host"),
    )
}

fn encoding(error: impl std::fmt::Display) -> PivotError {
    PivotError::new(
        "GeneralException",
        format!("Failed to encode PivotTable state: {error}"),
    )
}

const DEFAULT_PIVOT_PROPERTIES: &[&str] = &[
    "allowMultipleFiltersPerField",
    "enableDataValueEditing",
    "id",
    "name",
    "refreshOnOpen",
    "useCustomSortLists",
];

const DEFAULT_LAYOUT_PROPERTIES: &[&str] = &[
    "altTextDescription",
    "altTextTitle",
    "autoFormat",
    "emptyCellText",
    "enableFieldList",
    "fillEmptyCells",
    "layoutType",
    "preserveFormatting",
    "showColumnGrandTotals",
    "showFieldHeaders",
    "showRowGrandTotals",
    "subtotalLocation",
];

#[derive(Clone)]
pub(crate) enum PivotSource {
    Range { sheet: Sheet, address: String },
    Table(TableRef),
}

impl PivotSource {
    pub(crate) fn range(sheet: Sheet, address: impl Into<String>) -> Self {
        Self::Range {
            sheet,
            address: address.into(),
        }
    }

    pub(crate) fn table(table: TableRef) -> Self {
        Self::Table(table)
    }

    fn resolve(&self) -> Result<(Sheet, String), PivotError> {
        match self {
            Self::Range { sheet, address } => {
                let parsed = bounded_range(sheet, address, "PivotTableCollection.add source")?;
                Ok((sheet.clone(), parsed.to_a1()))
            }
            Self::Table(table) => {
                let address = table.range_address(TableRangeKind::Full)?;
                Ok((table.sheet(), address))
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct PivotDestination {
    pub(crate) sheet: Sheet,
    pub(crate) address: String,
}

impl PivotDestination {
    pub(crate) fn new(sheet: Sheet, address: impl Into<String>) -> Self {
        Self {
            sheet,
            address: address.into(),
        }
    }

    fn anchor(&self) -> Result<(u32, u32), PivotError> {
        let parsed = bounded_range(
            &self.sheet,
            &self.address,
            "PivotTableCollection.add destination",
        )?;
        let (row, col, _, _) = parsed.bounds();
        Ok((row, col))
    }
}

#[derive(Clone)]
pub(crate) struct PivotRange {
    sheet: Sheet,
    address: String,
}

impl PivotRange {
    pub(crate) fn new(sheet: Sheet, address: impl Into<String>) -> Self {
        Self {
            sheet,
            address: address.into(),
        }
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    pub(crate) fn address(&self) -> &str {
        &self.address
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PivotTableCollectionItem {
    pub(crate) key: String,
    pub(crate) worksheet_id: String,
    pub(crate) properties: HashMap<String, Value>,
}

#[derive(Clone)]
pub(crate) struct PivotTableCollectionRef {
    workbook: Workbook,
    worksheet: Option<Sheet>,
}

impl PivotTableCollectionRef {
    pub(crate) fn new(workbook: Workbook, worksheet: Option<Sheet>) -> Self {
        Self {
            workbook,
            worksheet,
        }
    }

    pub(crate) fn workbook(&self) -> Workbook {
        self.workbook.clone()
    }

    pub(crate) fn worksheet(&self) -> Option<Sheet> {
        self.worksheet.clone()
    }

    pub(crate) fn source_from_string(&self, source: &str) -> Result<PivotSource, PivotError> {
        let (sheet, address) = resolve_qualified_range(
            &self.workbook,
            self.worksheet.as_ref(),
            source,
            "PivotTableCollection.add source",
        )?;
        Ok(PivotSource::range(sheet, address))
    }

    pub(crate) fn destination_from_string(
        &self,
        destination: &str,
    ) -> Result<PivotDestination, PivotError> {
        let (sheet, address) = resolve_qualified_range(
            &self.workbook,
            self.worksheet.as_ref(),
            destination,
            "PivotTableCollection.add destination",
        )?;
        Ok(PivotDestination::new(sheet, address))
    }

    pub(crate) fn get_count(&self) -> Result<usize, PivotError> {
        Ok(self.records()?.len())
    }

    pub(crate) fn get_item(&self, key: &str) -> Result<PivotRef, PivotError> {
        required_name(key, "PivotTableCollection.getItem")?;
        let (_, config) = self
            .records()?
            .into_iter()
            .find(|(_, config)| {
                config.id.eq_ignore_ascii_case(key) || config.name.eq_ignore_ascii_case(key)
            })
            .ok_or_else(|| item_not_found(key))?;
        let worksheet = self.output_sheet(&config)?;
        Ok(PivotRef::new(
            self.workbook.clone(),
            worksheet,
            config.id,
            false,
        ))
    }

    pub(crate) fn get_item_or_null_object(
        &self,
        key: &str,
    ) -> Result<Option<PivotRef>, PivotError> {
        required_name(key, "PivotTableCollection.getItemOrNullObject")?;
        match self.get_item(key) {
            Ok(pivot) => Ok(Some(pivot)),
            Err(error) if error.code == "ItemNotFound" => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub(crate) fn add(
        &self,
        name: &str,
        source: PivotSource,
        destination: PivotDestination,
    ) -> Result<PivotRef, PivotError> {
        required_name(name, "PivotTableCollection.add name")?;
        if self
            .records()?
            .iter()
            .any(|(_, config)| config.name.eq_ignore_ascii_case(name))
        {
            return Err(invalid(format!(
                "A PivotTable named '{name}' already exists in this collection"
            )));
        }

        let (source_sheet, source_address) = source.resolve()?;
        let (destination_row, destination_col) = destination.anchor()?;
        let source_range = bounded_range(
            &source_sheet,
            &source_address,
            "PivotTableCollection.add source",
        )?;
        let (start_row, start_col, end_row, end_col) = source_range.bounds();
        let data = source_sheet
            .get_range_values_2d(CellRange::Bounds(start_row, start_col, end_row, end_col))
            .map_err(PivotError::from)?;
        let fields = pure::detect_fields(data);
        let fields = serde_json::to_value(fields).map_err(encoding)?;

        let source_sheet_name = source_sheet.name().map_err(PivotError::from)?;
        let destination_sheet_name = destination.sheet.name().map_err(PivotError::from)?;
        let config_value = json!({
            "schemaVersion": 2,
            "id": "",
            "name": name,
            "sourceSheetId": source_sheet.id().to_uuid_string(),
            "sourceSheetName": source_sheet_name,
            "sourceRange": {
                "startRow": start_row,
                "startCol": start_col,
                "endRow": end_row,
                "endCol": end_col,
            },
            "outputSheetId": destination.sheet.id().to_uuid_string(),
            "outputSheetName": destination_sheet_name,
            "outputLocation": { "row": destination_row, "col": destination_col },
            "fields": fields,
            "placements": [],
            "filters": [],
        });

        let config = destination
            .sheet
            .pivots()
            .create_config(&config_value)
            .map_err(PivotError::from)?;
        Ok(PivotRef::new(
            self.workbook.clone(),
            destination.sheet,
            config.id,
            false,
        ))
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, PivotError> {
        let (wants_items, item_properties) = collection_query(properties)?;
        let mut result = HashMap::new();
        if wants_items {
            let items = self.collection_items(&item_properties)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(items).map_err(encoding)?,
            );
        }
        if properties.iter().any(|property| property == "isNullObject") {
            result.insert("isNullObject".to_string(), Value::Bool(false));
        }
        Ok(result)
    }

    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<PivotTableCollectionItem>, PivotError> {
        let properties = if properties.is_empty() {
            DEFAULT_PIVOT_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };
        self.records()?
            .into_iter()
            .map(|(_, config)| {
                let worksheet = self.output_sheet(&config)?;
                let pivot = PivotRef::new(
                    self.workbook.clone(),
                    worksheet.clone(),
                    config.id.clone(),
                    false,
                );
                Ok(PivotTableCollectionItem {
                    key: config.id,
                    worksheet_id: worksheet.id().to_uuid_string(),
                    properties: pivot.load(&properties)?,
                })
            })
            .collect()
    }

    pub(crate) fn refresh_all(&self) -> Result<(), PivotError> {
        for (_, config) in self.records()? {
            let worksheet = self.output_sheet(&config)?;
            let pivot = PivotRef::new(self.workbook.clone(), worksheet, config.id, false);
            pivot.refresh()?;
        }
        Ok(())
    }

    fn records(&self) -> Result<Vec<(Sheet, PivotTableConfig)>, PivotError> {
        let mut result = Vec::new();
        if let Some(sheet) = &self.worksheet {
            result.extend(
                sheet
                    .pivots()
                    .get_all()
                    .map_err(PivotError::from)?
                    .into_iter()
                    .map(|config| (sheet.clone(), config)),
            );
        } else {
            for name in self.workbook.sheet_names().map_err(PivotError::from)? {
                let sheet = self
                    .workbook
                    .sheet_by_name(&name)
                    .map_err(PivotError::from)?;
                result.extend(
                    sheet
                        .pivots()
                        .get_all()
                        .map_err(PivotError::from)?
                        .into_iter()
                        .map(|config| (sheet.clone(), config)),
                );
            }
        }
        result.sort_by(|(left_sheet, left), (right_sheet, right)| {
            left_sheet
                .id()
                .to_uuid_string()
                .cmp(&right_sheet.id().to_uuid_string())
                .then_with(|| left.output_location.row.cmp(&right.output_location.row))
                .then_with(|| left.output_location.col.cmp(&right.output_location.col))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(result)
    }

    fn output_sheet(&self, config: &PivotTableConfig) -> Result<Sheet, PivotError> {
        resolve_config_sheet(&self.workbook, config)
    }
}

#[derive(Clone)]
pub(crate) struct PivotRef {
    workbook: Workbook,
    worksheet: Sheet,
    stable_id: String,
    null_object: bool,
}

impl PivotRef {
    pub(crate) fn new(
        workbook: Workbook,
        worksheet: Sheet,
        stable_id: impl Into<String>,
        null_object: bool,
    ) -> Self {
        Self {
            workbook,
            worksheet,
            stable_id: stable_id.into(),
            null_object,
        }
    }

    pub(crate) fn null(workbook: Workbook, worksheet: Sheet) -> Self {
        Self::new(workbook, worksheet, "", true)
    }

    pub(crate) fn stable_id(&self) -> &str {
        &self.stable_id
    }

    pub(crate) fn worksheet(&self) -> Sheet {
        self.worksheet.clone()
    }

    pub(crate) fn workbook(&self) -> Workbook {
        self.workbook.clone()
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }

    pub(crate) fn config(&self) -> Result<PivotTableConfig, PivotError> {
        if self.null_object {
            return Err(PivotError::new(
                "InvalidObjectPath",
                "PivotTable is a null object",
            ));
        }
        if let Some(config) = self
            .worksheet
            .pivots()
            .get(&self.stable_id)
            .map_err(PivotError::from)?
        {
            return Ok(config);
        }
        for name in self.workbook.sheet_names().map_err(PivotError::from)? {
            let sheet = self
                .workbook
                .sheet_by_name(&name)
                .map_err(PivotError::from)?;
            if let Some(config) = sheet
                .pivots()
                .get(&self.stable_id)
                .map_err(PivotError::from)?
            {
                return Ok(config);
            }
        }
        Err(item_not_found(&self.stable_id))
    }

    pub(crate) fn refresh_binding(&self) -> Result<Self, PivotError> {
        let config = self.config()?;
        Ok(Self::new(
            self.workbook.clone(),
            resolve_config_sheet(&self.workbook, &config)?,
            self.stable_id.clone(),
            false,
        ))
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, PivotError> {
        let config = self.config()?;
        let properties = if properties.is_empty() {
            DEFAULT_PIVOT_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "id" => Value::String(config.id.clone()),
                "name" => Value::String(config.name.clone()),
                "allowMultipleFiltersPerField" => {
                    json!(config.allow_multiple_filters_per_field.unwrap_or(false))
                }
                "enableDataValueEditing" => Value::Bool(false),
                "refreshOnOpen" => Value::Bool(refresh_on_open(&config)),
                "useCustomSortLists" => Value::Bool(false),
                navigation if is_navigation_property(navigation) => {
                    return Err(unsupported("PivotTable", navigation));
                }
                other => return Err(unsupported("PivotTable", other)),
            };
            result.insert(property, value);
        }
        Ok(result)
    }

    pub(crate) fn update_config(
        &self,
        config: PivotTableConfig,
    ) -> Result<PivotTableConfig, PivotError> {
        let current = self.config()?;
        let updated = self
            .output_sheet_for(&current)?
            .pivots()
            .update(&self.stable_id, config)
            .map_err(PivotError::from)?
            .extract_data::<Option<PivotTableConfig>>()
            .flatten()
            .ok_or_else(|| item_not_found(&self.stable_id))?;
        Ok(updated)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), PivotError> {
        let mut config = self.config()?;
        match property {
            "name" => config.name = required_value_string(value, "PivotTable.name")?.to_string(),
            "allowMultipleFiltersPerField" => {
                config.allow_multiple_filters_per_field = Some(required_bool(
                    value,
                    "PivotTable.allowMultipleFiltersPerField",
                )?);
            }
            "refreshOnOpen" => {
                let refresh = required_bool(value, "PivotTable.refreshOnOpen")?;
                let mut object = serde_json::to_value(&config).map_err(encoding)?;
                ensure_object(&mut object, "dataOptions");
                object["dataOptions"]["refreshOnOpen"] = Value::Bool(refresh);
                config = serde_json::from_value(object).map_err(encoding)?;
            }
            "id" => return Err(invalid("PivotTable.id is read-only")),
            "enableDataValueEditing" | "useCustomSortLists" => {
                return Err(unsupported("PivotTable", property));
            }
            other => return Err(unsupported("PivotTable", other)),
        }
        self.update_config(config)?;
        Ok(())
    }

    pub(crate) fn delete(&self) -> Result<(), PivotError> {
        let config = self.config()?;
        self.output_sheet_for(&config)?
            .pivots()
            .delete(&self.stable_id)
            .map_err(PivotError::from)?;
        Ok(())
    }

    pub(crate) fn refresh(&self) -> Result<(), PivotError> {
        let config = self.config()?;
        self.output_sheet_for(&config)?
            .pivots()
            .refresh(&self.stable_id, None)
            .map_err(PivotError::from)?;
        Ok(())
    }

    pub(crate) fn data_source_string(&self) -> Result<String, PivotError> {
        let config = self.config()?;
        let source_sheet = source_sheet_for(&self.workbook, &config)?;
        let sheet_name = source_sheet.name().map_err(PivotError::from)?;
        Ok(format!(
            "{}!{}",
            qualified_sheet_name(&sheet_name),
            range_to_a1(&config.source_range)
        ))
    }

    pub(crate) fn data_source_type(&self) -> Result<&'static str, PivotError> {
        let config = self.config()?;
        let source_sheet = source_sheet_for(&self.workbook, &config)?;
        let tables = self.workbook.get_all_tables().map_err(PivotError::from)?;
        for entry in tables {
            let Some(table_sheet) = resolve_sheet_id(&self.workbook, &entry.sheet_id)? else {
                continue;
            };
            if table_sheet.id() == source_sheet.id() && entry.table.range == config.source_range {
                return Ok("LocalTable");
            }
        }
        Ok("LocalRange")
    }

    pub(crate) fn layout_range(
        &self,
        kind: PivotLayoutRangeKind,
    ) -> Result<PivotRange, PivotError> {
        let config = self.config()?;
        let sheet = self.output_sheet_for(&config)?;
        let result = sheet
            .pivots()
            .materialize(&self.stable_id, None)
            .map_err(PivotError::from)?;
        let bounds = result.rendered_bounds;
        let anchor = config.output_location;
        let (start_row, start_col, end_row, end_col) =
            layout_bounds(kind, anchor.row, anchor.col, &bounds, &result)?;
        Ok(PivotRange::new(
            sheet,
            a1_range(start_row, start_col, end_row, end_col)?,
        ))
    }

    pub(crate) fn layout(&self) -> PivotLayoutRef {
        PivotLayoutRef::new(self.clone())
    }

    fn output_sheet_for(&self, config: &PivotTableConfig) -> Result<Sheet, PivotError> {
        resolve_config_sheet(&self.workbook, config)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PivotLayoutRangeKind {
    Full,
    RowLabel,
    ColumnLabel,
    DataBody,
    FilterAxis,
}

impl PivotLayoutRangeKind {
    pub(crate) fn from_wire(value: &str) -> Result<Self, PivotError> {
        match value {
            "full" => Ok(Self::Full),
            "rowLabel" => Ok(Self::RowLabel),
            "columnLabel" => Ok(Self::ColumnLabel),
            "dataBody" => Ok(Self::DataBody),
            "filterAxis" => Ok(Self::FilterAxis),
            other => Err(invalid(format!(
                "Unsupported PivotLayout range kind '{other}'"
            ))),
        }
    }
}

#[derive(Clone)]
pub(crate) struct PivotLayoutRef {
    pivot: PivotRef,
}

impl PivotLayoutRef {
    pub(crate) fn new(pivot: PivotRef) -> Self {
        Self { pivot }
    }

    pub(crate) fn pivot(&self) -> PivotRef {
        self.pivot.clone()
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, PivotError> {
        let config = self.pivot.config()?;
        let properties = if properties.is_empty() {
            DEFAULT_LAYOUT_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };
        let object = serde_json::to_value(&config).map_err(encoding)?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "altTextDescription" | "altTextTitle" => Value::String(String::new()),
                "autoFormat" => Value::Bool(config.auto_format.unwrap_or(true)),
                "emptyCellText" => object
                    .pointer("/dataOptions/emptyValue")
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new())),
                "enableFieldList" => Value::Bool(true),
                "fillEmptyCells" => Value::Bool(false),
                "layoutType" => layout_type_value(&config),
                "preserveFormatting" => Value::Bool(config.preserve_formatting.unwrap_or(true)),
                "showColumnGrandTotals" => json!(config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_column_grand_totals)
                    .unwrap_or(true)),
                "showFieldHeaders" => {
                    let layout = config.layout.as_ref();
                    let row = layout
                        .and_then(|layout| layout.show_row_headers)
                        .unwrap_or(true);
                    let column = layout
                        .and_then(|layout| layout.show_column_headers)
                        .unwrap_or(true);
                    Value::Bool(row || column)
                }
                "showRowGrandTotals" => json!(config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_row_grand_totals)
                    .unwrap_or(true)),
                "subtotalLocation" => subtotal_location_value(&config),
                other => return Err(unsupported("PivotLayout", other)),
            };
            result.insert(property, value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), PivotError> {
        let mut object = serde_json::to_value(self.pivot.config()?).map_err(encoding)?;
        match property {
            "autoFormat" => {
                object["autoFormat"] = Value::Bool(required_bool(value, "PivotLayout.autoFormat")?);
            }
            "preserveFormatting" => {
                object["preserveFormatting"] =
                    Value::Bool(required_bool(value, "PivotLayout.preserveFormatting")?);
            }
            "showRowGrandTotals" | "showColumnGrandTotals" => {
                let value = required_bool(value, &format!("PivotLayout.{property}"))?;
                ensure_object(&mut object, "layout");
                object["layout"][property] = Value::Bool(value);
            }
            "showFieldHeaders" => {
                let value = required_bool(value, "PivotLayout.showFieldHeaders")?;
                ensure_object(&mut object, "layout");
                object["layout"]["showRowHeaders"] = Value::Bool(value);
                object["layout"]["showColumnHeaders"] = Value::Bool(value);
            }
            "layoutType" => {
                let layout = required_value_string(value, "PivotLayout.layoutType")?;
                ensure_object(&mut object, "layout");
                object["layout"]["layoutForm"] = Value::String(layout_form(layout)?.to_string());
            }
            "subtotalLocation" => {
                let location = required_value_string(value, "PivotLayout.subtotalLocation")?;
                ensure_object(&mut object, "layout");
                object["layout"]["subtotalLocation"] =
                    Value::String(subtotal_form(location)?.to_string());
            }
            "emptyCellText" => {
                let value = required_value_string(value, "PivotLayout.emptyCellText")?;
                ensure_object(&mut object, "dataOptions");
                object["dataOptions"]["emptyValue"] = Value::String(value.to_string());
            }
            "altTextDescription" | "altTextTitle" | "enableFieldList" | "fillEmptyCells" => {
                return Err(unsupported("PivotLayout", property));
            }
            other => return Err(unsupported("PivotLayout", other)),
        }
        let config = serde_json::from_value(object).map_err(encoding)?;
        self.pivot.update_config(config)?;
        Ok(())
    }

    pub(crate) fn range(&self, kind: PivotLayoutRangeKind) -> Result<PivotRange, PivotError> {
        self.pivot.layout_range(kind)
    }

    pub(crate) fn set_method(&self, method: &str, value: &Value) -> Result<(), PivotError> {
        match method {
            "displayBlankLineAfterEachItem" => {
                let value = required_bool(value, "PivotLayout.displayBlankLineAfterEachItem")?;
                let mut object = serde_json::to_value(self.pivot.config()?).map_err(encoding)?;
                ensure_object(&mut object, "layout");
                object["layout"]["insertBlankRowAfterItem"] = Value::Bool(value);
                let config = serde_json::from_value(object).map_err(encoding)?;
                self.pivot.update_config(config)?;
                Ok(())
            }
            "repeatAllItemLabels" => {
                let value = required_bool(value, "PivotLayout.repeatAllItemLabels")?;
                let mut object = serde_json::to_value(self.pivot.config()?).map_err(encoding)?;
                ensure_object(&mut object, "layout");
                object["layout"]["repeatRowLabels"] = Value::Bool(value);
                let config = serde_json::from_value(object).map_err(encoding)?;
                self.pivot.update_config(config)?;
                Ok(())
            }
            other => Err(unsupported("PivotLayout", other)),
        }
    }
}

fn is_navigation_property(property: &str) -> bool {
    matches!(
        property,
        "columnHierarchies"
            | "dataHierarchies"
            | "filterHierarchies"
            | "hierarchies"
            | "layout"
            | "rowHierarchies"
            | "worksheet"
    )
}

fn required_name<'a>(value: &'a str, owner: &str) -> Result<&'a str, PivotError> {
    if value.trim().is_empty() {
        Err(invalid(format!("{owner} name must be a non-empty string")))
    } else {
        Ok(value)
    }
}

fn required_value_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, PivotError> {
    let value = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a string")))?;
    if value.trim().is_empty() {
        return Err(invalid(format!("{property} must be a non-empty string")));
    }
    Ok(value)
}

fn required_bool(value: &Value, property: &str) -> Result<bool, PivotError> {
    value
        .as_bool()
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn ensure_object(value: &mut Value, key: &str) {
    if !value.get(key).is_some_and(Value::is_object) {
        value[key] = json!({});
    }
}

fn bounded_range(
    sheet: &Sheet,
    address: &str,
    operation: &str,
) -> Result<RangeAddress, PivotError> {
    let parsed = parse_range_address(sheet, address)?;
    if parsed.is_whole_sheet() || parsed.is_entire_row() || parsed.is_entire_column() {
        return Err(invalid(format!(
            "{operation} requires a bounded range: '{address}'"
        )));
    }
    Ok(parsed)
}

fn resolve_qualified_range(
    workbook: &Workbook,
    scope: Option<&Sheet>,
    raw: &str,
    operation: &str,
) -> Result<(Sheet, String), PivotError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(invalid(format!(
            "{operation} must be a non-empty range address"
        )));
    }
    let (sheet_name, address) = split_sheet_qualifier(raw)?;
    let sheet = match sheet_name {
        Some(name) => find_sheet_case_insensitive(workbook, &name)?,
        None => scope
            .cloned()
            .or_else(|| workbook.sheet_by_index(0).ok())
            .ok_or_else(|| PivotError::new("ItemNotFound", "The workbook has no worksheet"))?,
    };
    let address = bounded_range(&sheet, &address, operation)?.to_a1();
    Ok((sheet, address))
}

fn split_sheet_qualifier(raw: &str) -> Result<(Option<String>, String), PivotError> {
    let Some(index) = raw.rfind('!') else {
        return Ok((None, raw.to_string()));
    };
    let sheet = raw[..index].trim();
    let address = raw[index + 1..].trim();
    if sheet.is_empty() || address.is_empty() {
        return Err(invalid(format!("Invalid qualified range address '{raw}'")));
    }
    let sheet = if sheet.starts_with('\'') && sheet.ends_with('\'') && sheet.len() >= 2 {
        sheet[1..sheet.len() - 1].replace("''", "'")
    } else {
        sheet.to_string()
    };
    Ok((Some(sheet), address.to_string()))
}

fn find_sheet_case_insensitive(workbook: &Workbook, name: &str) -> Result<Sheet, PivotError> {
    let names = workbook.sheet_names().map_err(PivotError::from)?;
    let actual = names
        .into_iter()
        .find(|candidate| candidate.eq_ignore_ascii_case(name))
        .ok_or_else(|| {
            PivotError::new("ItemNotFound", format!("Worksheet '{name}' was not found"))
        })?;
    workbook.sheet_by_name(&actual).map_err(PivotError::from)
}

fn resolve_config_sheet(
    workbook: &Workbook,
    config: &PivotTableConfig,
) -> Result<Sheet, PivotError> {
    if let Some(id) = config.output_sheet_id.as_deref() {
        if let Some(sheet) = resolve_sheet_id(workbook, id)? {
            return Ok(sheet);
        }
    }
    find_sheet_case_insensitive(workbook, &config.output_sheet_name)
}

fn source_sheet_for(workbook: &Workbook, config: &PivotTableConfig) -> Result<Sheet, PivotError> {
    if let Some(id) = config.source_sheet_id.as_deref() {
        if let Some(sheet) = resolve_sheet_id(workbook, id)? {
            return Ok(sheet);
        }
    }
    find_sheet_case_insensitive(workbook, &config.source_sheet_name)
}

fn resolve_sheet_id(workbook: &Workbook, id: &str) -> Result<Option<Sheet>, PivotError> {
    if let Ok(sheet_id) = cell_types::SheetId::from_uuid_str(id) {
        return Ok(workbook.sheet(&sheet_id).ok());
    }
    for name in workbook.sheet_names().map_err(PivotError::from)? {
        let sheet = workbook.sheet_by_name(&name).map_err(PivotError::from)?;
        if sheet.id().to_uuid_string().eq_ignore_ascii_case(id) {
            return Ok(Some(sheet));
        }
    }
    Ok(None)
}

fn collection_query(properties: &[String]) -> Result<(bool, Vec<String>), PivotError> {
    let mut wants_items = false;
    let mut item_properties = Vec::new();
    for property in properties {
        match property.as_str() {
            "items" => wants_items = true,
            "isNullObject" => {}
            property if property.starts_with("items/") => {
                let child = property.trim_start_matches("items/");
                if child.is_empty() {
                    return Err(unsupported("PivotTableCollection", property));
                }
                wants_items = true;
                if !item_properties.iter().any(|item| item == child) {
                    item_properties.push(child.to_string());
                }
            }
            other => return Err(unsupported("PivotTableCollection", other)),
        }
    }
    Ok((wants_items, item_properties))
}

fn refresh_on_open(config: &PivotTableConfig) -> bool {
    config
        .data_options
        .as_ref()
        .and_then(|options| options.refresh_on_open)
        .unwrap_or(false)
}

fn layout_type_value(config: &PivotTableConfig) -> Value {
    let value = config
        .layout
        .as_ref()
        .and_then(|layout| layout.layout_form.as_ref())
        .and_then(|form| serde_json::to_value(form).ok())
        .and_then(|value| value.as_str().map(ToString::to_string))
        .map(|value| match value.as_str() {
            "compact" => "Compact".to_string(),
            "tabular" => "Tabular".to_string(),
            "outline" => "Outline".to_string(),
            _ => "Compact".to_string(),
        })
        .unwrap_or_else(|| "Compact".to_string());
    Value::String(value)
}

fn subtotal_location_value(config: &PivotTableConfig) -> Value {
    let value = config
        .layout
        .as_ref()
        .and_then(|layout| layout.subtotal_location.as_ref())
        .and_then(|location| serde_json::to_value(location).ok())
        .and_then(|value| value.as_str().map(ToString::to_string))
        .map(|value| match value.as_str() {
            "top" => "AtTop".to_string(),
            "bottom" => "AtBottom".to_string(),
            _ => "AtBottom".to_string(),
        })
        .unwrap_or_else(|| "AtBottom".to_string());
    Value::String(value)
}

fn layout_form(value: &str) -> Result<&'static str, PivotError> {
    match value.to_ascii_lowercase().as_str() {
        "compact" => Ok("compact"),
        "tabular" => Ok("tabular"),
        "outline" => Ok("outline"),
        other => Err(invalid(format!(
            "PivotLayout.layoutType '{other}' is invalid"
        ))),
    }
}

fn subtotal_form(value: &str) -> Result<&'static str, PivotError> {
    match value {
        "AtTop" | "top" => Ok("top"),
        "AtBottom" | "bottom" => Ok("bottom"),
        "Off" | "off" => Err(unsupported("PivotLayout", "subtotalLocation")),
        other => Err(invalid(format!(
            "PivotLayout.subtotalLocation '{other}' is invalid"
        ))),
    }
}

fn layout_bounds(
    kind: PivotLayoutRangeKind,
    anchor_row: u32,
    anchor_col: u32,
    bounds: &domain_types::domain::pivot::PivotRenderedBounds,
    result: &PivotTableResult,
) -> Result<(u32, u32, u32, u32), PivotError> {
    if bounds.total_rows == 0 || bounds.total_cols == 0 {
        return Err(item_not_found("empty PivotTable"));
    }
    let full_end_row = checked_end(anchor_row, bounds.total_rows)?;
    let full_end_col = checked_end(anchor_col, bounds.total_cols)?;
    match kind {
        PivotLayoutRangeKind::Full => Ok((anchor_row, anchor_col, full_end_row, full_end_col)),
        PivotLayoutRangeKind::ColumnLabel => {
            if bounds.first_data_row == 0 {
                return Err(item_not_found("PivotTable column labels"));
            }
            Ok((
                anchor_row,
                anchor_col,
                checked_end(anchor_row, bounds.first_data_row)?,
                full_end_col,
            ))
        }
        PivotLayoutRangeKind::RowLabel => {
            if bounds.first_data_col == 0 {
                return Err(item_not_found("PivotTable row labels"));
            }
            Ok((
                anchor_row
                    .checked_add(bounds.first_data_row)
                    .ok_or_else(|| invalid("PivotTable row range exceeds worksheet limits"))?,
                anchor_col,
                full_end_row,
                checked_end(anchor_col, bounds.first_data_col)?,
            ))
        }
        PivotLayoutRangeKind::DataBody => {
            if bounds.num_data_cols == 0 {
                return Err(item_not_found("PivotTable data body"));
            }
            let row_grand_total = u32::from(result.grand_totals.row.is_some());
            let body_rows = bounds
                .total_rows
                .checked_sub(bounds.first_data_row)
                .and_then(|rows| rows.checked_sub(row_grand_total))
                .ok_or_else(|| item_not_found("PivotTable data body"))?;
            if body_rows == 0 {
                return Err(item_not_found("PivotTable data body"));
            }
            let start_row = anchor_row
                .checked_add(bounds.first_data_row)
                .ok_or_else(|| invalid("PivotTable data range exceeds worksheet limits"))?;
            let start_col = anchor_col
                .checked_add(bounds.first_data_col)
                .ok_or_else(|| invalid("PivotTable data range exceeds worksheet limits"))?;
            Ok((
                start_row,
                start_col,
                checked_end(start_row, body_rows)?,
                checked_end(start_col, bounds.num_data_cols)?,
            ))
        }
        PivotLayoutRangeKind::FilterAxis => Err(item_not_found("PivotTable filter axis")),
    }
}

fn checked_end(start: u32, length: u32) -> Result<u32, PivotError> {
    if length == 0 {
        return Err(item_not_found("empty PivotTable range"));
    }
    start
        .checked_add(length - 1)
        .ok_or_else(|| invalid("PivotTable range exceeds worksheet limits"))
}

fn a1_range(
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<String, PivotError> {
    if start_row > end_row || start_col > end_col {
        return Err(invalid("PivotTable range is empty"));
    }
    let start = format!("{}{}", column_name(start_col)?, start_row + 1);
    let end = format!("{}{}", column_name(end_col)?, end_row + 1);
    if start == end {
        Ok(start)
    } else {
        Ok(format!("{start}:{end}"))
    }
}

fn range_to_a1(range: &domain_types::domain::pivot::CellRange) -> String {
    format!(
        "{}{}:{}{}",
        column_name_unchecked(range.start_col),
        range.start_row + 1,
        column_name_unchecked(range.end_col),
        range.end_row + 1
    )
}

fn column_name(column: u32) -> Result<String, PivotError> {
    if column >= 16_384 {
        return Err(invalid(
            "PivotTable range exceeds the worksheet column limit",
        ));
    }
    Ok(column_name_unchecked(column))
}

fn column_name_unchecked(mut column: u32) -> String {
    let mut reversed = Vec::new();
    loop {
        reversed.push((b'A' + (column % 26) as u8) as char);
        column /= 26;
        if column == 0 {
            break;
        }
        column -= 1;
    }
    reversed.into_iter().rev().collect()
}

fn qualified_sheet_name(name: &str) -> String {
    if name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}
