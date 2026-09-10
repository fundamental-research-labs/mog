use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use compute_api::{CellAddress, ComputeApiError, Sheet, Workbook, mutation::CellInput};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use value_types::CellValue;

use crate::borders::{BorderCollectionRef, BorderError, BorderRef};
use crate::dispatch::{ExtensionBinding, ExtensionHandler, ExtensionRegistry, HostDispatchContext};
use crate::format::{FormatError, FormatRef};
use crate::names::{self, NameError, NamedItemCollectionRef, NamedItemRef};
use crate::range_content::{self, RangeContentError};
use crate::range_navigation::{
    RangeAddress, RangeNavigationError, navigate_range, parse_range_address,
};
use crate::sort_filter::{
    AutoFilterApplyRequest, AutoFilterRef, RangeSortRequest, SortFilterError, apply_range_sort,
};
use crate::table_collections::{
    self, TableCollectionError, TableCollectionKind, TableColumnRangeKind, TableColumnRef,
    TableRowRef,
};
use crate::tables::{self, TableError, TableRangeKind, TableRef};
use crate::validation::{ValidationError, ValidationRef};
use crate::worksheets::{self, WorksheetError, WorksheetRef};

#[derive(Debug, Deserialize)]
#[serde(tag = "op")]
enum Op {
    #[serde(rename = "getItem")]
    GetItem { id: String, name: String },
    #[serde(rename = "getWorksheetCollection")]
    GetWorksheetCollection { id: String },
    #[serde(rename = "getActiveWorksheet")]
    GetActiveWorksheet { id: String },
    #[serde(rename = "addWorksheet")]
    AddWorksheet { id: String, name: Option<String> },
    #[serde(rename = "getNamedItemCollection")]
    GetNamedItemCollection {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
    },
    #[serde(rename = "nameAdd")]
    NameAdd {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
        name: String,
        comment: Option<String>,
        #[serde(rename = "formulaLocal")]
        formula_local: bool,
        reference: Option<Value>,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
    },
    #[serde(rename = "nameGetCount")]
    NameGetCount {
        #[serde(rename = "resultId")]
        result_id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
    },
    #[serde(rename = "nameGetItem")]
    NameGetItem {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
        name: String,
        #[serde(rename = "orNullObject")]
        or_null_object: bool,
    },
    #[serde(rename = "nameDelete")]
    NameDelete { id: String },
    #[serde(rename = "nameGetRange")]
    NameGetRange {
        id: String,
        #[serde(rename = "nameId")]
        name_id: String,
        #[serde(rename = "orNullObject")]
        or_null_object: bool,
    },
    #[serde(rename = "nameGetWorksheet")]
    NameGetWorksheet {
        id: String,
        #[serde(rename = "nameId")]
        name_id: String,
        #[serde(rename = "orNullObject")]
        or_null_object: bool,
    },
    #[serde(rename = "nameGetArrayValues")]
    NameGetArrayValues {
        id: String,
        #[serde(rename = "nameId")]
        name_id: String,
    },
    #[serde(rename = "worksheetGetItemOrNullObject")]
    WorksheetGetItemOrNullObject { id: String, key: String },
    #[serde(rename = "worksheetCollectionGetCount")]
    WorksheetCollectionGetCount {
        #[serde(rename = "collectionId")]
        collection_id: String,
        #[serde(rename = "resultId")]
        result_id: String,
        #[serde(rename = "visibleOnly")]
        visible_only: bool,
    },
    #[serde(rename = "worksheetCollectionGetFirst")]
    WorksheetCollectionGetFirst {
        #[serde(rename = "collectionId")]
        collection_id: String,
        id: String,
        #[serde(rename = "visibleOnly")]
        visible_only: bool,
        #[serde(rename = "orNull")]
        or_null: bool,
    },
    #[serde(rename = "worksheetCollectionGetLast")]
    WorksheetCollectionGetLast {
        #[serde(rename = "collectionId")]
        collection_id: String,
        id: String,
        #[serde(rename = "visibleOnly")]
        visible_only: bool,
        #[serde(rename = "orNull")]
        or_null: bool,
    },
    #[serde(rename = "worksheetActivate")]
    WorksheetActivate { id: String },
    #[serde(rename = "worksheetDelete")]
    WorksheetDelete { id: String },
    #[serde(rename = "worksheetGetNext")]
    WorksheetGetNext {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        #[serde(rename = "visibleOnly")]
        visible_only: bool,
        #[serde(rename = "orNull")]
        or_null: bool,
    },
    #[serde(rename = "worksheetGetPrevious")]
    WorksheetGetPrevious {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        #[serde(rename = "visibleOnly")]
        visible_only: bool,
        #[serde(rename = "orNull")]
        or_null: bool,
    },
    #[serde(rename = "getRange")]
    GetRange {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        address: Option<String>,
    },
    #[serde(rename = "rangeNavigation")]
    RangeNavigation {
        id: String,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
        method: String,
        #[serde(default)]
        args: Vec<Value>,
    },
    #[serde(rename = "getRangeFormat")]
    GetRangeFormat {
        id: String,
        #[serde(rename = "rangeId")]
        range_id: String,
        kind: String,
    },
    #[serde(rename = "getRangeBorderCollection")]
    GetRangeBorderCollection {
        id: String,
        #[serde(rename = "rangeId")]
        range_id: String,
    },
    #[serde(rename = "getRangeBorder")]
    GetRangeBorder {
        id: String,
        #[serde(rename = "collectionId")]
        collection_id: String,
        index: String,
    },
    #[serde(rename = "getRangeDataValidation")]
    GetRangeDataValidation {
        id: String,
        #[serde(rename = "rangeId")]
        range_id: String,
    },
    #[serde(rename = "rangeClear")]
    RangeClear {
        id: String,
        #[serde(rename = "applyTo")]
        apply_to: String,
    },
    #[serde(rename = "rangeSort")]
    RangeSort {
        #[serde(rename = "rangeId")]
        range_id: String,
        fields: Value,
        #[serde(rename = "matchCase")]
        match_case: Option<bool>,
        #[serde(rename = "hasHeaders")]
        has_headers: Option<bool>,
        orientation: Option<String>,
        method: Option<String>,
    },
    #[serde(rename = "getAutoFilter")]
    GetAutoFilter {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
    },
    #[serde(rename = "autoFilterApply")]
    AutoFilterApply {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        address: Option<String>,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
        #[serde(rename = "columnIndex")]
        column_index: Option<i64>,
        criteria: Option<Value>,
    },
    #[serde(rename = "autoFilterClearColumnCriteria")]
    AutoFilterClearColumnCriteria {
        id: String,
        #[serde(rename = "columnIndex")]
        column_index: i64,
    },
    #[serde(rename = "autoFilterClearCriteria")]
    AutoFilterClearCriteria { id: String },
    #[serde(rename = "autoFilterGetRange")]
    AutoFilterGetRange {
        id: String,
        #[serde(rename = "autoFilterId")]
        auto_filter_id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        #[serde(rename = "nullObject")]
        null_object: bool,
    },
    #[serde(rename = "autoFilterReapply")]
    AutoFilterReapply { id: String },
    #[serde(rename = "autoFilterRemove")]
    AutoFilterRemove { id: String },
    #[serde(rename = "tableAdd")]
    TableAdd {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
        #[serde(rename = "hasHeaders")]
        has_headers: bool,
        address: Option<String>,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
    },
    #[serde(rename = "getTableCollection")]
    GetTableCollection {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
    },
    #[serde(rename = "tableGetItem")]
    TableGetItem {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: Option<String>,
        #[serde(rename = "collectionId")]
        collection_id: Option<String>,
        key: String,
        #[serde(rename = "orNullObject", default)]
        or_null_object: bool,
        #[serde(rename = "byIndex", default)]
        by_index: bool,
    },
    #[serde(rename = "tableGetRange")]
    TableGetRange {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        kind: String,
    },
    #[serde(rename = "tableDelete")]
    TableDelete { id: String },
    #[serde(rename = "tableConvertToRange")]
    TableConvertToRange {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
    },
    #[serde(rename = "tableResize")]
    TableResize {
        #[serde(rename = "tableId")]
        table_id: String,
        address: Option<String>,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
    },
    #[serde(rename = "tableCollectionGet")]
    TableCollectionGet {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        kind: String,
    },
    #[serde(rename = "tableCollectionGetCount")]
    TableCollectionGetCount {
        #[serde(rename = "collectionId")]
        collection_id: String,
        #[serde(rename = "resultId")]
        result_id: String,
    },
    #[serde(rename = "tableColumnGetItem")]
    TableColumnGetItem {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        key: Value,
        #[serde(rename = "orNullObject", default)]
        or_null_object: bool,
        #[serde(rename = "byIndex", default)]
        by_index: bool,
    },
    #[serde(rename = "tableRowGetItem")]
    TableRowGetItem {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        index: i64,
    },
    #[serde(rename = "tableColumnAdd")]
    TableColumnAdd {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        index: Option<i64>,
        values: Option<Value>,
        name: Option<Value>,
    },
    #[serde(rename = "tableRowAdd")]
    TableRowAdd {
        id: String,
        #[serde(rename = "tableId")]
        table_id: String,
        index: Option<i64>,
        values: Option<Value>,
        #[serde(rename = "alwaysInsert")]
        always_insert: Option<bool>,
    },
    #[serde(rename = "tableColumnDelete")]
    TableColumnDelete { id: String },
    #[serde(rename = "tableRowDelete")]
    TableRowDelete { id: String },
    #[serde(rename = "tableRowDeleteMany")]
    TableRowDeleteMany {
        #[serde(rename = "tableId")]
        table_id: String,
        rows: Vec<Value>,
    },
    #[serde(rename = "tableRowDeleteAt")]
    TableRowDeleteAt {
        #[serde(rename = "tableId")]
        table_id: String,
        index: i64,
        count: i64,
    },
    #[serde(rename = "tableColumnGetRange")]
    TableColumnGetRange {
        id: String,
        #[serde(rename = "columnId")]
        column_id: String,
        kind: String,
    },
    #[serde(rename = "tableRowGetRange")]
    TableRowGetRange {
        id: String,
        #[serde(rename = "rowId")]
        row_id: String,
    },
    #[serde(rename = "set")]
    Set {
        id: String,
        property: String,
        value: Value,
    },
    #[serde(rename = "load")]
    Load { id: String, properties: Vec<String> },
}

