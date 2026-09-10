//! Office.js named-item data helpers.
//! The Office.js host owns proxy lifetime and batching. This module projects
//! persisted `DefinedName` records to scalar properties; it resolves a real
//! `Range` only from explicit A1, never guessing unresolved identifiers.
//!
//! Host routing for collection CRUD, range/worksheet navigation, array values,
//! and generic load is defined by operations emitted from `names.js`.
use compute_api::{CellRange, DefinedNameInput, MutationResult, NamedRangeUpdate, Sheet, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use value_types::{CellError, CellValue};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NameRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) refers_to: String,
    #[serde(default)]
    pub(crate) raw_refers_to: Option<String>,
    #[serde(default)]
    pub(crate) scope: Option<String>,
    #[serde(default)]
    pub(crate) comment: Option<String>,
    #[serde(default)]
    pub(crate) custom_menu: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) help: Option<String>,
    #[serde(default)]
    pub(crate) status_bar: Option<String>,
    #[serde(default = "default_true")]
    pub(crate) visible: bool,
    #[serde(default)]
    pub(crate) xlm: bool,
    #[serde(default)]
    pub(crate) function: bool,
    #[serde(default)]
    pub(crate) vb_procedure: bool,
    #[serde(default)]
    pub(crate) publish_to_server: bool,
    #[serde(default)]
    pub(crate) workbook_parameter: bool,
    #[serde(default)]
    pub(crate) xml_space_preserve: bool,
    #[serde(default)]
    pub(crate) order: Option<u32>,
    #[serde(default)]
    pub(crate) linked_range_id: Option<Value>,
}
impl NameRecord {
    pub(crate) fn from_value(value: Value) -> Result<Self, NameError> {
        serde_json::from_value(value).map_err(encoding)
    }
    pub(crate) fn from_serializable<T: Serialize>(value: &T) -> Result<Self, NameError> {
        Self::from_value(serde_json::to_value(value).map_err(encoding)?)
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NameCollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}
const DEFAULT_NAMED_ITEM_PROPERTIES: &[&str] = &[
    "comment", "formula", "name", "scope", "type", "value", "visible",
];
#[derive(Clone)]
pub(crate) struct NameRange {
    sheet: Sheet,
    address: String,
}
impl NameRange {
    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }
    pub(crate) fn address(&self) -> &str {
        &self.address
    }
    pub(crate) fn display_address(&self) -> Result<String, NameError> {
        let sheet_name = self.sheet.name().map_err(engine)?;
        Ok(format!(
            "{}!{}",
            qualified_sheet_name(&sheet_name),
            self.address
        ))
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NameError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}
#[derive(Clone)]
pub(crate) struct NamedItemCollectionRef {
    workbook: Workbook,
    scope: Option<String>,
}
impl NamedItemCollectionRef {
    pub(crate) fn new(workbook: Workbook, scope: Option<String>) -> Self {
        Self { workbook, scope }
    }
    pub(crate) fn add(
        &self,
        name: &str,
        reference: &Value,
        formula_local: bool,
        comment: Option<String>,
    ) -> Result<NamedItemRef, NameError> {
        let formula = normalize_reference(reference, formula_local)?;
        self.create(name, formula, comment)
    }
    pub(crate) fn add_range(
        &self,
        name: &str,
        sheet: &Sheet,
        address: &str,
        comment: Option<String>,
    ) -> Result<NamedItemRef, NameError> {
        let formula = formula_for_range(sheet, address)?;
        self.create(name, formula, comment)
    }
    pub(crate) fn get_item(&self, name: &str) -> Result<NamedItemRef, NameError> {
        if name.trim().is_empty() {
            return Err(invalid("NamedItemCollection.getItem name cannot be empty"));
        }
        let record = self
            .workbook
            .names()
            .get_named_range_by_name(name, self.scope.clone())
            .map_err(compute_error)?
            .map(|record| NameRecord::from_serializable(&record))
            .transpose()?;
        let Some(record) = record else {
            return Err(item_not_found(name));
        };
        Ok(NamedItemRef::new(self.workbook.clone(), record.id, false))
    }
    pub(crate) fn get_item_or_null_object(&self, name: &str) -> Result<NamedItemRef, NameError> {
        if name.trim().is_empty() {
            return Err(invalid(
                "NamedItemCollection.getItemOrNullObject name cannot be empty",
            ));
        }
        let record = self
            .workbook
            .names()
            .get_named_range_by_name(name, self.scope.clone())
            .map_err(compute_error)?
            .map(|record| NameRecord::from_serializable(&record))
            .transpose()?;
        Ok(match record {
            Some(record) => NamedItemRef::new(self.workbook.clone(), record.id, false),
            None => NamedItemRef::null(self.workbook.clone()),
        })
    }
    pub(crate) fn count(&self) -> Result<usize, NameError> {
        self.workbook
            .names()
            .get_named_ranges_by_scope(self.scope.clone())
            .map(|records| records.len())
            .map_err(compute_error)
    }
    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<NameCollectionItem>, NameError> {
        if properties.is_empty() {
            self.items(DEFAULT_NAMED_ITEM_PROPERTIES)
        } else {
            self.items(properties)
        }
    }
    fn items<P: AsRef<str>>(&self, properties: &[P]) -> Result<Vec<NameCollectionItem>, NameError> {
        let records = self
            .workbook
            .names()
            .get_named_ranges_by_scope(self.scope.clone())
            .map_err(compute_error)?;
        let records = records
            .iter()
            .map(NameRecord::from_serializable)
            .collect::<Result<Vec<_>, _>>()?;
        collection_items(&self.workbook, &records, properties)
    }
    fn create(
        &self,
        name: &str,
        formula: String,
        comment: Option<String>,
    ) -> Result<NamedItemRef, NameError> {
        if name.trim().is_empty() {
            return Err(invalid("Named item name cannot be empty"));
        }
        let result = self
            .workbook
            .names()
            .create_named_range(DefinedNameInput {
                name: name.to_string(),
                refers_to: formula,
                scope: self.scope.clone(),
                comment,
            })
            .map_err(compute_error)?;
        let record = mutation_record(result)?;
        Ok(NamedItemRef::new(self.workbook.clone(), record.id, false))
    }
}
#[derive(Clone)]
pub(crate) struct NamedItemRef {
    workbook: Workbook,
    id: String,
    null_object: bool,
}
impl NamedItemRef {
    fn new(workbook: Workbook, id: String, null_object: bool) -> Self {
        Self {
            workbook,
            id,
            null_object,
        }
    }
    fn null(workbook: Workbook) -> Self {
        Self::new(workbook, String::new(), true)
    }
    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }
    pub(crate) fn resolve(&self) -> Result<Option<NameRecord>, NameError> {
        if self.null_object {
            return Ok(None);
        }
        let record = self
            .workbook
            .names()
            .get_named_range_by_id(&self.id)
            .map_err(compute_error)?;
        record
            .map(|record| NameRecord::from_serializable(&record))
            .transpose()
    }
    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, NameError> {
        // A null-object probe is valid without a persisted record. Keep this
        // transport property separate from NamedItemData while allowing
        // callers to load it alongside ordinary scalar fields.
        let mut result = HashMap::new();
        if properties.iter().any(|property| property == "isNullObject") {
            result.insert("isNullObject".to_string(), Value::Bool(self.null_object));
        }
        let properties = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect::<Vec<_>>();
        if properties.is_empty() || self.null_object {
            return Ok(result);
        }
        let record = self.resolve()?.ok_or_else(|| item_not_found(&self.id))?;
        result.extend(name_properties(&self.workbook, &record, &properties)?);
        Ok(result)
    }
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), NameError> {
        let _record = self.resolve()?.ok_or_else(|| item_not_found(&self.id))?;
        let updates = match property {
            "comment" => NamedRangeUpdate {
                comment: Some(Some(
                    value
                        .as_str()
                        .ok_or_else(|| invalid("NamedItem.comment must be a string"))?
                        .to_string(),
                )),
                ..Default::default()
            },
            "formula" => {
                let formula = value
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| invalid("NamedItem.formula must be a non-empty string"))?;
                NamedRangeUpdate {
                    refers_to: Some(ensure_formula_prefix(formula.trim())),
                    ..Default::default()
                }
            }
            "visible" => NamedRangeUpdate {
                visible: Some(
                    value
                        .as_bool()
                        .ok_or_else(|| invalid("NamedItem.visible must be a boolean"))?,
                ),
                ..Default::default()
            },
            other => {
                return Err(unsupported(format!(
                    "NamedItem.{other} is read-only or unsupported"
                )));
            }
        };
        self.workbook
            .names()
            .update_named_range(&self.id, updates)
            .map_err(compute_error)?;
        Ok(())
    }
    pub(crate) fn delete(&self) -> Result<(), NameError> {
        if self.null_object {
            return Ok(());
        }
        self.workbook
            .names()
            .remove_named_range_by_id(&self.id)
            .map_err(compute_error)?;
        Ok(())
    }
    pub(crate) fn worksheet(&self) -> Result<Option<Sheet>, NameError> {
        let Some(record) = self.resolve()? else {
            return if self.null_object {
                Ok(None)
            } else {
                Err(item_not_found(&self.id))
            };
        };
        record
            .scope
            .as_deref()
            .map(|scope| {
                find_sheet_by_id(&self.workbook, scope).ok_or_else(|| item_not_found(scope))
            })
            .transpose()
    }
    pub(crate) fn array_values_ref(&self) -> NamedItemArrayValuesRef {
        NamedItemArrayValuesRef::new(self.clone())
    }
    pub(crate) fn range(&self) -> Result<Option<NameRange>, NameError> {
        let Some(record) = self.resolve()? else {
            if !self.null_object {
                return Err(item_not_found(&self.id));
            }
            return Ok(None);
        };
        resolve_name_range(&self.workbook, &record)
    }
}
#[derive(Clone)]
pub(crate) struct NamedItemArrayValuesRef(NamedItemRef);
impl NamedItemArrayValuesRef {
    pub(crate) fn new(item: NamedItemRef) -> Self {
        Self(item)
    }
    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, NameError> {
        let wants_values = properties.is_empty() || properties.iter().any(|p| p == "values");
        let wants_types = properties.is_empty() || properties.iter().any(|p| p == "types");
        if properties.iter().any(|p| p != "values" && p != "types") {
            return Err(unsupported(
                "NamedItemArrayValues only exposes values and types".into(),
            ));
        }
        let cells = if let Some(range) = self.0.range()? {
            range
                .sheet()
                .get_range_values_2d(range.address())
                .map_err(compute_error)?
        } else {
            let record = self
                .0
                .resolve()?
                .ok_or_else(|| item_not_found(&self.0.id))?;
            let ClassifiedName::Scalar(value, value_type) =
                classify_name(&self.0.workbook, &record)?
            else {
                return Err(unsupported(
                    "NamedItem.arrayValues is unavailable for an array or unsupported formula"
                        .to_string(),
                ));
            };
            let mut result = HashMap::new();
            if wants_values {
                result.insert("values".to_string(), json!([[value]]));
            }
            if wants_types {
                result.insert("types".to_string(), json!([[value_type]]));
            }
            return Ok(result);
        };
        let mut result = HashMap::new();
        if wants_values {
            result.insert("values".to_string(), array_grid(&cells, array_value)?);
        }
        if wants_types {
            result.insert(
                "types".to_string(),
                array_grid(&cells, |cell| {
                    Ok(Value::String(array_type(cell).to_string()))
                })?,
            );
        }
        Ok(result)
    }
}
fn array_grid<F>(cells: &[Vec<CellValue>], mut map: F) -> Result<Value, NameError>
where
    F: FnMut(&CellValue) -> Result<Value, NameError>,
{
    Ok(Value::Array(
        cells
            .iter()
            .map(|row| row.iter().map(&mut map).collect::<Result<Vec<_>, _>>())
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(Value::Array)
            .collect(),
    ))
}
fn array_value(value: &CellValue) -> Result<Value, NameError> {
    match value {
        CellValue::Null => Ok(Value::String(String::new())),
        CellValue::Number(number) => Ok(json!(number.get())),
        CellValue::Text(text) => Ok(Value::String(text.to_string())),
        CellValue::Boolean(value) => Ok(Value::Bool(*value)),
        CellValue::Error(error, _) => Ok(Value::String(error.to_string())),
        CellValue::Control(control) => Ok(Value::Bool(control.value)),
        CellValue::Array(_) | CellValue::Image(_) => Err(unsupported(
            "NamedItemArrayValues contains a rich cell value unsupported by this slice".to_string(),
        )),
    }
}
fn array_type(value: &CellValue) -> &'static str {
    match value {
        CellValue::Null => "Empty",
        CellValue::Number(number) => {
            if number.get().fract() == 0.0 {
                "Integer"
            } else {
                "Double"
            }
        }
        CellValue::Text(_) => "String",
        CellValue::Boolean(_) | CellValue::Control(_) => "Boolean",
        CellValue::Error(_, _) => "Error",
        CellValue::Array(_) | CellValue::Image(_) => "RichValue",
    }
}
fn mutation_record(result: MutationResult) -> Result<NameRecord, NameError> {
    let data = result.data.ok_or_else(|| NameError {
        code: "GeneralException",
        message: "The compute engine did not return the created named item.".to_string(),
    })?;
    NameRecord::from_value(data)
}
pub(crate) fn normalize_reference(value: &Value, formula_local: bool) -> Result<String, NameError> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() {
                return Err(invalid("Named item formula cannot be empty"));
            }
            if formula_local
                || text.starts_with('=')
                || text.contains('!')
                || CellRange::from(text).resolve().is_ok()
            {
                Ok(ensure_formula_prefix(text))
            } else {
                Ok(format!("=\"{}\"", text.replace('"', "\"\"")))
            }
        }
        Value::Number(number) => {
            let number = number
                .as_f64()
                .ok_or_else(|| invalid("Named item numeric references must be finite numbers"))?;
            if !number.is_finite() {
                return Err(invalid(
                    "Named item numeric references must be finite numbers",
                ));
            }
            Ok(format!("={number}"))
        }
        Value::Bool(value) => Ok(if *value {
            "=TRUE".to_string()
        } else {
            "=FALSE".to_string()
        }),
        _ => Err(invalid(
            "Named item references must be a Range, string, number, or boolean",
        )),
    }
}
pub(crate) fn formula_for_range(sheet: &Sheet, address: &str) -> Result<String, NameError> {
    let (start_row, start_col, end_row, end_col) = CellRange::from(address)
        .resolve()
        .map_err(|error| invalid(error.to_string()))?;
    if start_row > end_row || start_col > end_col {
        return Err(invalid(format!("Invalid named range address '{address}'")));
    }
    let sheet_name = sheet.name().map_err(engine)?;
    let start = absolute_cell(start_row, start_col);
    let end = absolute_cell(end_row, end_col);
    let range = if start == end {
        start
    } else {
        format!("{start}:{end}")
    };
    Ok(format!("={}!{range}", qualified_sheet_name(&sheet_name)))
}
pub(crate) fn name_properties<P: AsRef<str>>(
    workbook: &Workbook,
    record: &NameRecord,
    properties: &[P],
) -> Result<HashMap<String, Value>, NameError> {
    if properties.is_empty() {
        return Ok(HashMap::new());
    }
    let classified = classify_name(workbook, record)?;
    let mut result = HashMap::new();
    for property in properties {
        let property = property.as_ref();
        let value = match property {
            "name" => Value::String(record.name.clone()),
            "formula" => Value::String(formula_for_record(workbook, record)?.ok_or_else(|| {
                unsupported(
                    "NamedItem.formula is unavailable because the engine only has an opaque identity formula"
                        .to_string(),
                )
            })?),
            "scope" => Value::String(
                if record.scope.is_some() {
                    "Worksheet"
                } else {
                    "Workbook"
                }
                .to_string(),
            ),
            "visible" => Value::Bool(record.visible),
            "comment" => Value::String(record.comment.clone().unwrap_or_default()),
            "type" => Value::String(classified.office_type().ok_or_else(|| {
                unsupported(format!(
                    "NamedItem.type is unavailable for formula '{}'",
                    formula_for_error(record)
                ))
            })?),
            "value" => classified.office_value().ok_or_else(|| {
                unsupported(format!(
                    "NamedItem.value is unavailable for formula '{}'",
                    formula_for_error(record)
                ))
            })?,
            other => return Err(unsupported(format!("NamedItem.{other} is not supported"))),
        };
        result.insert(property.to_string(), value);
    }
    Ok(result)
}
pub(crate) fn collection_items<P: AsRef<str>>(
    workbook: &Workbook,
    records: &[NameRecord],
    properties: &[P],
) -> Result<Vec<NameCollectionItem>, NameError> {
    records
        .iter()
        .map(|record| {
            Ok(NameCollectionItem {
                // Names are case-insensitive selectors in Office.js and are
                // stable across property changes. The host can still resolve
                // this key by the persisted ID if it keeps an ID map.
                key: record.name.clone(),
                properties: name_properties(workbook, record, properties)?,
            })
        })
        .collect()
}
pub(crate) fn resolve_name_range(
    workbook: &Workbook,
    record: &NameRecord,
) -> Result<Option<NameRange>, NameError> {
    let Some(formula) = formula_for_record(workbook, record)? else {
        return Ok(None);
    };
    let body = formula.strip_prefix('=').unwrap_or(&formula).trim();
    let (sheet_token, address) = match split_sheet_reference(body) {
        Some((sheet, address)) => (Some(sheet), address),
        None => (None, body),
    };

    let bounds = match CellRange::from(address.trim()).resolve() {
        Ok(bounds) if bounds.0 <= bounds.2 && bounds.1 <= bounds.3 => bounds,
        _ => return Ok(None),
    };

    let sheet = if let Some(token) = sheet_token {
        let sheet_name = unquote_sheet_name(token)?;
        find_sheet_by_name(workbook, &sheet_name)
    } else if let Some(scope) = record.scope.as_deref() {
        find_sheet_by_id(workbook, scope)
    } else {
        workbook.sheet_by_index(0).ok()
    };

    let Some(sheet) = sheet else {
        return Ok(None);
    };
    let address = canonical_address(bounds);
    Ok(Some(NameRange { sheet, address }))
}