#[derive(Debug, Serialize)]
pub(crate) struct BatchError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
struct BatchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BatchError>,
    #[serde(default)]
    loaded: HashMap<String, HashMap<String, Value>>,
    #[serde(default)]
    results: HashMap<String, Value>,
}

#[derive(Clone)]
pub(crate) struct RangeRef {
    sheet: Sheet,
    address: Option<String>,
    is_null_object: bool,
}

impl RangeRef {
    /// Construct a Range proxy produced by an extension-family operation.
    ///
    /// Core `getRange` operations still initialize this struct inline because
    /// they own the request-path address validation.  Result-producing
    /// families (for example search and used-range) need a narrow constructor
    /// so they can bind a validated engine address without duplicating the
    /// host's private fields.
    pub(crate) fn new(sheet: Sheet, address: Option<String>, is_null_object: bool) -> Self {
        Self {
            sheet,
            address,
            is_null_object,
        }
    }

    /// Return the underlying sheet for a family adapter that needs to reuse
    /// the compute-api range primitives.
    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    /// Return the optional unqualified A1 address.  `None` represents the
    /// whole worksheet or another unbounded range.
    pub(crate) fn address(&self) -> Option<&str> {
        self.address.as_deref()
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.is_null_object
    }
}

#[derive(Clone)]
struct TableCollectionRef {
    table: TableRef,
    kind: TableCollectionKind,
}

pub(crate) struct Host {
    workbook: Workbook,
    sheets: Mutex<HashMap<String, WorksheetRef>>,
    worksheet_collections: Mutex<HashSet<String>>,
    null_worksheets: Mutex<HashSet<String>>,
    ranges: Mutex<HashMap<String, RangeRef>>,
    formats: Mutex<HashMap<String, FormatRef>>,
    tables: Mutex<HashMap<String, TableRef>>,
    null_tables: Mutex<HashSet<String>>,
    table_collection_bindings: Mutex<HashMap<String, Option<Sheet>>>,
    auto_filters: Mutex<HashMap<String, AutoFilterRef>>,
    validations: Mutex<HashMap<String, ValidationRef>>,
    border_collections: Mutex<HashMap<String, BorderCollectionRef>>,
    borders: Mutex<HashMap<String, BorderRef>>,
    table_collections: Mutex<HashMap<String, TableCollectionRef>>,
    table_columns: Mutex<HashMap<String, TableColumnRef>>,
    null_table_columns: Mutex<HashSet<String>>,
    table_rows: Mutex<HashMap<String, TableRowRef>>,
    name_collections: Mutex<HashMap<String, NamedItemCollectionRef>>,
    names: Mutex<HashMap<String, NamedItemRef>>,
    name_array_values: Mutex<HashMap<String, names::NamedItemArrayValuesRef>>,
    extension_bindings: Mutex<HashMap<String, ExtensionBinding>>,
    extensions: ExtensionRegistry,
    stdout: Mutex<String>,
}

struct ExtensionDispatch {
    handled: bool,
    delegated_load: Option<(String, Vec<String>)>,
}

impl Host {
    pub(crate) fn new(workbook: Workbook) -> Self {
        Self::with_extensions(workbook, ExtensionRegistry::default())
    }

    /// Construct a host with a preassembled family registry.  Runtime setup
    /// can use this when all family modules are known up front; callers may
    /// also use [`Host::register_extension`] for incremental assembly before
    /// the first sync.
    pub(crate) fn with_extensions(workbook: Workbook, extensions: ExtensionRegistry) -> Self {
        Self {
            workbook,
            sheets: Mutex::new(HashMap::new()),
            worksheet_collections: Mutex::new(HashSet::new()),
            null_worksheets: Mutex::new(HashSet::new()),
            ranges: Mutex::new(HashMap::new()),
            formats: Mutex::new(HashMap::new()),
            tables: Mutex::new(HashMap::new()),
            null_tables: Mutex::new(HashSet::new()),
            table_collection_bindings: Mutex::new(HashMap::new()),
            auto_filters: Mutex::new(HashMap::new()),
            validations: Mutex::new(HashMap::new()),
            border_collections: Mutex::new(HashMap::new()),
            borders: Mutex::new(HashMap::new()),
            table_collections: Mutex::new(HashMap::new()),
            table_columns: Mutex::new(HashMap::new()),
            null_table_columns: Mutex::new(HashSet::new()),
            table_rows: Mutex::new(HashMap::new()),
            name_collections: Mutex::new(HashMap::new()),
            names: Mutex::new(HashMap::new()),
            name_array_values: Mutex::new(HashMap::new()),
            extension_bindings: Mutex::new(HashMap::new()),
            extensions,
            stdout: Mutex::new(String::new()),
        }
    }

    /// Register a family handler before evaluating a script.  Registration
    /// is intentionally separate from the core `Op` enum so independent
    /// object families can be added in their own modules.
    pub(crate) fn register_extension<H>(&self, handler: H)
    where
        H: ExtensionHandler + 'static,
    {
        self.extensions.register(handler);
    }

    pub(crate) fn workbook(&self) -> Workbook {
        self.workbook.clone()
    }

    pub(crate) fn lookup_worksheet(&self, id: &str) -> Result<WorksheetRef, BatchError> {
        self.sheets
            .lock()
            .expect("sheets lock")
            .get(id)
            .cloned()
            .ok_or_else(|| BatchError {
                code: "InvalidObjectPath",
                message: "The worksheet object is not available.".to_string(),
            })
    }

    pub(crate) fn lookup_range(&self, id: &str) -> Result<RangeRef, BatchError> {
        self.ranges
            .lock()
            .expect("ranges lock")
            .get(id)
            .cloned()
            .ok_or_else(|| BatchError {
                code: "InvalidObjectPath",
                message: "The range object is not available.".to_string(),
            })
    }

    pub(crate) fn lookup_format(&self, id: &str) -> Result<FormatRef, BatchError> {
        self.formats
            .lock()
            .expect("formats lock")
            .get(id)
            .cloned()
            .ok_or_else(|| BatchError {
                code: "InvalidObjectPath",
                message: "The RangeFormat object is not available.".to_string(),
            })
    }

    pub(crate) fn bind_worksheet(&self, id: &str, worksheet: WorksheetRef) {
        self.sheets
            .lock()
            .expect("sheets lock")
            .insert(id.to_string(), worksheet);
    }

    pub(crate) fn bind_range(&self, id: &str, range: RangeRef) {
        self.ranges
            .lock()
            .expect("ranges lock")
            .insert(id.to_string(), range);
    }

    pub(crate) fn bind_extension_object(&self, id: &str, binding: ExtensionBinding) {
        self.extension_bindings
            .lock()
            .expect("extension bindings lock")
            .insert(id.to_string(), binding);
    }

    pub(crate) fn extension_binding(&self, id: &str) -> Option<ExtensionBinding> {
        self.extension_bindings
            .lock()
            .expect("extension bindings lock")
            .get(id)
            .cloned()
    }

    fn dispatch_extension(
        &self,
        operation: &Value,
        loaded: &mut HashMap<String, HashMap<String, Value>>,
        results: &mut HashMap<String, Value>,
    ) -> Result<ExtensionDispatch, BatchError> {
        let mut context = HostDispatchContext::new(self, loaded, results);
        let handled = self.extensions.dispatch(operation, &mut context)?;
        Ok(ExtensionDispatch {
            handled,
            delegated_load: context.take_delegated_load(),
        })
    }

    fn set_extension_property(
        &self,
        id: &str,
        property: &str,
        value: &Value,
    ) -> Result<bool, BatchError> {
        let Some(binding) = self.extension_binding(id) else {
            return Ok(false);
        };
        binding.set(property, value)?;
        Ok(true)
    }

    pub(crate) fn log(&self, line: &str) {
        let mut stdout = self.stdout.lock().expect("stdout lock");
        if !stdout.is_empty() {
            stdout.push('\n');
        }
        stdout.push_str(line);
        println!("{line}");
    }

    pub(crate) fn take_stdout(&self) -> String {
        self.stdout.lock().expect("stdout lock").clone()
    }

    pub(crate) fn apply_json(&self, raw: &str) -> String {
        match self.apply_ops(raw) {
            Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| {
                json!({
                    "error": { "code": "GeneralException", "message": "failed to encode sync result" }
                })
                .to_string()
            }),
            Err(err) => serde_json::to_string(&BatchResult {
                error: Some(err),
                loaded: HashMap::new(),
                results: HashMap::new(),
            })
            .expect("batch error encodes"),
        }
    }

    fn apply_ops(&self, raw: &str) -> Result<BatchResult, BatchError> {
        // Decode the outer batch as raw values so extension families can own
        // additional operation names without editing the core `Op` enum.
        // Known operations still take the exact typed path below.
        let ops: Vec<Value> = serde_json::from_str(raw).map_err(|e| BatchError {
            code: "InvalidArgument",
            message: format!("invalid Office.js batch: {e}"),
        })?;

        // Every context.sync() brackets all operation families, including extension
        // mutations. Empty/read-only groups leave history and redo untouched.
        // One mutating sync is one user action. Nesting lets callers
        // combine several syncs with an explicit WorkbookHistory group.
        let history = self.workbook.history();
        history.begin_undo_group().map_err(engine_error)?;
        let result = self.apply_batch(ops);
        let end_result = history.end_undo_group().map_err(engine_error);

        // A failed batch retains its successful prefix. Close the group even
        // on that path, and preserve the original operation's error.
        match result {
            Ok(batch) => {
                end_result?;
                Ok(batch)
            }
            Err(error) => Err(error),
        }
    }

    fn apply_batch(&self, ops: Vec<Value>) -> Result<BatchResult, BatchError> {
        let mut loaded = HashMap::new();
        let mut results = HashMap::new();
        for raw_op in ops {
            // Give extension handlers first refusal for both new operation
            // names and property additions to existing core objects.  A
            // handler can return `false` to preserve the core path below.
            let dispatch = self.dispatch_extension(&raw_op, &mut loaded, &mut results)?;
            let has_delegated_load = dispatch.delegated_load.is_some();
            let raw_op = if let Some((target_id, properties)) = dispatch.delegated_load {
                let operation_id =
                    raw_op
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| BatchError {
                            code: "InvalidArgument",
                            message: "A delegated load operation requires an id.".to_string(),
                        })?;
                if operation_id != target_id {
                    return Err(BatchError {
                        code: "InvalidArgument",
                        message: "A delegated load handler changed the load target.".to_string(),
                    });
                }
                let mut delegated = raw_op;
                delegated["properties"] =
                    Value::Array(properties.into_iter().map(Value::String).collect());
                delegated
            } else {
                raw_op
            };
            if dispatch.handled && !has_delegated_load {
                continue;
            }
            let op = match serde_json::from_value::<Op>(raw_op.clone()) {
                Ok(op) => op,
                Err(error) => {
                    return Err(BatchError {
                        code: "InvalidArgument",
                        message: format!("invalid Office.js operation: {error}"),
                    });
                }
            };
            match op {
                Op::GetItem { id, name } => {
                    let worksheet =
                        worksheets::get_item(&self.workbook, &name).map_err(worksheet_error)?;
                    self.sheets
                        .lock()
                        .expect("sheets lock")
                        .insert(id.clone(), worksheet);
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetWorksheetCollection { id } => {
                    self.worksheet_collections
                        .lock()
                        .expect("worksheet collections lock")
                        .insert(id.clone());
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetActiveWorksheet { id } => {
                    let worksheet = worksheets::active(&self.workbook).map_err(worksheet_error)?;
                    self.sheets
                        .lock()
                        .expect("sheets lock")
                        .insert(id.clone(), worksheet);
                    mark_object(&mut loaded, &id, false);
                }
                Op::AddWorksheet { id, name } => {
                    let name = match name {
                        Some(n) if !n.is_empty() => n,
                        _ => unique_sheet_name(&self.workbook)?,
                    };
                    self.workbook
                        .sheets()
                        .create_sheet(&name)
                        .map_err(engine_error)?;
                    let sheet = self.workbook.sheet_by_name(&name).map_err(engine_error)?;
                    self.sheets
                        .lock()
                        .expect("sheets lock")
                        .insert(id.clone(), WorksheetRef::new(self.workbook.clone(), sheet));
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetNamedItemCollection { id, worksheet_id } => {
                    let collection = name_collection_for_scope(self, worksheet_id.as_deref())?;
                    self.name_collections
                        .lock()
                        .expect("name collections lock")
                        .insert(id.clone(), collection);
                    mark_object(&mut loaded, &id, false);
                }
                Op::NameAdd {
                    id,
                    worksheet_id,
                    name,
                    comment,
                    formula_local,
                    reference,
                    range_id,
                } => {
                    let collection = name_collection_for_scope(self, worksheet_id.as_deref())?;
                    let item = match (reference, range_id) {
                        (Some(reference), None) => collection
                            .add(&name, &reference, formula_local, comment)
                            .map_err(name_error)?,
                        (None, Some(range_id)) => {
                            let range = self
                                .ranges
                                .lock()
                                .expect("ranges lock")
                                .get(&range_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The named-item Range object is not available."
                                        .to_string(),
                                })?;
                            if range_has_unbounded_dimension(&range)? {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message: "NamedItemCollection.add requires a bounded Range."
                                        .to_string(),
                                });
                            }
                            collection
                                .add_range(
                                    &name,
                                    &range.sheet,
                                    range.address.as_deref().expect("bounded address"),
                                    comment,
                                )
                                .map_err(name_error)?
                        }
                        _ => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "NamedItemCollection.add requires exactly one reference or Range."
                                    .to_string(),
                            });
                        }
                    };
                    self.names
                        .lock()
                        .expect("names lock")
                        .insert(id.clone(), item);
                    mark_object(&mut loaded, &id, false);
                }
                Op::NameGetCount {
                    result_id,
                    worksheet_id,
                } => {
                    let collection = name_collection_for_scope(self, worksheet_id.as_deref())?;
                    results.insert(result_id, json!(collection.count().map_err(name_error)?));
                }
                Op::NameGetItem {
                    id,
                    worksheet_id,
                    name,
                    or_null_object,
                } => {
                    let collection = name_collection_for_scope(self, worksheet_id.as_deref())?;
                    let item = if or_null_object {
                        collection
                            .get_item_or_null_object(&name)
                            .map_err(name_error)?
                    } else {
                        collection.get_item(&name).map_err(name_error)?
                    };
                    let is_null = item.is_null_object();
                    self.names
                        .lock()
                        .expect("names lock")
                        .insert(id.clone(), item);
                    mark_object(&mut loaded, &id, is_null);
                }
                Op::NameDelete { id } => {
                    name_ref(&self.names, &id)?.delete().map_err(name_error)?;
                }
                Op::NameGetRange {
                    id,
                    name_id,
                    or_null_object,
                } => {
                    let item = name_ref(&self.names, &name_id)?;
                    let target = item.range().map_err(name_error)?;
                    if target.is_none() && !or_null_object {
                        return Err(BatchError {
                            code: "InvalidReference",
                            message: "The named item does not refer to a range.".to_string(),
                        });
                    }
                    let (sheet, address, is_null_object) = match target {
                        Some(target) => (target.sheet(), Some(target.address().to_string()), false),
                        None => (
                            self.workbook.sheet_by_index(0).map_err(engine_error)?,
                            None,
                            true,
                        ),
                    };
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet,
                            address,
                            is_null_object,
                        },
                    );
                    mark_object(&mut loaded, &id, is_null_object);
                }
                Op::NameGetWorksheet {
                    id,
                    name_id,
                    or_null_object,
                } => {
                    let item = name_ref(&self.names, &name_id)?;
                    let worksheet = item.worksheet().map_err(name_error)?;
                    if worksheet.is_none() && !or_null_object {
                        return Err(BatchError {
                            code: "InvalidReference",
                            message: "The named item does not have a worksheet scope.".to_string(),
                        });
                    }
                    let worksheet =
                        worksheet.map(|sheet| WorksheetRef::new(self.workbook.clone(), sheet));
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, or_null_object);
                }
                Op::NameGetArrayValues { id, name_id } => {
                    let item = name_ref(&self.names, &name_id)?;
                    let values = item.array_values_ref();
                    self.name_array_values
                        .lock()
                        .expect("named item array values lock")
                        .insert(id.clone(), values);
                    mark_object(&mut loaded, &id, false);
                }
                Op::WorksheetGetItemOrNullObject { id, key } => {
                    let worksheet = worksheets::get_item_or_null(&self.workbook, &key)
                        .map_err(worksheet_error)?;
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, true);
                }
                Op::WorksheetCollectionGetCount {
                    collection_id,
                    result_id,
                    visible_only,
                } => {
                    require_worksheet_collection(self, &collection_id)?;
                    let count = worksheets::ordered(self.workbook.clone(), visible_only)
                        .map_err(worksheet_error)?
                        .len();
                    results.insert(result_id, json!(count));
                }
                Op::WorksheetCollectionGetFirst {
                    collection_id,
                    id,
                    visible_only,
                    or_null,
                } => {
                    require_worksheet_collection(self, &collection_id)?;
                    let worksheet = worksheets::ordered(self.workbook.clone(), visible_only)
                        .map_err(worksheet_error)?
                        .into_iter()
                        .next();
                    if worksheet.is_none() && !or_null {
                        return Err(BatchError {
                            code: "ItemNotFound",
                            message: "The worksheet collection is empty.".to_string(),
                        });
                    }
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, or_null);
                }
                Op::WorksheetCollectionGetLast {
                    collection_id,
                    id,
                    visible_only,
                    or_null,
                } => {
                    require_worksheet_collection(self, &collection_id)?;
                    let worksheet = worksheets::ordered(self.workbook.clone(), visible_only)
                        .map_err(worksheet_error)?;
                    let worksheet = worksheet.into_iter().last();
                    if worksheet.is_none() && !or_null {
                        return Err(BatchError {
                            code: "ItemNotFound",
                            message: "The worksheet collection is empty.".to_string(),
                        });
                    }
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, or_null);
                }
                Op::WorksheetActivate { id } => {
                    worksheet_ref(&self.sheets, &id)?
                        .activate()
                        .map_err(worksheet_error)?;
                }
                Op::WorksheetDelete { id } => {
                    worksheet_ref(&self.sheets, &id)?
                        .delete()
                        .map_err(worksheet_error)?;
                }
                Op::WorksheetGetNext {
                    id,
                    worksheet_id,
                    visible_only,
                    or_null,
                } => {
                    let worksheet = worksheet_ref(&self.sheets, &worksheet_id)?
                        .next(visible_only)
                        .map_err(worksheet_error)?;
                    if worksheet.is_none() && !or_null {
                        return Err(BatchError {
                            code: "ItemNotFound",
                            message: "There is no next worksheet.".to_string(),
                        });
                    }
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, or_null);
                }
                Op::WorksheetGetPrevious {
                    id,
                    worksheet_id,
                    visible_only,
                    or_null,
                } => {
                    let worksheet = worksheet_ref(&self.sheets, &worksheet_id)?
                        .previous(visible_only)
                        .map_err(worksheet_error)?;
                    if worksheet.is_none() && !or_null {
                        return Err(BatchError {
                            code: "ItemNotFound",
                            message: "There is no previous worksheet.".to_string(),
                        });
                    }
                    bind_nullable_worksheet(self, &mut loaded, id, worksheet, or_null);
                }
                Op::GetRange {
                    id,
                    worksheet_id,
                    address,
                } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?
                        .sheet();
                    // An omitted address represents the whole worksheet. Its
                    // cell-level properties are unbounded: reads return null
                    // and writes are rejected. Validate bounded addresses now
                    // so the failure occurs at context.sync().
                    if let Some(address) = address.as_deref() {
                        parse_range_address(&sheet, address).map_err(range_navigation_error)?;
                    }
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet,
                            address,
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::RangeNavigation {
                    id,
                    range_id,
                    worksheet_id,
                    method,
                    mut args,
                } => {
                    let (sheet, address) = match (range_id, worksheet_id) {
                        (Some(range_id), None) => {
                            let range = self
                                .ranges
                                .lock()
                                .expect("ranges lock")
                                .get(&range_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The source range object is not available."
                                        .to_string(),
                                })?;
                            parsed_range(&range)?;
                            (range.sheet, range.address)
                        }
                        (None, Some(worksheet_id)) => {
                            let sheet = self
                                .sheets
                                .lock()
                                .expect("sheets lock")
                                .get(&worksheet_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The worksheet object is not available.".to_string(),
                                })?
                                .sheet();
                            (sheet, None)
                        }
                        _ => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "Range navigation requires exactly one source Range or Worksheet."
                                    .to_string(),
                            });
                        }
                    };

                    for argument in &mut args {
                        let range_id = argument
                            .as_object()
                            .and_then(|object| object.get("rangeId"))
                            .and_then(Value::as_str);
                        let Some(range_id) = range_id else {
                            continue;
                        };
                        let argument_range = self
                            .ranges
                            .lock()
                            .expect("ranges lock")
                            .get(range_id)
                            .cloned()
                            .ok_or_else(|| BatchError {
                                code: "InvalidObjectPath",
                                message: "The range argument object is not available.".to_string(),
                            })?;
                        if argument_range.sheet.id() != sheet.id() {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "Range arguments must belong to the same worksheet."
                                    .to_string(),
                            });
                        }
                        let address = range_metadata(&argument_range)?.address;
                        *argument = json!({ "address": address });
                    }

                    let result = navigate_range(sheet, address.as_deref(), &method, &args)
                        .map_err(range_navigation_error)?;
                    let address = if result.address.is_whole_sheet() {
                        None
                    } else {
                        Some(result.address.to_a1())
                    };
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet: result.sheet,
                            address,
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetRangeFormat { id, range_id, kind } => {
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&range_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: "Range formatting requires a bounded range.".to_string(),
                        });
                    }
                    let address = range.address.ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "Range formatting cannot be used on an unbounded worksheet range"
                            .to_string(),
                    })?;
                    let format =
                        FormatRef::new(range.sheet, address, &kind).map_err(format_error)?;
                    self.formats
                        .lock()
                        .expect("formats lock")
                        .insert(id.clone(), format);
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetRangeBorderCollection { id, range_id } => {
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&range_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: "RangeFormat.borders requires a bounded range.".to_string(),
                        });
                    }
                    let address = range.address.ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "RangeFormat.borders requires a bounded range.".to_string(),
                    })?;
                    let collection =
                        BorderCollectionRef::new(range.sheet, address).map_err(border_error)?;
                    self.border_collections
                        .lock()
                        .expect("border collections lock")
                        .insert(id.clone(), collection);
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetRangeBorder {
                    id,
                    collection_id,
                    index,
                } => {
                    let collection = self
                        .border_collections
                        .lock()
                        .expect("border collections lock")
                        .get(&collection_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The border collection object is not available.".to_string(),
                        })?;
                    let border = collection.get_item(&index).map_err(border_error)?;
                    self.borders
                        .lock()
                        .expect("borders lock")
                        .insert(id.clone(), border);
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetRangeDataValidation { id, range_id } => {
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&range_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: "Range.dataValidation requires a bounded range.".to_string(),
                        });
                    }
                    let address = range.address.ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "Range.dataValidation requires a bounded range.".to_string(),
                    })?;
                    let validation =
                        ValidationRef::new(range.sheet, address).map_err(validation_error)?;
                    self.validations
                        .lock()
                        .expect("validations lock")
                        .insert(id.clone(), validation);
                    mark_object(&mut loaded, &id, false);
                }
                Op::RangeClear { id, apply_to } => {
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: "Range.clear requires a bounded range.".to_string(),
                        });
                    }
                    let address = range.address.as_deref().ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "Range.clear cannot be used on an unbounded worksheet range"
                            .to_string(),
                    })?;
                    range_content::clear(&range.sheet, address, &apply_to)
                        .map_err(range_content_error)?;
                }
                Op::RangeSort {
                    range_id,
                    fields,
                    match_case,
                    has_headers,
                    orientation,
                    method,
                } => {
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&range_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: "Range.sort requires a bounded range.".to_string(),
                        });
                    }
                    let address = range.address.as_deref().ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "Range.sort cannot be used on an unbounded or null range."
                            .to_string(),
                    })?;
                    apply_range_sort(
                        &range.sheet,
                        address,
                        RangeSortRequest {
                            fields,
                            match_case,
                            has_headers,
                            orientation,
                            method,
                        },
                    )
                    .map_err(sort_filter_error)?;
                }
                Op::GetAutoFilter { id, worksheet_id } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?
                        .sheet();
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id.clone(), AutoFilterRef::new(sheet));
                    mark_object(&mut loaded, &id, false);
                }
                Op::AutoFilterApply {
                    id,
                    worksheet_id,
                    address,
                    range_id,
                    column_index,
                    criteria,
                } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?
                        .sheet();
                    let address = match (address, range_id) {
                        (Some(address), None) => address,
                        (None, Some(range_id)) => {
                            let range = self
                                .ranges
                                .lock()
                                .expect("ranges lock")
                                .get(&range_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The AutoFilter range object is not available."
                                        .to_string(),
                                })?;
                            if range.sheet.id() != sheet.id() {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message: "AutoFilter Range must belong to its worksheet."
                                        .to_string(),
                                });
                            }
                            if range_has_unbounded_dimension(&range)? {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message: "AutoFilter requires a bounded Range.".to_string(),
                                });
                            }
                            range.address.ok_or_else(|| BatchError {
                                code: "InvalidArgument",
                                message: "AutoFilter requires a bounded Range.".to_string(),
                            })?
                        }
                        _ => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "AutoFilter.apply requires exactly one address or Range."
                                    .to_string(),
                            });
                        }
                    };
                    let mut auto_filter = self
                        .auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .get(&id)
                        .cloned()
                        .unwrap_or_else(|| AutoFilterRef::new(sheet));
                    auto_filter
                        .apply(AutoFilterApplyRequest {
                            range: address,
                            column_index,
                            criteria,
                        })
                        .map_err(sort_filter_error)?;
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id, auto_filter);
                }
                Op::AutoFilterClearColumnCriteria { id, column_index } => {
                    let mut auto_filter = auto_filter_ref(&self.auto_filters, &id)?;
                    auto_filter
                        .clear_column_criteria(column_index)
                        .map_err(sort_filter_error)?;
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id, auto_filter);
                }
                Op::AutoFilterClearCriteria { id } => {
                    let mut auto_filter = auto_filter_ref(&self.auto_filters, &id)?;
                    auto_filter.clear_criteria().map_err(sort_filter_error)?;
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id, auto_filter);
                }
                Op::AutoFilterGetRange {
                    id,
                    auto_filter_id,
                    worksheet_id,
                    null_object,
                } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?
                        .sheet();
                    let auto_filter = auto_filter_ref(&self.auto_filters, &auto_filter_id)?;
                    let address = match auto_filter.range_address() {
                        Ok(address) => Some(address),
                        Err(error) if null_object && error.code == "ItemNotFound" => None,
                        Err(error) => return Err(sort_filter_error(error)),
                    };
                    mark_object(&mut loaded, &id, address.is_none());
                    self.ranges.lock().expect("ranges lock").insert(
                        id,
                        RangeRef {
                            sheet,
                            is_null_object: address.is_none(),
                            address,
                        },
                    );
                }
                Op::AutoFilterReapply { id } => {
                    let mut auto_filter = auto_filter_ref(&self.auto_filters, &id)?;
                    auto_filter.reapply().map_err(sort_filter_error)?;
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id, auto_filter);
                }
                Op::AutoFilterRemove { id } => {
                    let mut auto_filter = auto_filter_ref(&self.auto_filters, &id)?;
                    auto_filter.remove().map_err(sort_filter_error)?;
                    self.auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .insert(id, auto_filter);
                }
                Op::TableAdd {
                    id,
                    worksheet_id,
                    has_headers,
                    address,
                    range_id,
                } => {
                    let range = range_id.as_ref().map(|range_id| {
                        self.ranges
                            .lock()
                            .expect("ranges lock")
                            .get(range_id)
                            .cloned()
                            .ok_or_else(|| BatchError {
                                code: "InvalidObjectPath",
                                message: "The Table.add Range object is not available.".to_string(),
                            })
                    });
                    let range = range.transpose()?;
                    let range_sheet = range.as_ref().map(|range| range.sheet.clone());
                    let worksheet_scope = worksheet_id
                        .as_ref()
                        .map(|worksheet_id| {
                            self.sheets
                                .lock()
                                .expect("sheets lock")
                                .get(worksheet_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The worksheet object is not available.".to_string(),
                                })
                        })
                        .transpose()?;
                    let address = match (address, range) {
                        (Some(address), None) => {
                            let sheet = tables::resolve_table_add_source(
                                &self.workbook,
                                worksheet_scope.map(|worksheet| worksheet.sheet()),
                                range_sheet,
                                &address,
                            )
                            .map_err(table_error)?;
                            (sheet, address)
                        }
                        (None, Some(range)) => {
                            if range_has_unbounded_dimension(&range)? {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message: "Table.add requires a bounded Range.".to_string(),
                                });
                            }
                            let address = range.address.ok_or_else(|| BatchError {
                                code: "InvalidArgument",
                                message: "Table.add requires a bounded Range.".to_string(),
                            })?;
                            let sheet = worksheet_scope
                                .map(|worksheet| worksheet.sheet())
                                .unwrap_or_else(|| range.sheet.clone());
                            if sheet.id() != range.sheet.id() {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message:
                                        "Table.add Range must belong to its worksheet collection."
                                            .to_string(),
                                });
                            }
                            parse_range_address(&sheet, &address)
                                .map_err(range_navigation_error)?;
                            (sheet, address)
                        }
                        _ => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "Table.add requires exactly one address or Range."
                                    .to_string(),
                            });
                        }
                    };
                    let table = TableRef::add(&self.workbook, address.0, &address.1, has_headers)
                        .map_err(table_error)?;
                    self.tables
                        .lock()
                        .expect("tables lock")
                        .insert(id.clone(), table);
                    mark_object(&mut loaded, &id, false);
                }
                Op::GetTableCollection { id, worksheet_id } => {
                    let sheet = match worksheet_id {
                        Some(worksheet_id) => Some(
                            self.sheets
                                .lock()
                                .expect("sheets lock")
                                .get(&worksheet_id)
                                .cloned()
                                .ok_or_else(|| BatchError {
                                    code: "InvalidObjectPath",
                                    message: "The worksheet object is not available.".to_string(),
                                })?
                                .sheet(),
                        ),
                        None => None,
                    };
                    self.table_collection_bindings
                        .lock()
                        .expect("table collection bindings lock")
                        .insert(id.clone(), sheet);
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableGetItem {
                    id,
                    worksheet_id,
                    collection_id,
                    key,
                    or_null_object,
                    by_index,
                } => {
                    let table = if let Some(collection_id) = collection_id {
                        let scope = self
                            .table_collection_bindings
                            .lock()
                            .expect("table collection bindings lock")
                            .get(&collection_id)
                            .cloned()
                            .ok_or_else(|| BatchError {
                                code: "InvalidObjectPath",
                                message: "The TableCollection object is not available.".to_string(),
                            })?;
                        match (scope, by_index) {
                            (Some(sheet), false) => TableRef::get_item(sheet, &key),
                            (Some(sheet), true) => key
                                .parse::<i64>()
                                .map_err(|_| table_error_invalid_index("table"))
                                .and_then(|index| TableRef::get_item_at(sheet, index)),
                            (None, false) => TableRef::get_item_in_workbook(&self.workbook, &key),
                            (None, true) => key
                                .parse::<i64>()
                                .map_err(|_| table_error_invalid_index("table"))
                                .and_then(|index| {
                                    TableRef::get_item_at_in_workbook(&self.workbook, index)
                                }),
                        }
                    } else {
                        let worksheet_id = worksheet_id.ok_or_else(|| BatchError {
                            code: "InvalidArgument",
                            message: "Table.getItem requires a worksheet or collection scope."
                                .to_string(),
                        })?;
                        let sheet = self
                            .sheets
                            .lock()
                            .expect("sheets lock")
                            .get(&worksheet_id)
                            .cloned()
                            .ok_or_else(|| BatchError {
                                code: "InvalidObjectPath",
                                message: "The worksheet object is not available.".to_string(),
                            })?
                            .sheet();
                        if by_index {
                            key.parse::<i64>()
                                .map_err(|_| table_error_invalid_index("table"))
                                .and_then(|index| TableRef::get_item_at(sheet, index))
                        } else {
                            TableRef::get_item(sheet, &key)
                        }
                    };
                    match table {
                        Ok(table) => {
                            self.tables
                                .lock()
                                .expect("tables lock")
                                .insert(id.clone(), table);
                            self.null_tables
                                .lock()
                                .expect("null tables lock")
                                .remove(&id);
                            mark_object(&mut loaded, &id, false);
                        }
                        Err(error) if or_null_object && error.code == "ItemNotFound" => {
                            self.null_tables
                                .lock()
                                .expect("null tables lock")
                                .insert(id.clone());
                            mark_object(&mut loaded, &id, true);
                        }
                        Err(error) => return Err(table_error(error)),
                    }
                }
                Op::TableGetRange { id, table_id, kind } => {
                    let table = self
                        .tables
                        .lock()
                        .expect("tables lock")
                        .get(&table_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The table object is not available.".to_string(),
                        })?;
                    let kind = TableRangeKind::from_wire(&kind).map_err(table_error)?;
                    let address = table.range_address(kind).map_err(table_error)?;
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet: table.sheet(),
                            address: Some(address),
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableDelete { id } => {
                    let table = table_ref(&self.tables, &id)?;
                    table.delete().map_err(table_error)?;
                    self.tables.lock().expect("tables lock").remove(&id);
                }
                Op::TableConvertToRange { id, table_id } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let address = table.convert_to_range().map_err(table_error)?;
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet: table.sheet(),
                            address: Some(address),
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableResize {
                    table_id,
                    address,
                    range_id,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let address = match (address, range_id) {
                        (Some(address), None) => address,
                        (None, Some(range_id)) => {
                            let range = self.lookup_range(&range_id)?;
                            if range_has_unbounded_dimension(&range)? {
                                return Err(BatchError {
                                    code: "InvalidArgument",
                                    message: "Table.resize requires a bounded Range.".to_string(),
                                });
                            }
                            range.address.ok_or_else(|| BatchError {
                                code: "InvalidArgument",
                                message: "Table.resize requires a bounded Range.".to_string(),
                            })?
                        }
                        _ => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "Table.resize requires exactly one address or Range."
                                    .to_string(),
                            });
                        }
                    };
                    table.resize(&address).map_err(table_error)?;
                }
                Op::TableCollectionGet { id, table_id, kind } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let kind =
                        TableCollectionKind::from_wire(&kind).map_err(table_collection_error)?;
                    self.table_collections
                        .lock()
                        .expect("table collections lock")
                        .insert(id.clone(), TableCollectionRef { table, kind });
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableCollectionGetCount {
                    collection_id,
                    result_id,
                } => {
                    // `tableCollectionGetCount` is shared by the base
                    // TableCollection (worksheet/workbook scope) and the
                    // child rows/columns collections.  The former is stored
                    // in `table_collection_bindings`, while the latter uses
                    // `table_collections`; check the outer Option so a
                    // workbook binding with a `None` worksheet is still
                    // distinguishable from an unknown object id.
                    if let Some(scope) = self
                        .table_collection_bindings
                        .lock()
                        .expect("table collection bindings lock")
                        .get(&collection_id)
                        .cloned()
                    {
                        let count = tables::collection_items(&self.workbook, scope.as_ref(), &[])
                            .map_err(table_error)?
                            .len();
                        results.insert(result_id, json!(count));
                    } else {
                        let collection =
                            table_collection_ref(&self.table_collections, &collection_id)?;
                        let mut projection = table_collections::load_collection(
                            &collection.table,
                            collection.kind,
                            &["count".to_string()],
                        )
                        .map_err(table_collection_error)?;
                        let count = projection.remove("count").ok_or_else(|| BatchError {
                            code: "GeneralException",
                            message: "The table collection did not return its count.".to_string(),
                        })?;
                        results.insert(result_id, count);
                    }
                }
                Op::TableColumnGetItem {
                    id,
                    table_id,
                    key,
                    or_null_object,
                    by_index,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let column = if by_index {
                        key.as_i64()
                            .ok_or_else(|| BatchError {
                                code: "InvalidArgument",
                                message: "TableColumnCollection.getItemAt requires an integer."
                                    .to_string(),
                            })
                            .and_then(|index| {
                                table_collections::get_column_at(&table, index)
                                    .map_err(table_collection_error)
                            })
                    } else {
                        table_collections::get_column(&table, &key).map_err(table_collection_error)
                    };
                    match column {
                        Ok(column) => {
                            self.table_columns
                                .lock()
                                .expect("table columns lock")
                                .insert(id.clone(), column);
                            mark_object(&mut loaded, &id, false);
                        }
                        Err(error) if or_null_object && error.code == "ItemNotFound" => {
                            self.null_table_columns
                                .lock()
                                .expect("null table columns lock")
                                .insert(id.clone());
                            mark_object(&mut loaded, &id, true);
                        }
                        Err(error) => return Err(error),
                    }
                }
                Op::TableRowGetItem {
                    id,
                    table_id,
                    index,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let row = table_collections::get_row_at(&table, index)
                        .map_err(table_collection_error)?;
                    self.table_rows
                        .lock()
                        .expect("table rows lock")
                        .insert(id.clone(), row);
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableColumnAdd {
                    id,
                    table_id,
                    index,
                    values,
                    name,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let column = table_collections::add_column(
                        &table,
                        index,
                        values.as_ref(),
                        name.as_ref(),
                    )
                    .map_err(table_collection_error)?;
                    self.table_columns
                        .lock()
                        .expect("table columns lock")
                        .insert(id.clone(), column);
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableRowAdd {
                    id,
                    table_id,
                    index,
                    values,
                    always_insert,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let added =
                        table_collections::add_rows(&table, index, values.as_ref(), always_insert)
                            .map_err(table_collection_error)?;
                    let added_index = added.row.index();
                    self.table_rows
                        .lock()
                        .expect("table rows lock")
                        .insert(id.clone(), added.row);
                    mark_object(&mut loaded, &id, false);
                    // `TableRowCollection.add` returns a live row proxy.  Its
                    // positional selector is known only after the engine
                    // applies the insertion (especially for append and
                    // alwaysInsert:false), so hydrate the returned index in
                    // the same sync response.
                    loaded
                        .entry(id)
                        .or_default()
                        .insert("index".to_string(), json!(added_index));
                }
                Op::TableColumnDelete { id } => {
                    table_column_ref(&self.table_columns, &id)?
                        .delete()
                        .map_err(table_collection_error)?;
                }
                Op::TableRowDelete { id } => {
                    table_row_ref(&self.table_rows, &id)?
                        .delete()
                        .map_err(table_collection_error)?;
                }
                Op::TableRowDeleteMany { table_id, rows } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    let indices = rows
                        .iter()
                        .map(|value| {
                            value
                                .as_u64()
                                .and_then(|index| u32::try_from(index).ok())
                                .ok_or_else(|| BatchError {
                                    code: "InvalidArgument",
                                    message: "TableRowCollection.deleteRows requires row indices."
                                        .to_string(),
                                })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    table_collections::delete_rows(&table, &indices)
                        .map_err(table_collection_error)?;
                }
                Op::TableRowDeleteAt {
                    table_id,
                    index,
                    count,
                } => {
                    let table = table_ref(&self.tables, &table_id)?;
                    table_collections::delete_rows_at(&table, index, count)
                        .map_err(table_collection_error)?;
                }
                Op::TableColumnGetRange {
                    id,
                    column_id,
                    kind,
                } => {
                    let column = table_column_ref(&self.table_columns, &column_id)?;
                    let kind =
                        TableColumnRangeKind::from_wire(&kind).map_err(table_collection_error)?;
                    let address = column.range_address(kind).map_err(table_collection_error)?;
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet: column.sheet(),
                            address: Some(address),
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::TableRowGetRange { id, row_id } => {
                    let row = table_row_ref(&self.table_rows, &row_id)?;
                    let address = row.range_address().map_err(table_collection_error)?;
                    self.ranges.lock().expect("ranges lock").insert(
                        id.clone(),
                        RangeRef {
                            sheet: row.sheet(),
                            address: Some(address),
                            is_null_object: false,
                        },
                    );
                    mark_object(&mut loaded, &id, false);
                }
                Op::Set {
                    id,
                    property,
                    value,
                } => {
                    if let Some(worksheet) =
                        self.sheets.lock().expect("sheets lock").get(&id).cloned()
                    {
                        worksheet.set(&property, &value).map_err(worksheet_error)?;
                        continue;
                    }
                    if let Some(border) =
                        self.borders.lock().expect("borders lock").get(&id).cloned()
                    {
                        border.apply_set(&property, &value).map_err(border_error)?;
                        continue;
                    }
                    if let Some(collection) = self
                        .border_collections
                        .lock()
                        .expect("border collections lock")
                        .get(&id)
                        .cloned()
                    {
                        collection.set(&property, &value).map_err(border_error)?;
                        continue;
                    }
                    if let Some(column) = self
                        .table_columns
                        .lock()
                        .expect("table columns lock")
                        .get(&id)
                        .cloned()
                    {
                        column
                            .set(&property, &value)
                            .map_err(table_collection_error)?;
                        continue;
                    }
                    if let Some(row) = self
                        .table_rows
                        .lock()
                        .expect("table rows lock")
                        .get(&id)
                        .cloned()
                    {
                        row.set(&property, &value).map_err(table_collection_error)?;
                        continue;
                    }
                    if let Some(item) = self.names.lock().expect("names lock").get(&id).cloned() {
                        item.set(&property, &value).map_err(name_error)?;
                        continue;
                    }
                    if let Some(format) =
                        self.formats.lock().expect("formats lock").get(&id).cloned()
                    {
                        format.set(&property, &value).map_err(format_error)?;
                        continue;
                    }
                    if let Some(validation) = self
                        .validations
                        .lock()
                        .expect("validations lock")
                        .get(&id)
                        .cloned()
                    {
                        validation
                            .set(&property, &value)
                            .map_err(validation_error)?;
                        continue;
                    }
                    if let Some(table) = self.tables.lock().expect("tables lock").get(&id).cloned()
                    {
                        table.set(&property, &value).map_err(table_error)?;
                        continue;
                    }
                    if self.set_extension_property(&id, &property, &value)? {
                        continue;
                    }
                    let range = self
                        .ranges
                        .lock()
                        .expect("ranges lock")
                        .get(&id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                    if range_has_unbounded_dimension(&range)? {
                        return Err(BatchError {
                            code: "InvalidArgument",
                            message: format!("Range.{property} requires a bounded range"),
                        });
                    }
                    let address = range.address.as_deref().ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: format!(
                            "Range.{property} cannot be set on an unbounded worksheet range"
                        ),
                    })?;
                    if property == "numberFormat" {
                        range_content::set(&range.sheet, address, &property, &value)
                            .map_err(range_content_error)?;
                        continue;
                    }
                    let write_property = WriteProperty::from_name(&property)?;
                    let grid = json_to_write_grid(&value, write_property)?;
                    range
                        .sheet
                        .set_range_typed(address, &grid)
                        .map_err(write_error)?;
                }
                Op::Load { id, properties } => {
                    let sheet = self.sheets.lock().expect("sheets lock").get(&id).cloned();
                    let null_worksheet = self
                        .null_worksheets
                        .lock()
                        .expect("null worksheets lock")
                        .contains(&id);
                    let worksheet_collection = self
                        .worksheet_collections
                        .lock()
                        .expect("worksheet collections lock")
                        .contains(&id);
                    let range = self.ranges.lock().expect("ranges lock").get(&id).cloned();
                    let format = self.formats.lock().expect("formats lock").get(&id).cloned();
                    let table = self.tables.lock().expect("tables lock").get(&id).cloned();
                    let null_table = self
                        .null_tables
                        .lock()
                        .expect("null tables lock")
                        .contains(&id);
                    let table_collection_binding = self
                        .table_collection_bindings
                        .lock()
                        .expect("table collection bindings lock")
                        .get(&id)
                        .cloned();
                    let auto_filter = self
                        .auto_filters
                        .lock()
                        .expect("auto filters lock")
                        .get(&id)
                        .cloned();
                    let validation = self
                        .validations
                        .lock()
                        .expect("validations lock")
                        .get(&id)
                        .cloned();
                    let border_collection = self
                        .border_collections
                        .lock()
                        .expect("border collections lock")
                        .get(&id)
                        .cloned();
                    let border = self.borders.lock().expect("borders lock").get(&id).cloned();
                    let table_collection = self
                        .table_collections
                        .lock()
                        .expect("table collections lock")
                        .get(&id)
                        .cloned();
                    let table_column = self
                        .table_columns
                        .lock()
                        .expect("table columns lock")
                        .get(&id)
                        .cloned();
                    let null_table_column = self
                        .null_table_columns
                        .lock()
                        .expect("null table columns lock")
                        .contains(&id);
                    let table_row = self
                        .table_rows
                        .lock()
                        .expect("table rows lock")
                        .get(&id)
                        .cloned();
                    let name_collection = self
                        .name_collections
                        .lock()
                        .expect("name collections lock")
                        .get(&id)
                        .cloned();
                    let named_item = self.names.lock().expect("names lock").get(&id).cloned();
                    let name_array_values = self
                        .name_array_values
                        .lock()
                        .expect("named item array values lock")
                        .get(&id)
                        .cloned();
                    let extension_binding = self.extension_binding(&id);
                    if sheet.is_none()
                        && !null_worksheet
                        && !worksheet_collection
                        && range.is_none()
                        && format.is_none()
                        && table.is_none()
                        && !null_table
                        && table_collection_binding.is_none()
                        && auto_filter.is_none()
                        && validation.is_none()
                        && border_collection.is_none()
                        && border.is_none()
                        && table_collection.is_none()
                        && table_column.is_none()
                        && !null_table_column
                        && table_row.is_none()
                        && name_collection.is_none()
                        && named_item.is_none()
                        && name_array_values.is_none()
                        && extension_binding.is_none()
                    {
                        return Err(BatchError {
                            code: "InvalidObjectPath",
                            message: "The object to load is not available.".to_string(),
                        });
                    }

                    let props = loaded.entry(id).or_insert_with(HashMap::new);
                    if let Some(sheet) = sheet {
                        let mut worksheet_properties = Vec::new();
                        for property in &properties {
                            if property == "isNullObject" {
                                props.insert(property.clone(), Value::Bool(false));
                            } else {
                                worksheet_properties.push(property.clone());
                            }
                        }
                        props.extend(sheet.load(&worksheet_properties).map_err(worksheet_error)?);
                    }
                    if null_worksheet {
                        for property in &properties {
                            if property == "isNullObject" {
                                props.insert(property.clone(), Value::Bool(true));
                            } else {
                                return Err(BatchError {
                                    code: "InvalidObjectPath",
                                    message: format!(
                                        "Worksheet.{property} cannot be loaded from a null object"
                                    ),
                                });
                            }
                        }
                    }
                    if worksheet_collection {
                        let item_properties =
                            collection_item_properties("WorksheetCollection", &properties)?;
                        let items =
                            worksheets::collection_items(&self.workbook, &item_properties, false)
                                .map_err(worksheet_error)?;
                        props.insert(
                            "items".to_string(),
                            serde_json::to_value(items).map_err(engine_error)?,
                        );
                    }
                    if let Some(range) = range {
                        if range.is_null_object {
                            for property in &properties {
                                if property == "isNullObject" {
                                    props.insert(property.clone(), Value::Bool(true));
                                } else {
                                    return Err(BatchError {
                                        code: "InvalidObjectPath",
                                        message: format!(
                                            "Range.{property} cannot be loaded from a null object"
                                        ),
                                    });
                                }
                            }
                            continue;
                        }
                        let metadata = range_metadata(&range)?;
                        let unbounded = range_has_unbounded_dimension(&range)?;
                        for property in &properties {
                            match property.as_str() {
                                "isNullObject" => {
                                    props.insert(property.clone(), Value::Bool(false));
                                }
                                "address" => {
                                    props.insert(
                                        "address".to_string(),
                                        Value::String(metadata.address.clone()),
                                    );
                                }
                                "rowIndex" => {
                                    props.insert("rowIndex".to_string(), json!(metadata.row_index));
                                }
                                "columnIndex" => {
                                    props.insert(
                                        "columnIndex".to_string(),
                                        json!(metadata.column_index),
                                    );
                                }
                                "rowCount" => {
                                    props.insert("rowCount".to_string(), json!(metadata.row_count));
                                }
                                "columnCount" => {
                                    props.insert(
                                        "columnCount".to_string(),
                                        json!(metadata.column_count),
                                    );
                                }
                                "cellCount" => {
                                    props.insert(
                                        "cellCount".to_string(),
                                        json!(metadata.cell_count),
                                    );
                                }
                                "values" => {
                                    props.insert(
                                        "values".to_string(),
                                        if unbounded {
                                            Value::Null
                                        } else {
                                            range_values_json(&range.sheet, metadata.bounds)?
                                        },
                                    );
                                }
                                "formulas" => {
                                    props.insert(
                                        "formulas".to_string(),
                                        if unbounded {
                                            Value::Null
                                        } else {
                                            range_formulas_json(&range.sheet, metadata.bounds)?
                                        },
                                    );
                                }
                                "numberFormat" | "text" | "valueTypes" => {
                                    props.extend(if unbounded {
                                        HashMap::from([(property.clone(), Value::Null)])
                                    } else {
                                        range_content::load(
                                            &range.sheet,
                                            range.address.as_deref().expect("bounded address"),
                                            std::slice::from_ref(property),
                                        )
                                        .map_err(range_content_error)?
                                    });
                                }
                                other => return Err(unsupported_load_property("Range", other)),
                            }
                        }
                    }
                    if let Some(format) = format {
                        props.extend(format.load(&properties).map_err(format_error)?);
                    }
                    if let Some(table) = table {
                        props.extend(table.load(&properties).map_err(table_error)?);
                    }
                    if null_table {
                        for property in &properties {
                            if property == "isNullObject" {
                                props.insert(property.clone(), Value::Bool(true));
                            } else {
                                return Err(BatchError {
                                    code: "InvalidObjectPath",
                                    message: format!(
                                        "Table.{property} cannot be loaded from a null object"
                                    ),
                                });
                            }
                        }
                    }
                    if let Some(scope) = table_collection_binding {
                        let item_properties = table_collection_item_properties(&properties)?;
                        let items = tables::collection_items(
                            &self.workbook,
                            scope.as_ref(),
                            &item_properties,
                        )
                        .map_err(table_error)?;
                        for property in &properties {
                            match property.as_str() {
                                "isNullObject" => {
                                    props.insert(property.clone(), Value::Bool(false));
                                }
                                "count" => {
                                    props.insert(property.clone(), json!(items.len()));
                                }
                                "items" => {
                                    props.insert(
                                        "items".to_string(),
                                        serde_json::to_value(&items).map_err(engine_error)?,
                                    );
                                }
                                p if p.starts_with("items/") => {
                                    props.insert(
                                        "items".to_string(),
                                        serde_json::to_value(&items).map_err(engine_error)?,
                                    );
                                }
                                other => {
                                    return Err(unsupported_load_property(
                                        "TableCollection",
                                        other,
                                    ));
                                }
                            }
                        }
                    }
                    if let Some(auto_filter) = auto_filter {
                        let snapshot = auto_filter.snapshot().map_err(sort_filter_error)?;
                        for property in &properties {
                            let value = match property.as_str() {
                                "criteria" => Value::Array(snapshot.criteria.clone()),
                                "enabled" => Value::Bool(snapshot.enabled),
                                "isDataFiltered" => Value::Bool(snapshot.is_data_filtered),
                                other => {
                                    return Err(unsupported_load_property("AutoFilter", other));
                                }
                            };
                            props.insert(property.clone(), value);
                        }
                    }
                    if let Some(validation) = validation {
                        props.extend(validation.load(&properties).map_err(validation_error)?);
                    }
                    if let Some(collection) = border_collection {
                        props.extend(collection.load(&properties).map_err(border_error)?);
                    }
                    if let Some(border) = border {
                        props.extend(border.load(&properties).map_err(border_error)?);
                    }
                    if let Some(collection) = table_collection {
                        props.extend(
                            table_collections::load_collection(
                                &collection.table,
                                collection.kind,
                                &properties,
                            )
                            .map_err(table_collection_error)?,
                        );
                    }
                    if let Some(column) = table_column {
                        props.extend(column.load(&properties).map_err(table_collection_error)?);
                    }
                    if null_table_column {
                        for property in &properties {
                            if property == "isNullObject" {
                                props.insert(property.clone(), Value::Bool(true));
                            } else {
                                return Err(BatchError {
                                    code: "InvalidObjectPath",
                                    message: format!(
                                        "TableColumn.{property} cannot be loaded from a null object"
                                    ),
                                });
                            }
                        }
                    }
                    if let Some(row) = table_row {
                        props.extend(row.load(&properties).map_err(table_collection_error)?);
                    }
                    if let Some(collection) = name_collection {
                        let item_properties =
                            collection_item_properties("NamedItemCollection", &properties)?;
                        let items = collection
                            .collection_items(&item_properties)
                            .map_err(name_error)?;
                        props.insert(
                            "items".to_string(),
                            serde_json::to_value(items).map_err(engine_error)?,
                        );
                    }
                    if let Some(item) = named_item {
                        props.extend(item.load(&properties).map_err(name_error)?);
                    }
                    if let Some(values) = name_array_values {
                        props.extend(values.load(&properties).map_err(name_error)?);
                    }
                    if let Some(binding) = extension_binding {
                        props.extend(binding.load(&properties)?);
                    }
                }
            }
        }
        Ok(BatchResult {
            error: None,
            loaded,
            results,
        })
    }
}