fn classify_name(workbook: &Workbook, record: &NameRecord) -> Result<ClassifiedName, NameError> {
    if let Some(range) = resolve_name_range(workbook, record)? {
        return Ok(ClassifiedName::Range(range));
    }

    let Some(formula) = formula_for_record(workbook, record)? else {
        return Ok(ClassifiedName::Unsupported);
    };
    let body = formula.strip_prefix('=').unwrap_or(&formula).trim();
    if body.eq_ignore_ascii_case("TRUE") {
        return Ok(ClassifiedName::Scalar(json!(true), "Boolean"));
    }
    if body.eq_ignore_ascii_case("FALSE") {
        return Ok(ClassifiedName::Scalar(json!(false), "Boolean"));
    }
    if let Some(string) = parse_excel_string(body) {
        return Ok(ClassifiedName::Scalar(Value::String(string), "String"));
    }
    if let Ok(number) = body.parse::<f64>()
        && number.is_finite()
    {
        let numeric_type = if is_integer_literal(body) {
            "Integer"
        } else {
            "Double"
        };
        return Ok(ClassifiedName::Scalar(json!(number), numeric_type));
    }
    if let Some(error) = CellError::parse_error_str(body) {
        return Ok(ClassifiedName::Scalar(
            Value::String(error.to_string()),
            "Error",
        ));
    }
    // Delegate formula parsing/evaluation to the production engine.
    let sheet = evaluation_sheet(workbook, record).ok_or_else(|| {
        unsupported(format!(
            "NamedItem formula '{}' has no worksheet evaluation context",
            formula_for_error(record)
        ))
    })?;
    let value = workbook
        .names()
        .evaluate_expression(sheet.id(), &formula)
        .map_err(compute_error)?;
    classified_from_cell_value(value)
}