struct RangeMetadata {
    address: String,
    bounds: (u32, u32, u32, u32),
    row_index: u32,
    column_index: u32,
    row_count: u32,
    column_count: u32,
    cell_count: i64,
}

fn range_metadata(range: &RangeRef) -> Result<RangeMetadata, BatchError> {
    let parsed = parsed_range(range)?;
    let bounds = parsed.bounds();
    let (start_row, start_col, _, _) = bounds;
    let sheet_name = range.sheet.name().map_err(engine_error)?;
    let address = format!("{}!{}", qualified_sheet_name(&sheet_name), parsed.to_a1());

    Ok(RangeMetadata {
        address,
        bounds,
        row_index: start_row,
        column_index: start_col,
        row_count: parsed.row_count(),
        column_count: parsed.column_count(),
        cell_count: parsed.cell_count(),
    })
}

fn parsed_range(range: &RangeRef) -> Result<RangeAddress, BatchError> {
    if range.is_null_object {
        return Err(BatchError {
            code: "InvalidObjectPath",
            message: "The range object is a null object.".to_string(),
        });
    }
    match range.address.as_deref() {
        Some(address) => parse_range_address(&range.sheet, address).map_err(range_navigation_error),
        None => Ok(RangeAddress::WholeSheet),
    }
}

fn range_has_unbounded_dimension(range: &RangeRef) -> Result<bool, BatchError> {
    let parsed = parsed_range(range)?;
    Ok(parsed.is_whole_sheet() || parsed.is_entire_row() || parsed.is_entire_column())
}

fn qualified_sheet_name(sheet_name: &str) -> String {
    if sheet_name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        sheet_name.to_string()
    } else {
        format!("'{}'", sheet_name.replace('\'', "''"))
    }
}

fn unique_sheet_name(workbook: &Workbook) -> Result<String, BatchError> {
    let names = workbook.sheet_names().map_err(engine_error)?;
    for i in 1..10_000 {
        let candidate = format!("Sheet{i}");
        if !names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            return Ok(candidate);
        }
    }
    Err(BatchError {
        code: "GeneralException",
        message: "Unable to generate a unique worksheet name".to_string(),
    })
}

fn engine_error(err: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: err.to_string(),
    }
}

fn format_error(err: FormatError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn border_error(err: BorderError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn name_error(err: NameError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn name_collection_for_scope(
    host: &Host,
    worksheet_id: Option<&str>,
) -> Result<NamedItemCollectionRef, BatchError> {
    let scope = worksheet_id
        .map(|id| worksheet_ref(&host.sheets, id).map(|worksheet| worksheet.stable_id()))
        .transpose()?;
    Ok(NamedItemCollectionRef::new(host.workbook.clone(), scope))
}

fn name_ref(
    names: &Mutex<HashMap<String, NamedItemRef>>,
    id: &str,
) -> Result<NamedItemRef, BatchError> {
    names
        .lock()
        .expect("names lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The named item object is not available.".to_string(),
        })
}

fn range_content_error(err: RangeContentError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn range_navigation_error(err: RangeNavigationError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn sort_filter_error(err: SortFilterError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn validation_error(err: ValidationError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn worksheet_error(err: WorksheetError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn worksheet_ref(
    worksheets: &Mutex<HashMap<String, WorksheetRef>>,
    id: &str,
) -> Result<WorksheetRef, BatchError> {
    worksheets
        .lock()
        .expect("sheets lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The worksheet object is not available.".to_string(),
        })
}

fn require_worksheet_collection(host: &Host, id: &str) -> Result<(), BatchError> {
    if host
        .worksheet_collections
        .lock()
        .expect("worksheet collections lock")
        .contains(id)
    {
        Ok(())
    } else {
        Err(BatchError {
            code: "InvalidObjectPath",
            message: "The worksheet collection object is not available.".to_string(),
        })
    }
}

fn bind_nullable_worksheet(
    host: &Host,
    loaded: &mut HashMap<String, HashMap<String, Value>>,
    id: String,
    worksheet: Option<WorksheetRef>,
    _or_null: bool,
) {
    let is_null = worksheet.is_none();
    if let Some(worksheet) = worksheet {
        host.sheets
            .lock()
            .expect("sheets lock")
            .insert(id.clone(), worksheet);
    } else {
        host.null_worksheets
            .lock()
            .expect("null worksheets lock")
            .insert(id.clone());
    }
    mark_object(loaded, &id, is_null);
}

fn collection_item_properties(
    object: &str,
    properties: &[String],
) -> Result<Vec<String>, BatchError> {
    let mut result = Vec::new();
    let mut defaults = false;
    for property in properties {
        if property == "items" {
            defaults = true;
        } else if let Some(item_property) = property.strip_prefix("items/") {
            if item_property.is_empty() {
                return Err(unsupported_load_property(object, property));
            }
            if !result.iter().any(|existing| existing == item_property) {
                result.push(item_property.to_string());
            }
        } else if property == "isNullObject" {
            continue;
        } else {
            return Err(unsupported_load_property(object, property));
        }
    }
    if defaults { Ok(Vec::new()) } else { Ok(result) }
}

fn table_collection_item_properties(properties: &[String]) -> Result<Vec<String>, BatchError> {
    let mut result = Vec::new();
    let mut defaults = false;
    for property in properties {
        if property == "count" || property == "isNullObject" {
            continue;
        }
        if property == "items" {
            defaults = true;
            continue;
        }
        if let Some(item_property) = property.strip_prefix("items/") {
            if item_property.is_empty() {
                return Err(unsupported_load_property("TableCollection", property));
            }
            if !result.iter().any(|existing| existing == item_property) {
                result.push(item_property.to_string());
            }
            continue;
        }
        return Err(unsupported_load_property("TableCollection", property));
    }
    if defaults { Ok(Vec::new()) } else { Ok(result) }
}

pub(crate) fn mark_object(
    loaded: &mut HashMap<String, HashMap<String, Value>>,
    id: &str,
    is_null: bool,
) {
    loaded
        .entry(id.to_string())
        .or_default()
        .insert("isNullObject".to_string(), Value::Bool(is_null));
}

fn auto_filter_ref(
    auto_filters: &Mutex<HashMap<String, AutoFilterRef>>,
    id: &str,
) -> Result<AutoFilterRef, BatchError> {
    auto_filters
        .lock()
        .expect("auto filters lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The AutoFilter object is not available.".to_string(),
        })
}

fn table_error(err: TableError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn table_error_invalid_index(kind: &str) -> TableError {
    TableError {
        code: "InvalidArgument",
        message: format!("TableCollection.getItemAt requires an integer {kind} index"),
    }
}

fn table_collection_error(err: TableCollectionError) -> BatchError {
    BatchError {
        code: err.code,
        message: err.message,
    }
}

fn table_ref(tables: &Mutex<HashMap<String, TableRef>>, id: &str) -> Result<TableRef, BatchError> {
    tables
        .lock()
        .expect("tables lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The table object is not available.".to_string(),
        })
}

fn table_collection_ref(
    collections: &Mutex<HashMap<String, TableCollectionRef>>,
    id: &str,
) -> Result<TableCollectionRef, BatchError> {
    collections
        .lock()
        .expect("table collections lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The table collection object is not available.".to_string(),
        })
}

fn table_column_ref(
    columns: &Mutex<HashMap<String, TableColumnRef>>,
    id: &str,
) -> Result<TableColumnRef, BatchError> {
    columns
        .lock()
        .expect("table columns lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The table column object is not available.".to_string(),
        })
}

fn table_row_ref(
    rows: &Mutex<HashMap<String, TableRowRef>>,
    id: &str,
) -> Result<TableRowRef, BatchError> {
    rows.lock()
        .expect("table rows lock")
        .get(id)
        .cloned()
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The table row object is not available.".to_string(),
        })
}

fn write_error(err: ComputeApiError) -> BatchError {
    match err {
        ComputeApiError::InvalidAddress { .. } | ComputeApiError::InvalidRange { .. } => {
            BatchError {
                code: "InvalidArgument",
                message: err.to_string(),
            }
        }
        other => engine_error(other),
    }
}

#[derive(Clone, Copy)]
enum WriteProperty {
    Values,
    Formulas,
}

impl WriteProperty {
    fn from_name(name: &str) -> Result<Self, BatchError> {
        match name {
            "values" => Ok(Self::Values),
            "formulas" => Ok(Self::Formulas),
            other => Err(BatchError {
                code: "InvalidArgument",
                message: format!("Unsupported Range property '{other}'"),
            }),
        }
    }
}

fn unsupported_load_property(object: &str, property: &str) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} load property '{property}'"),
    }
}