enum ClassifiedName {
    Range(NameRange),
    Scalar(Value, &'static str),
    Unsupported,
}

impl ClassifiedName {
    fn office_type(&self) -> Option<String> {
        match self {
            Self::Range(_) => Some("Range".to_string()),
            Self::Scalar(_, kind) => Some((*kind).to_string()),
            Self::Unsupported => None,
        }
    }

    fn office_value(&self) -> Option<Value> {
        match self {
            Self::Range(range) => range.display_address().ok().map(Value::String),
            Self::Scalar(value, _) => Some(value.clone()),
            Self::Unsupported => None,
        }
    }
}

fn classified_from_cell_value(value: CellValue) -> Result<ClassifiedName, NameError> {
    let (office_value, office_type) = match value {
        CellValue::Null => (Value::String(String::new()), "String"),
        CellValue::Number(number) => {
            let number = number.get();
            (json!(number), if number.fract() == 0.0 { "Integer" } else { "Double" })
        }
        CellValue::Text(text) => (Value::String(text.to_string()), "String"),
        CellValue::Boolean(value) => (Value::Bool(value), "Boolean"),
        CellValue::Error(error, _) => (Value::String(error.to_string()), "Error"),
        // The current expression query reduces arrays to their top-left value.
        CellValue::Array(_) => return Err(unsupported("NamedItem formula evaluated to an array; array results need the full evaluator query".to_string())),
        CellValue::Control(control) => (Value::Bool(control.value), "Boolean"),
        CellValue::Image(_) => return Err(unsupported("NamedItem formula evaluated to an image value, which this Office.js slice does not expose".to_string())),
    };
    Ok(ClassifiedName::Scalar(office_value, office_type))
}

fn evaluation_sheet(workbook: &Workbook, record: &NameRecord) -> Option<Sheet> {
    record
        .scope
        .as_deref()
        .and_then(|scope| find_sheet_by_id(workbook, scope))
        .or_else(|| workbook.sheet_by_index(0).ok())
}

fn formula_for_record(
    workbook: &Workbook,
    record: &NameRecord,
) -> Result<Option<String>, NameError> {
    if let Some(formula) = record_formula(record) {
        return Ok(Some(formula));
    }
    workbook
        .names()
        .get_named_range_formula_by_id(&record.id)
        .map_err(compute_error)
        .map(|formula| formula.map(|formula| ensure_formula_prefix(formula.trim())))
}

fn record_formula(record: &NameRecord) -> Option<String> {
    let source = record
        .raw_refers_to
        .as_deref()
        .unwrap_or(record.refers_to.as_str())
        .trim();
    if record.raw_refers_to.is_none()
        && serde_json::from_str::<Value>(source)
            .ok()
            .is_some_and(|value| value.is_object())
    {
        return None;
    }
    Some(ensure_formula_prefix(source))
}

fn formula_for_error(record: &NameRecord) -> String {
    record_formula(record).unwrap_or_else(|| "<opaque IdentityFormula>".to_string())
}

fn ensure_formula_prefix(source: &str) -> String {
    if source.starts_with('=') {
        source.to_string()
    } else {
        format!("={source}")
    }
}

fn parse_excel_string(body: &str) -> Option<String> {
    let mut chars = body.chars();
    if chars.next()? != '"' || !body.ends_with('"') {
        return None;
    }
    let inner = &body[1..body.len() - 1];
    let mut result = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(character) = chars.next() {
        if character == '"' {
            if chars.next() != Some('"') {
                return None;
            }
            result.push('"');
        } else {
            result.push(character);
        }
    }
    Some(result)
}

fn is_integer_literal(body: &str) -> bool {
    !body.contains(['.', 'e', 'E'])
}

fn split_sheet_reference(body: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    let mut index = 0;
    for (offset, character) in body.char_indices() {
        if character == '\'' {
            quoted = !quoted;
        } else if character == '!' && !quoted {
            index = offset;
            break;
        }
    }
    (index > 0).then(|| (&body[..index], &body[index + 1..]))
}

fn unquote_sheet_name(token: &str) -> Result<String, NameError> {
    let token = token.trim();
    if token.starts_with('\'') {
        if !token.ends_with('\'') || token.len() < 2 {
            return Err(invalid(format!("Invalid worksheet reference '{token}'")));
        }
        let inner = &token[1..token.len() - 1];
        Ok(inner.replace("''", "'"))
    } else if token.contains('\'') {
        Err(invalid(format!("Invalid worksheet reference '{token}'")))
    } else {
        Ok(token.to_string())
    }
}

fn find_sheet_by_name(workbook: &Workbook, name: &str) -> Option<Sheet> {
    let count = workbook.sheet_count().ok()?;
    for index in 0..count {
        let sheet = workbook.sheet_by_index(index).ok()?;
        if sheet.name().ok()?.eq_ignore_ascii_case(name) {
            return Some(sheet);
        }
    }
    None
}

fn find_sheet_by_id(workbook: &Workbook, id: &str) -> Option<Sheet> {
    let count = workbook.sheet_count().ok()?;
    for index in 0..count {
        let sheet = workbook.sheet_by_index(index).ok()?;
        if sheet.id().to_uuid_string().eq_ignore_ascii_case(id) {
            return Some(sheet);
        }
    }
    None
}

fn canonical_address(bounds: (u32, u32, u32, u32)) -> String {
    let (start_row, start_col, end_row, end_col) = bounds;
    let start = cell_address(start_row, start_col);
    let end = cell_address(end_row, end_col);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn absolute_cell(row: u32, col: u32) -> String {
    format!("${}${}", column_name(col), row + 1)
}

fn cell_address(row: u32, col: u32) -> String {
    format!("{}{}", column_name(col), row + 1)
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

fn column_name(mut column: u32) -> String {
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

fn default_true() -> bool {
    true
}

fn item_not_found(key: &str) -> NameError {
    NameError {
        code: "ItemNotFound",
        message: format!("The requested named item doesn't exist. Name or ID: {key}"),
    }
}

fn compute_error(error: compute_api::ComputeApiError) -> NameError {
    let code = match &error {
        compute_api::ComputeApiError::InvalidAddress { .. }
        | compute_api::ComputeApiError::InvalidRange { .. }
        | compute_api::ComputeApiError::InvalidOperation(_) => "InvalidArgument",
        compute_api::ComputeApiError::SheetNotFound { .. } => "ItemNotFound",
        compute_api::ComputeApiError::Compute(value_types::ComputeError::Eval { message })
            if message.to_ascii_lowercase().contains("not found") =>
        {
            "ItemNotFound"
        }
        compute_api::ComputeApiError::Compute(value_types::ComputeError::Eval { .. }) => {
            "InvalidArgument"
        }
        compute_api::ComputeApiError::Compute(value_types::ComputeError::Parse { .. }) => {
            "InvalidArgument"
        }
        _ => "GeneralException",
    };
    NameError {
        code,
        message: error.to_string(),
    }
}

fn unsupported(message: String) -> NameError {
    NameError {
        code: "InvalidArgument",
        message,
    }
}

fn invalid(message: impl Into<String>) -> NameError {
    NameError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn engine(error: impl std::fmt::Display) -> NameError {
    NameError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: serde_json::Error) -> NameError {
    NameError {
        code: "GeneralException",
        message: format!("Failed to encode named item value: {error}"),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitive_references_are_formula_normalized() {
        assert_eq!(normalize_reference(&json!(42), false).unwrap(), "=42");
        assert_eq!(normalize_reference(&json!(true), false).unwrap(), "=TRUE");
        assert_eq!(
            normalize_reference(&json!("hello"), false).unwrap(),
            "=\"hello\""
        );
        assert_eq!(
            normalize_reference(&json!("=SUM(A1:A2)"), false).unwrap(),
            "=SUM(A1:A2)"
        );
    }

    #[test]
    fn unresolved_names_are_not_ranges() {
        let workbook = Workbook::blank().unwrap().0;
        let record = NameRecord {
            id: "id".to_string(),
            name: "Alias".to_string(),
            refers_to: "=OtherName".to_string(),
            raw_refers_to: None,
            scope: None,
            comment: None,
            visible: true,
            ..Default::default()
        };
        assert!(resolve_name_range(&workbook, &record).unwrap().is_none());
    }

    #[test]
    fn explicit_range_uses_a1_canonical_address() {
        let workbook = Workbook::blank().unwrap().0;
        let record = NameRecord {
            id: "id".to_string(),
            name: "Area".to_string(),
            refers_to: "=Sheet1!$b$2:$D$3".to_string(),
            raw_refers_to: None,
            scope: None,
            comment: None,
            visible: true,
            ..Default::default()
        };
        let range = resolve_name_range(&workbook, &record).unwrap().unwrap();
        assert_eq!(range.address(), "B2:D3");
        assert_eq!(range.display_address().unwrap(), "Sheet1!B2:D3");
    }

    #[test]
    fn production_defined_name_fields_use_camel_case_and_keep_identity_opaque() {
        let record = NameRecord::from_value(json!({
            "id": "id",
            "name": "Sales",
            "refersTo": "{\"template\":\"A1\",\"refs\":[]}",
            "rawRefersTo": null,
            "scope": "sheet-id",
            "comment": "note",
            "customMenu": "menu",
            "statusBar": "status",
            "visible": false,
            "linkedRangeId": "range-id"
        }))
        .unwrap();

        assert_eq!(record.custom_menu.as_deref(), Some("menu"));
        assert_eq!(record.status_bar.as_deref(), Some("status"));
        assert_eq!(record.linked_range_id, Some(json!("range-id")));
        assert!(record_formula(&record).is_none());
    }
}