fn json_to_write_grid(
    value: &Value,
    property: WriteProperty,
) -> Result<Vec<Vec<Option<CellInput>>>, BatchError> {
    let rows = value.as_array().ok_or_else(|| BatchError {
        code: "InvalidArgument",
        message: "Range.values and Range.formulas require a 2-dimensional array".to_string(),
    })?;
    let mut grid = Vec::with_capacity(rows.len());
    for row in rows {
        let cells = row.as_array().ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: "Range.values and Range.formulas require a 2-dimensional array".to_string(),
        })?;
        let mut out_row = Vec::with_capacity(cells.len());
        for cell in cells {
            out_row.push(js_cell_to_write(cell, property)?);
        }
        grid.push(out_row);
    }
    Ok(grid)
}

fn js_cell_to_write(
    value: &Value,
    property: WriteProperty,
) -> Result<Option<CellInput>, BatchError> {
    match value {
        // Microsoft documents null entries in a 2-D property payload as
        // preserve-cell sentinels. They must never become clear intents.
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(CellInput::Value {
            value: CellValue::Boolean(*value),
        })),
        Value::Number(value) => value
            .as_f64()
            .map(CellValue::from)
            .map(|value| Some(CellInput::Value { value }))
            .ok_or_else(|| BatchError {
                code: "InvalidArgument",
                message: "Range values must contain finite JavaScript numbers".to_string(),
            }),
        Value::String(value) if value.is_empty() => Ok(Some(CellInput::Clear)),
        Value::String(value) if has_formula_intent(value, property) => {
            Ok(Some(CellInput::formula(value)))
        }
        Value::String(value) => Ok(Some(CellInput::Literal {
            text: value.clone(),
        })),
        _ => Err(BatchError {
            code: "InvalidArgument",
            message: "Range values must contain only strings, numbers, booleans, or null"
                .to_string(),
        }),
    }
}

fn has_formula_intent(value: &str, property: WriteProperty) -> bool {
    match property {
        // The Range.values contract explicitly says leading +, -, and = are
        // interpreted as formulas.
        WriteProperty::Values => {
            value.starts_with('+') || value.starts_with('-') || value.starts_with('=')
        }
        // Range.formulas uses A1 formula strings. Non-formula strings are
        // values and retain their JavaScript string type.
        WriteProperty::Formulas => value.starts_with('='),
    }
}

fn range_values_json(sheet: &Sheet, bounds: (u32, u32, u32, u32)) -> Result<Value, BatchError> {
    let (sr, sc, er, ec) = bounds;
    let values = sheet
        .get_range_values_2d(compute_api::CellRange::Bounds(sr, sc, er, ec))
        .map_err(engine_error)?;
    Ok(Value::Array(
        values
            .into_iter()
            .map(|row| Value::Array(row.into_iter().map(cell_to_js).collect()))
            .collect(),
    ))
}

fn range_formulas_json(sheet: &Sheet, bounds: (u32, u32, u32, u32)) -> Result<Value, BatchError> {
    let (sr, sc, er, ec) = bounds;
    let mut rows = Vec::new();
    for row in sr..=er {
        let mut cells = Vec::new();
        for col in sc..=ec {
            let addr = CellAddress::Position(row, col);
            if let Some(formula) = sheet.get_formula(addr.clone()).map_err(engine_error)? {
                cells.push(Value::String(formula));
            } else {
                cells.push(cell_to_js(
                    sheet.get_cell_value(addr).map_err(engine_error)?,
                ));
            }
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn cell_to_js(value: CellValue) -> Value {
    match value {
        // Empty cells are represented as empty strings for bounded range
        // values/formulas reads. Unbounded properties are handled separately
        // and return null for the entire property.
        CellValue::Null => Value::String(String::new()),
        CellValue::Boolean(b) => Value::Bool(b),
        CellValue::Number(_) => value.as_number().map(|n| json!(n)).unwrap_or(Value::Null),
        CellValue::Text(s) => Value::String(s.to_string()),
        CellValue::Error(err, _) => Value::String(err.to_string()),
        other => Value::String(other.to_string()),
    }
}
