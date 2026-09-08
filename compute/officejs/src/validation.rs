//! Office.js Range.dataValidation backed by the durable sheet validation API.
//!
//! The Office object model exposes one data-validation object for a range while
//! the compute engine stores a RangeSchema. This module is the translation
//! boundary between those two representations. It deliberately keeps the
//! wire-facing representation in serde_json::Value: the Office.js host only
//! needs the public compute_api::SheetValidation methods and does not need to
//! duplicate the domain type hierarchy.

use std::collections::{HashMap, HashSet};

use compute_api::{CellRange, ComputeApiError, Sheet};
use serde_json::{Map, Value, json};
use value_types::CellValue;

/// Error returned by an Office.js data-validation host operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidationError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// A data-validation proxy anchored to one bounded worksheet range.
///
/// The range itself remains the source of truth for the object path. Every
/// read resolves the current durable range schemas, so a fresh proxy sees
/// validation mutations made by an earlier request context.
#[derive(Clone)]
pub(crate) struct ValidationRef {
    sheet: Sheet,
    address: String,
}

#[derive(Clone)]
struct SchemaCandidate {
    id: String,
    value: Value,
    ranges: Vec<Bounds>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl ValidationRef {
    /// Create a validation proxy for a bounded A1 range.
    pub(crate) fn new(sheet: Sheet, address: impl Into<String>) -> Result<Self, ValidationError> {
        let address = address.into();
        CellRange::from(address.as_str())
            .resolve()
            .map_err(|error| invalid(error.to_string()))?;
        Ok(Self { sheet, address })
    }

    /// Load Office-shaped scalar properties.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ValidationError> {
        let candidates = self.candidates()?;
        let selected = select_candidate(&candidates, self.bounds()?);
        let mut result = HashMap::new();

        for property in properties {
            let value = match property.as_str() {
                "errorAlert" => office_error_alert(selected)?,
                "ignoreBlanks" => office_ignore_blanks(selected),
                "prompt" => office_prompt(selected)?,
                "rule" => office_rule(selected)?,
                "type" => office_type(selected)?,
                "valid" => self.office_valid(selected)?,
                other => {
                    return Err(unsupported(format!(
                        "Unsupported DataValidation load property '{other}'"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Apply one Office.js scalar property.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ValidationError> {
        if property == "clear" {
            if !value.is_null() {
                return Err(invalid("DataValidation.clear does not accept a value"));
            }
            return self.clear();
        }

        let bounds = self.bounds()?;
        let candidates = self.candidates()?;
        let selected = select_candidate(&candidates, bounds);
        if selected.is_some_and(|candidate| candidate.ranges.len() != 1) {
            return Err(invalid(
                "DataValidation cannot update a schema shared by multiple ranges",
            ));
        }

        let mut state = match selected.as_ref() {
            Some(candidate) => office_state_from_schema(&candidate.value)?,
            None => default_office_state(),
        };

        match property {
            "rule" => {
                let normalized = normalize_rule_value(value)?;
                if normalized
                    .as_object()
                    .is_some_and(|object| object.is_empty())
                {
                    return self.clear();
                }
                state.insert("rule".to_string(), normalized);
            }
            "ignoreBlanks" => {
                state.insert(
                    "ignoreBlanks".to_string(),
                    value
                        .as_bool()
                        .map(Value::Bool)
                        .ok_or_else(|| invalid("DataValidation.ignoreBlanks must be a boolean"))?,
                );
            }
            "errorAlert" => {
                state.insert("errorAlert".to_string(), normalize_error_alert(value)?);
            }
            "prompt" => {
                state.insert("prompt".to_string(), normalize_prompt(value)?);
            }
            "type" | "valid" => {
                return Err(invalid(format!("DataValidation.{property} is read-only")));
            }
            other => {
                return Err(unsupported(format!(
                    "Unsupported DataValidation property '{other}'"
                )));
            }
        }

        let schema_id = selected
            .as_ref()
            .map(|candidate| candidate.id.clone())
            .unwrap_or_else(|| schema_id_for(bounds));

        // The canonical range-backed engine cannot split a larger existing
        // validation rule when Office.js targets only a subset of it. Refuse
        // that ambiguous update rather than leaving the requested property
        // apparently applied while a different rule still wins evaluation.
        if let Some(candidate) = selected.as_ref()
            && !candidate.ranges.iter().any(|range| *range == bounds)
        {
            return Err(invalid(
                "DataValidation cannot replace only part of an existing validation range",
            ));
        }

        let schema_value = office_state_to_schema(&schema_id, bounds, &state)?;
        let schema = serde_json::from_value(schema_value).map_err(encoding)?;
        self.sheet
            .validation()
            .set_range_schema(schema)
            .map_err(engine)?;
        Ok(())
    }

    /// Remove the validation rule(s) that exactly cover this range.
    pub(crate) fn clear(&self) -> Result<(), ValidationError> {
        let bounds = self.bounds()?;
        let candidates = self.candidates()?;
        let mut exact_ids = Vec::new();
        for candidate in candidates {
            if candidate.ranges.iter().any(|range| *range == bounds) {
                if candidate.ranges.len() != 1 {
                    return Err(invalid(
                        "DataValidation cannot clear a schema shared by multiple ranges",
                    ));
                }
                exact_ids.push(candidate.id);
            } else if candidate.ranges.iter().any(|range| range.contains(bounds)) {
                return Err(invalid(
                    "DataValidation cannot clear only part of an existing validation range",
                ));
            }
        }

        let mut seen = HashSet::new();
        for id in exact_ids {
            if seen.insert(id.clone()) {
                self.sheet
                    .validation()
                    .delete_range_schema(&id)
                    .map_err(engine)?;
            }
        }
        Ok(())
    }

    fn bounds(&self) -> Result<Bounds, ValidationError> {
        let (start_row, start_col, end_row, end_col) = CellRange::from(self.address.as_str())
            .resolve()
            .map_err(|error| invalid(error.to_string()))?;
        Ok(Bounds {
            start_row,
            start_col,
            end_row,
            end_col,
        })
    }

    fn candidates(&self) -> Result<Vec<SchemaCandidate>, ValidationError> {
        self.sheet
            .validation()
            .get_range_schemas()
            .map_err(engine)?
            .into_iter()
            .map(|schema| {
                let value = serde_json::to_value(schema).map_err(encoding)?;
                let id = value
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| encoding_message("range schema has no id"))?
                    .to_string();
                let ranges = parse_schema_ranges(&value)?;
                Ok(SchemaCandidate { id, value, ranges })
            })
            .collect()
    }

    fn office_valid(&self, selected: Option<&SchemaCandidate>) -> Result<Value, ValidationError> {
        let Some(_selected) = selected else {
            return Ok(Value::Bool(true));
        };
        let invalid_cells = self.invalid_cells_for_selected()?;
        if invalid_cells.is_empty() {
            return Ok(Value::Bool(true));
        }

        let bounds = self.bounds()?;
        let cell_count = (bounds.end_row - bounds.start_row + 1) as usize
            * (bounds.end_col - bounds.start_col + 1) as usize;
        if invalid_cells.len() == cell_count {
            return Ok(Value::Bool(false));
        }

        Ok(Value::Null)
    }

    /// Return the coordinates whose current values fail the durable
    /// validation engine for this DataValidation range.
    ///
    /// This deliberately asks the engine to validate every cell instead of
    /// decoding the stored rule in the Office.js adapter. In particular, the
    /// engine owns blank handling, list membership, custom formulas, and
    /// relative formula references.
    pub(crate) fn invalid_cells(&self) -> Result<Vec<(u32, u32)>, ValidationError> {
        let bounds = self.bounds()?;
        let candidates = self.candidates()?;
        let selected = select_candidate(&candidates, bounds);
        let Some(selected) = selected else {
            return Ok(Vec::new());
        };
        self.invalid_cells_for_selected()
    }

    fn invalid_cells_for_selected(&self) -> Result<Vec<(u32, u32)>, ValidationError> {
        let bounds = self.bounds()?;
        let values = self
            .sheet
            .get_range_values_2d(CellRange::Bounds(
                bounds.start_row,
                bounds.start_col,
                bounds.end_row,
                bounds.end_col,
            ))
            .map_err(engine)?;
        let mut invalid_cells = Vec::new();
        for (row_offset, row_values) in values.into_iter().enumerate() {
            for (col_offset, value) in row_values.into_iter().enumerate() {
                let row = bounds.start_row + row_offset as u32;
                let col = bounds.start_col + col_offset as u32;
                let text = validation_text(&value);
                let result = self
                    .sheet
                    .validation()
                    .validate_cell_value(row, col, &text)
                    .map_err(engine)?;
                if !result.valid {
                    invalid_cells.push((row, col));
                }
            }
        }
        Ok(invalid_cells)
    }
}

fn default_office_state() -> Map<String, Value> {
    Map::from_iter([
        (
            "errorAlert".to_string(),
            json!({
                "message": "",
                "showAlert": true,
                "style": "Stop",
                "title": ""
            }),
        ),
        ("ignoreBlanks".to_string(), Value::Bool(true)),
        (
            "prompt".to_string(),
            json!({"message": "", "showPrompt": false, "title": ""}),
        ),
        ("rule".to_string(), json!({})),
    ])
}

fn office_error_alert(selected: Option<&SchemaCandidate>) -> Result<Value, ValidationError> {
    let Some(selected) = selected else {
        return Ok(default_office_state()["errorAlert"].clone());
    };
    Ok(office_state_from_schema(&selected.value)?["errorAlert"].clone())
}

fn office_ignore_blanks(selected: Option<&SchemaCandidate>) -> Value {
    selected
        .and_then(|candidate| candidate.value.pointer("/schema/constraints/allowBlank"))
        .and_then(Value::as_bool)
        .map(Value::Bool)
        .unwrap_or(Value::Bool(true))
}

fn office_prompt(selected: Option<&SchemaCandidate>) -> Result<Value, ValidationError> {
    let Some(selected) = selected else {
        return Ok(default_office_state()["prompt"].clone());
    };
    Ok(office_state_from_schema(&selected.value)?["prompt"].clone())
}

fn office_rule(selected: Option<&SchemaCandidate>) -> Result<Value, ValidationError> {
    let Some(selected) = selected else {
        return Ok(json!({}));
    };
    Ok(office_state_from_schema(&selected.value)?["rule"].clone())
}

fn office_type(selected: Option<&SchemaCandidate>) -> Result<Value, ValidationError> {
    let Some(selected) = selected else {
        return Ok(json!("None"));
    };
    let Some((kind, _)) = schema_type_to_office(
        selected.value.pointer("/schema/type"),
        selected.value.pointer("/schema/constraints"),
    ) else {
        if selected.value.pointer("/schema/type").is_none() {
            return Ok(json!("None"));
        }
        return Err(invalid(
            "The stored validation schema type is not supported by Office.js",
        ));
    };
    Ok(json!(kind))
}

fn select_candidate<'a>(
    candidates: &'a [SchemaCandidate],
    target: Bounds,
) -> Option<&'a SchemaCandidate> {
    candidates
        .iter()
        .find(|candidate| candidate.ranges.iter().any(|range| *range == target))
        .or_else(|| {
            candidates
                .iter()
                .find(|candidate| candidate.ranges.iter().any(|range| range.contains(target)))
        })
}

fn parse_schema_ranges(value: &Value) -> Result<Vec<Bounds>, ValidationError> {
    let ranges = value
        .get("ranges")
        .and_then(Value::as_array)
        .ok_or_else(|| encoding_message("range schema has no ranges"))?;
    ranges.iter().map(parse_identity_range).collect()
}

fn parse_identity_range(value: &Value) -> Result<Bounds, ValidationError> {
    let start = value
        .get("startId")
        .and_then(Value::as_str)
        .ok_or_else(|| encoding_message("range schema range has no startId"))?;
    let end = value
        .get("endId")
        .and_then(Value::as_str)
        .ok_or_else(|| encoding_message("range schema range has no endId"))?;
    let (start_row, start_col) = parse_identity_cell(start)?;
    let (end_row, end_col) = parse_identity_cell(end)?;
    Ok(Bounds {
        start_row: start_row.min(end_row),
        start_col: start_col.min(end_col),
        end_row: start_row.max(end_row),
        end_col: start_col.max(end_col),
    })
}

fn parse_identity_cell(value: &str) -> Result<(u32, u32), ValidationError> {
    let (row, col) = value
        .split_once(':')
        .ok_or_else(|| encoding_message(format!("invalid identity cell '{value}'")))?;
    let row = row
        .parse::<u32>()
        .map_err(|_| encoding_message(format!("invalid identity row '{row}'")))?;
    let col = col
        .parse::<u32>()
        .map_err(|_| encoding_message(format!("invalid identity column '{col}'")))?;
    Ok((row, col))
}

impl Bounds {
    fn contains(self, other: Self) -> bool {
        self.start_row <= other.start_row
            && self.start_col <= other.start_col
            && self.end_row >= other.end_row
            && self.end_col >= other.end_col
    }
}

fn office_state_from_schema(value: &Value) -> Result<Map<String, Value>, ValidationError> {
    let mut state = default_office_state();
    state.insert(
        "ignoreBlanks".to_string(),
        value
            .pointer("/schema/constraints/allowBlank")
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or(Value::Bool(true)),
    );

    let style = match value.pointer("/enforcement").and_then(Value::as_str) {
        Some("warning") | Some("Warning") => "Warning",
        Some("info") | Some("Info") => "Information",
        Some("none") | Some("None") => "Information",
        _ => "Stop",
    };
    let error = value.pointer("/ui/errorMessage");
    // RangeSchema's durable conversion currently represents a missing
    // message as the engine's default `show_error=true`; the schema has no
    // independent false bit. Treat absent UI text as that default so a later
    // property update does not accidentally fail on a fabricated false flag.
    let show_alert = true;
    state.insert(
        "errorAlert".to_string(),
        json!({
            "message": error.and_then(|v| v.get("message")).and_then(Value::as_str).unwrap_or(""),
            "showAlert": show_alert,
            "style": style,
            "title": error.and_then(|v| v.get("title")).and_then(Value::as_str).unwrap_or(""),
        }),
    );

    let prompt = value.pointer("/ui/inputMessage");
    state.insert(
        "prompt".to_string(),
        json!({
            "message": prompt.and_then(|v| v.get("message")).and_then(Value::as_str).unwrap_or(""),
            "showPrompt": prompt.is_some(),
            "title": prompt.and_then(|v| v.get("title")).and_then(Value::as_str).unwrap_or(""),
        }),
    );

    let constraints = value.pointer("/schema/constraints");
    let Some((kind, rule)) = schema_type_to_office(value.pointer("/schema/type"), constraints)
    else {
        let is_empty_rule = value.pointer("/schema/type").is_none()
            && constraints
                .and_then(Value::as_object)
                .is_none_or(|constraints| constraints.keys().all(|key| key == "allowBlank"));
        if is_empty_rule {
            state.insert("rule".to_string(), json!({}));
            return Ok(state);
        }
        return Err(invalid(
            "The stored validation rule is not supported by Office.js",
        ));
    };
    let _ = kind;
    state.insert("rule".to_string(), rule);

    if let Some(list) = state
        .get_mut("rule")
        .and_then(Value::as_object_mut)
        .and_then(|rule| rule.get_mut("list"))
        .and_then(Value::as_object_mut)
    {
        let dropdown = value
            .pointer("/ui/showDropdown")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        list.insert("inCellDropDown".to_string(), Value::Bool(dropdown));
    }
    Ok(state)
}

fn schema_type_to_office(
    schema_type: Option<&Value>,
    constraints: Option<&Value>,
) -> Option<(&'static str, Value)> {
    let constraints = constraints.and_then(Value::as_object);
    if let Some(values) = constraints
        .and_then(|c| c.get("enum"))
        .and_then(Value::as_array)
    {
        let source = values
            .iter()
            .map(|value| value.as_str().unwrap_or_default())
            .collect::<Vec<_>>()
            .join(",");
        return Some((
            "List",
            json!({
                "list": {
                    "inCellDropDown": true,
                    "source": source,
                }
            }),
        ));
    }
    if let Some(source) = constraints
        .and_then(|c| c.get("enumSource"))
        .and_then(identity_range_to_a1)
    {
        return Some((
            "List",
            json!({
                "list": {"inCellDropDown": true, "source": format!("={source}")}
            }),
        ));
    }
    if let Some(source) = constraints
        .and_then(|c| c.get("enumSourceFormula"))
        .and_then(Value::as_str)
    {
        return Some((
            "List",
            json!({
                "list": {"inCellDropDown": true, "source": source}
            }),
        ));
    }
    if let Some(formula) = constraints
        .and_then(|c| c.get("formula"))
        .and_then(Value::as_str)
    {
        return Some(("Custom", json!({"custom": {"formula": formula}})));
    }

    let schema_type = schema_type?.as_str()?;
    match schema_type {
        "integer" | "Integer" => numeric_rule("WholeNumber", constraints),
        "number" | "currency" | "percentage" | "Number" | "Currency" | "Percentage" => {
            numeric_rule("Decimal", constraints)
        }
        "date" | "Date" => numeric_rule("Date", constraints),
        "time" | "Time" => numeric_rule("Time", constraints),
        "string" | "String" => length_rule(constraints),
        _ => None,
    }
}

fn numeric_rule(
    kind: &'static str,
    constraints: Option<&Map<String, Value>>,
) -> Option<(&'static str, Value)> {
    let (operator, formula1, formula2) = numeric_operator(constraints)?;
    let key = match kind {
        "WholeNumber" => "wholeNumber",
        "Decimal" => "decimal",
        "Date" => "date",
        "Time" => "time",
        _ => return None,
    };
    let mut rule = Map::new();
    rule.insert("operator".to_string(), json!(operator));
    rule.insert("formula1".to_string(), json!(formula1));
    if let Some(formula2) = formula2 {
        rule.insert("formula2".to_string(), json!(formula2));
    }
    Some((
        kind,
        Value::Object(Map::from_iter([(key.to_string(), Value::Object(rule))])),
    ))
}

fn length_rule(constraints: Option<&Map<String, Value>>) -> Option<(&'static str, Value)> {
    let (operator, formula1, formula2) = length_operator(constraints)?;
    let mut rule = Map::new();
    rule.insert("operator".to_string(), json!(operator));
    rule.insert("formula1".to_string(), json!(formula1));
    if let Some(formula2) = formula2 {
        rule.insert("formula2".to_string(), json!(formula2));
    }
    Some(("TextLength", json!({"textLength": rule})))
}

fn numeric_operator(
    constraints: Option<&Map<String, Value>>,
) -> Option<(&'static str, String, Option<String>)> {
    let c = constraints?;
    if let Some(value) = office_formula_bound(c, "equal") {
        return Some(("EqualTo", value, None));
    }
    if let Some(value) = office_formula_bound(c, "notEqual") {
        return Some(("NotEqualTo", value, None));
    }
    if let (Some(lo), Some(hi)) = (
        office_formula_bound(c, "notBetweenMin"),
        office_formula_bound(c, "notBetweenMax"),
    ) {
        return Some(("NotBetween", lo, Some(hi)));
    }
    if let (Some(lo), Some(hi)) = (
        office_formula_bound(c, "min"),
        office_formula_bound(c, "max"),
    ) {
        return Some(("Between", lo, Some(hi)));
    }
    if let Some(value) = office_formula_bound(c, "exclusiveMin") {
        return Some(("GreaterThan", value, None));
    }
    if let Some(value) = office_formula_bound(c, "min") {
        return Some(("GreaterThanOrEqualTo", value, None));
    }
    if let Some(value) = office_formula_bound(c, "exclusiveMax") {
        return Some(("LessThan", value, None));
    }
    if let Some(value) = office_formula_bound(c, "max") {
        return Some(("LessThanOrEqualTo", value, None));
    }
    None
}

fn length_operator(
    constraints: Option<&Map<String, Value>>,
) -> Option<(&'static str, String, Option<String>)> {
    let c = constraints?;
    if let (Some(lo), Some(hi)) = (
        office_formula_bound(c, "minLength"),
        office_formula_bound(c, "maxLength"),
    ) {
        return Some(("Between", lo, Some(hi)));
    }
    if let Some(value) = office_formula_bound(c, "minLength") {
        return Some(("GreaterThanOrEqualTo", value, None));
    }
    if let Some(value) = office_formula_bound(c, "maxLength") {
        return Some(("LessThanOrEqualTo", value, None));
    }
    None
}

fn formula_number(value: &Value) -> Option<String> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .map(|value| format!("={value}"))
}

fn office_formula_bound(constraints: &Map<String, Value>, key: &str) -> Option<String> {
    constraints
        .get("formulaBounds")
        .and_then(Value::as_object)
        .and_then(|bounds| bounds.get(key))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| constraints.get(key).and_then(formula_number))
}

fn identity_range_to_a1(value: &Value) -> Option<String> {
    let start = value.get("startId")?.as_str()?;
    let end = value.get("endId")?.as_str()?;
    let (sr, sc) = parse_identity_cell(start).ok()?;
    let (er, ec) = parse_identity_cell(end).ok()?;
    let start = a1_cell(sr, sc);
    let end = a1_cell(er, ec);
    Some(if start == end {
        start
    } else {
        format!("{start}:{end}")
    })
}

fn a1_cell(row: u32, col: u32) -> String {
    let mut col = col + 1;
    let mut letters = Vec::new();
    while col > 0 {
        let rem = ((col - 1) % 26) as u8;
        letters.push((b'A' + rem) as char);
        col = (col - 1) / 26;
    }
    letters.reverse();
    format!("{}{}", letters.into_iter().collect::<String>(), row + 1)
}

fn office_state_to_schema(
    id: &str,
    bounds: Bounds,
    state: &Map<String, Value>,
) -> Result<Value, ValidationError> {
    let rule = state
        .get("rule")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("DataValidation.rule must be an object"))?;
    if rule.is_empty() {
        return Err(invalid(
            "DataValidation.rule must contain one validation type",
        ));
    }

    let (schema_type, constraints) = rule_to_schema(rule)?;
    let allow_blank = state
        .get("ignoreBlanks")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("DataValidation.ignoreBlanks must be a boolean"))?;
    let error = state
        .get("errorAlert")
        .ok_or_else(|| invalid("DataValidation.errorAlert must be an object"))?;
    let error = normalize_error_alert(error)?;
    let show_alert = error
        .get("showAlert")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !show_alert {
        // RangeSchema currently has no show-error bit. Rejecting this state is
        // preferable to silently changing it to an enabled alert on reload.
        return Err(invalid(
            "DataValidation.errorAlert.showAlert=false cannot be persisted by the validation engine",
        ));
    }
    let style = error
        .get("style")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("DataValidation.errorAlert.style must be a string enum value"))?;
    let enforcement = match style {
        "Stop" => "strict",
        "Warning" => "warning",
        "Information" => "info",
        other => {
            return Err(invalid(format!(
                "Unsupported DataValidation alert style '{other}'"
            )));
        }
    };
    let prompt = state
        .get("prompt")
        .ok_or_else(|| invalid("DataValidation.prompt must be an object"))?;
    let prompt = normalize_prompt(prompt)?;
    let show_prompt = prompt
        .get("showPrompt")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !show_prompt
        && (prompt
            .get("message")
            .and_then(Value::as_str)
            .is_some_and(|message| !message.is_empty())
            || prompt
                .get("title")
                .and_then(Value::as_str)
                .is_some_and(|title| !title.is_empty()))
    {
        return Err(invalid(
            "DataValidation.prompt.message/title cannot be persisted when showPrompt=false",
        ));
    }

    let mut constraint_map = constraints.unwrap_or_default();
    constraint_map.insert("allowBlank".to_string(), Value::Bool(allow_blank));
    let mut ui = Map::new();
    ui.insert(
        "errorMessage".to_string(),
        json!({
            "title": error.get("title").and_then(Value::as_str).unwrap_or(""),
            "message": error.get("message").and_then(Value::as_str).unwrap_or(""),
        }),
    );
    if show_prompt {
        ui.insert(
            "inputMessage".to_string(),
            json!({
                "title": prompt.get("title").and_then(Value::as_str).unwrap_or(""),
                "message": prompt.get("message").and_then(Value::as_str).unwrap_or(""),
            }),
        );
    }
    if let Some(list) = rule.get("list").and_then(Value::as_object) {
        let dropdown = list
            .get("inCellDropDown")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("DataValidation.list.inCellDropDown must be a boolean"))?;
        ui.insert("showDropdown".to_string(), Value::Bool(dropdown));
    }

    Ok(json!({
        "id": id,
        "createdAt": 0,
        "ranges": [{
            "startId": format!("{}:{}", bounds.start_row, bounds.start_col),
            "endId": format!("{}:{}", bounds.end_row, bounds.end_col),
        }],
        "schema": {
            "type": schema_type,
            "constraints": constraint_map,
        },
        "enforcement": enforcement,
        "ui": ui,
    }))
}

fn rule_to_schema(
    rule: &Map<String, Value>,
) -> Result<(Value, Option<Map<String, Value>>), ValidationError> {
    let allowed = [
        "wholeNumber",
        "decimal",
        "date",
        "time",
        "textLength",
        "list",
        "custom",
    ];
    let unknown = rule.keys().find(|key| !allowed.contains(&key.as_str()));
    if let Some(unknown) = unknown {
        return Err(invalid(format!(
            "Unsupported DataValidation.rule property '{unknown}'"
        )));
    }
    if rule.len() != 1 {
        return Err(invalid(
            "DataValidation.rule must contain exactly one validation type",
        ));
    }
    if let Some(value) = rule.get("wholeNumber") {
        return basic_rule_to_schema("integer", value);
    }
    if let Some(value) = rule.get("decimal") {
        return basic_rule_to_schema("number", value);
    }
    if let Some(value) = rule.get("date") {
        return basic_rule_to_schema("date", value);
    }
    if let Some(value) = rule.get("time") {
        return basic_rule_to_schema("time", value);
    }
    if let Some(value) = rule.get("textLength") {
        return basic_rule_to_schema("string", value);
    }
    if let Some(value) = rule.get("list") {
        return list_rule_to_schema(value);
    }
    let custom = rule
        .get("custom")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("DataValidation.custom must be an object"))?;
    let formula = required_string(custom, "formula", "DataValidation.custom.formula")?;
    Ok((
        Value::Null,
        Some(Map::from_iter([(
            "formula".to_string(),
            Value::String(formula),
        )])),
    ))
}

fn basic_rule_to_schema(
    schema_type: &'static str,
    value: &Value,
) -> Result<(Value, Option<Map<String, Value>>), ValidationError> {
    let object = value.as_object().ok_or_else(|| {
        invalid(format!(
            "DataValidation rule '{schema_type}' must be an object"
        ))
    })?;
    let allowed = ["formula1", "formula2", "operator"];
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(invalid(format!(
                "Unsupported DataValidation rule property '{key}'"
            )));
        }
    }
    let operator = required_string(object, "operator", "DataValidation rule operator")?;
    let formula1 = object
        .get("formula1")
        .ok_or_else(|| invalid("DataValidation rule requires formula1"))?;
    let formula2 = object.get("formula2");
    let constraints = match schema_type {
        "string" => length_constraints(&operator, formula1, formula2)?,
        "date" => numeric_constraints(&operator, formula1, formula2, DateKind::Date)?,
        "time" => numeric_constraints(&operator, formula1, formula2, DateKind::Time)?,
        _ => numeric_constraints(&operator, formula1, formula2, DateKind::Number)?,
    };
    Ok((json!(schema_type), Some(constraints)))
}

fn list_rule_to_schema(
    value: &Value,
) -> Result<(Value, Option<Map<String, Value>>), ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation.list must be an object"))?;
    for key in object.keys() {
        if key != "source" && key != "inCellDropDown" {
            return Err(invalid(format!(
                "Unsupported DataValidation.list property '{key}'"
            )));
        }
    }
    object
        .get("inCellDropDown")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("DataValidation.list.inCellDropDown must be a boolean"))?;
    let source = object
        .get("source")
        .ok_or_else(|| invalid("DataValidation.list requires source"))?;
    let source = source
        .as_str()
        .ok_or_else(|| invalid("DataValidation.list.source must be a string"))?;
    if source.is_empty() {
        return Err(invalid("DataValidation.list.source cannot be empty"));
    }

    let mut constraints = Map::new();
    if let Some(range) = source.strip_prefix('=')
        && let Ok((sr, sc, er, ec)) = CellRange::from(range).resolve()
    {
        constraints.insert(
            "enumSource".to_string(),
            json!({
                "startId": format!("{sr}:{sc}"),
                "endId": format!("{er}:{ec}"),
            }),
        );
    } else if source.starts_with('=') {
        constraints.insert(
            "enumSourceFormula".to_string(),
            Value::String(source.to_string()),
        );
    } else {
        constraints.insert(
            "enum".to_string(),
            Value::Array(
                source
                    .split(',')
                    .map(|item| Value::String(item.to_string()))
                    .collect(),
            ),
        );
    }
    Ok((Value::Null, Some(constraints)))
}

#[derive(Clone, Copy)]
enum DateKind {
    Number,
    Date,
    Time,
}

enum ParsedBound {
    Literal(f64),
    Formula(String),
}

fn parse_bound(
    value: &Value,
    date_kind: DateKind,
    _property: &str,
) -> Result<ParsedBound, ValidationError> {
    if let Some(number) = value.as_f64() {
        if number.is_finite() {
            return Ok(ParsedBound::Literal(number));
        }
        return Err(invalid("DataValidation bound must be finite"));
    }

    let Some(raw) = value.as_str() else {
        return Err(invalid(
            "DataValidation bound must be a finite number or formula string",
        ));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("DataValidation bound cannot be empty"));
    }

    let has_formula_prefix = trimmed.starts_with('=');
    let raw = trimmed.strip_prefix('=').unwrap_or(trimmed).trim();
    // An ISO date/time without `=` is a literal accepted by the DateTime
    // contract. Once the caller supplies `=`, retain the expression so
    // arithmetic such as `=2024-01-01` is evaluated by the production engine
    // instead of being mistaken for the literal date 2024-01-01.
    let parsed = if has_formula_prefix {
        None
    } else {
        match date_kind {
            DateKind::Number => raw.parse::<f64>().ok().filter(|number| number.is_finite()),
            DateKind::Date => parse_date_bound(raw),
            DateKind::Time => parse_time_bound(raw),
        }
    };
    Ok(parsed.map_or_else(
        || ParsedBound::Formula(formula_text(trimmed)),
        ParsedBound::Literal,
    ))
}

fn formula_text(value: &str) -> String {
    let value = value.trim();
    if value.starts_with('=') {
        value.to_string()
    } else {
        format!("={value}")
    }
}

fn parse_date_bound(raw: &str) -> Option<f64> {
    // JavaScript Date values arrive as ISO UTC strings. The durable date
    // parser intentionally accepts Excel-style date text, so preserve the
    // calendar date and discard the transport-only time suffix.
    let date_text = raw.split_once('T').map_or(raw, |(date, _)| date);
    value_types::date_serial::try_parse_date(date_text)
        .ok()
        .or_else(|| {
            let normalized = raw
                .trim_end_matches('Z')
                .split_once('.')
                .map_or(raw, |(value, _)| value)
                .replace('T', " ");
            value_types::date_serial::try_parse_datetime(&normalized)
                .ok()
                .map(f64::floor)
        })
}

fn parse_time_bound(raw: &str) -> Option<f64> {
    // JavaScript Date values carry a full date. For time validation only the
    // clock component participates in the constraint.
    let time_text = raw
        .split_once('T')
        .map(|(_, time)| time)
        .or_else(|| raw.split_once(' ').map(|(_, time)| time))
        .unwrap_or(raw)
        .trim_end_matches('Z');
    let time_text = time_text
        .split_once('.')
        .map_or(time_text, |(value, _)| value);
    let time_text = time_text
        .find(|character| matches!(character, '+' | '-'))
        .map_or(time_text, |offset| &time_text[..offset]);
    value_types::date_serial::try_parse_time(time_text).ok()
}

fn non_negative_integer(value: f64, property: &str) -> Result<usize, ValidationError> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 {
        return Err(invalid(format!(
            "DataValidation.{property} must be a non-negative integer"
        )));
    }
    if value > usize::MAX as f64 {
        return Err(invalid(format!("DataValidation.{property} is too large")));
    }
    Ok(value as usize)
}

fn numeric_constraints(
    operator: &str,
    formula1: &Value,
    formula2: Option<&Value>,
    date_kind: DateKind,
) -> Result<Map<String, Value>, ValidationError> {
    if formula2.is_some() && !matches!(operator, "Between" | "NotBetween") {
        return Err(invalid(
            "formula2 is only valid with Between or NotBetween operators",
        ));
    }
    let first = parse_bound(formula1, date_kind, "formula1")?;
    let second = formula2
        .map(|value| parse_bound(value, date_kind, "formula2"))
        .transpose()?;
    let mut constraints = Map::new();
    match operator {
        "Between" => {
            let second = second.ok_or_else(|| invalid("Between requires formula2"))?;
            insert_bound(&mut constraints, "min", first);
            insert_bound(&mut constraints, "max", second);
        }
        "NotBetween" => {
            let second = second.ok_or_else(|| invalid("NotBetween requires formula2"))?;
            insert_bound(&mut constraints, "notBetweenMin", first);
            insert_bound(&mut constraints, "notBetweenMax", second);
        }
        "EqualTo" => {
            insert_bound(&mut constraints, "equal", first);
        }
        "NotEqualTo" => {
            insert_bound(&mut constraints, "notEqual", first);
        }
        "GreaterThan" => {
            insert_bound(&mut constraints, "exclusiveMin", first);
        }
        "GreaterThanOrEqualTo" => {
            insert_bound(&mut constraints, "min", first);
        }
        "LessThan" => {
            insert_bound(&mut constraints, "exclusiveMax", first);
        }
        "LessThanOrEqualTo" => {
            insert_bound(&mut constraints, "max", first);
        }
        other => {
            return Err(invalid(format!(
                "Unsupported DataValidation operator '{other}'"
            )));
        }
    }
    Ok(constraints)
}

fn length_constraints(
    operator: &str,
    formula1: &Value,
    formula2: Option<&Value>,
) -> Result<Map<String, Value>, ValidationError> {
    if formula2.is_some() && !matches!(operator, "Between" | "NotBetween") {
        return Err(invalid(
            "formula2 is only valid with Between or NotBetween operators",
        ));
    }
    let first = parse_bound(formula1, DateKind::Number, "formula1")?;
    let first = match first {
        ParsedBound::Literal(value) => {
            ParsedBound::Literal(non_negative_integer(value, "formula1")? as f64)
        }
        ParsedBound::Formula(value) => ParsedBound::Formula(value),
    };
    let second = formula2
        .map(|value| parse_bound(value, DateKind::Number, "formula2"))
        .transpose()?;
    let second = second.map(|value| match value {
        ParsedBound::Literal(value) => {
            non_negative_integer(value, "formula2").map(|value| ParsedBound::Literal(value as f64))
        }
        ParsedBound::Formula(value) => Ok(ParsedBound::Formula(value)),
    });
    let second = second.transpose()?;
    let mut constraints = Map::new();
    match operator {
        "Between" => {
            let second = second.ok_or_else(|| invalid("Between requires formula2"))?;
            insert_bound(&mut constraints, "minLength", first);
            insert_bound(&mut constraints, "maxLength", second);
        }
        "GreaterThanOrEqualTo" => {
            insert_bound(&mut constraints, "minLength", first);
        }
        "LessThanOrEqualTo" => {
            insert_bound(&mut constraints, "maxLength", first);
        }
        other => {
            return Err(invalid(format!(
                "Unsupported TextLength operator '{other}'"
            )));
        }
    }
    Ok(constraints)
}

fn insert_bound(constraints: &mut Map<String, Value>, key: &str, bound: ParsedBound) {
    match bound {
        ParsedBound::Literal(value) => {
            constraints.insert(key.to_string(), json!(value));
        }
        ParsedBound::Formula(formula) => {
            constraints
                .entry("formulaBounds".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(bounds) = constraints
                .get_mut("formulaBounds")
                .and_then(Value::as_object_mut)
            {
                bounds.insert(key.to_string(), Value::String(formula));
            }
        }
    }
}

fn normalize_rule_value(value: &Value) -> Result<Value, ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation.rule must be an object"))?;
    let mut output = Map::new();
    for (kind, raw) in object {
        let normalized = match kind.as_str() {
            "wholeNumber" | "decimal" | "date" | "time" | "textLength" => {
                normalize_basic_rule(raw)?
            }
            "list" => normalize_list_rule(raw)?,
            "custom" => {
                let custom = raw
                    .as_object()
                    .ok_or_else(|| invalid("DataValidation.custom must be an object"))?;
                for key in custom.keys() {
                    if key != "formula" {
                        return Err(invalid(format!(
                            "Unsupported DataValidation.custom property '{key}'"
                        )));
                    }
                }
                let formula = required_string(custom, "formula", "DataValidation.custom.formula")?;
                json!({"formula": formula})
            }
            other => {
                return Err(invalid(format!(
                    "Unsupported DataValidation.rule property '{other}'"
                )));
            }
        };
        output.insert(kind.clone(), normalized);
    }
    if output.len() > 1 {
        return Err(invalid(
            "DataValidation.rule must contain exactly one validation type",
        ));
    }
    Ok(Value::Object(output))
}

fn normalize_basic_rule(value: &Value) -> Result<Value, ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation rule criteria must be an object"))?;
    for key in object.keys() {
        if key != "formula1" && key != "formula2" && key != "operator" {
            return Err(invalid(format!(
                "Unsupported DataValidation rule property '{key}'"
            )));
        }
    }
    let mut output = Map::new();
    for key in ["formula1", "formula2", "operator"] {
        if let Some(value) = object.get(key) {
            output.insert(key.to_string(), value.clone());
        }
    }
    Ok(Value::Object(output))
}

fn normalize_list_rule(value: &Value) -> Result<Value, ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation.list must be an object"))?;
    for key in object.keys() {
        if key != "source" && key != "inCellDropDown" {
            return Err(invalid(format!(
                "Unsupported DataValidation.list property '{key}'"
            )));
        }
    }
    let source = object
        .get("source")
        .ok_or_else(|| invalid("DataValidation.list requires source"))?;
    if !source.is_string() {
        return Err(invalid("DataValidation.list.source must be a string"));
    }
    let dropdown = object
        .get("inCellDropDown")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("DataValidation.list.inCellDropDown must be a boolean"))?;
    Ok(json!({"source": source, "inCellDropDown": dropdown}))
}

fn normalize_error_alert(value: &Value) -> Result<Value, ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation.errorAlert must be an object"))?;
    for key in object.keys() {
        if !["message", "showAlert", "style", "title"].contains(&key.as_str()) {
            return Err(invalid(format!(
                "Unsupported DataValidation.errorAlert property '{key}'"
            )));
        }
    }
    let message = required_string(object, "message", "DataValidation.errorAlert.message")?;
    let title = required_string(object, "title", "DataValidation.errorAlert.title")?;
    let show_alert = object
        .get("showAlert")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("DataValidation.errorAlert.showAlert must be a boolean"))?;
    let style = required_string(object, "style", "DataValidation.errorAlert.style")?;
    Ok(json!({
        "message": message,
        "showAlert": show_alert,
        "style": style,
        "title": title,
    }))
}

fn normalize_prompt(value: &Value) -> Result<Value, ValidationError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("DataValidation.prompt must be an object"))?;
    for key in object.keys() {
        if !["message", "showPrompt", "title"].contains(&key.as_str()) {
            return Err(invalid(format!(
                "Unsupported DataValidation.prompt property '{key}'"
            )));
        }
    }
    let message = required_string(object, "message", "DataValidation.prompt.message")?;
    let title = required_string(object, "title", "DataValidation.prompt.title")?;
    let show_prompt = object
        .get("showPrompt")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("DataValidation.prompt.showPrompt must be a boolean"))?;
    Ok(json!({
        "message": message,
        "showPrompt": show_prompt,
        "title": title,
    }))
}

fn required_string(
    object: &Map<String, Value>,
    key: &str,
    property: &str,
) -> Result<String, ValidationError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("{property} must be a string")))
}

fn schema_id_for(bounds: Bounds) -> String {
    format!(
        "officejs-dv-{}-{}-{}-{}",
        bounds.start_row, bounds.start_col, bounds.end_row, bounds.end_col
    )
}

fn validation_text(value: &CellValue) -> String {
    value
        .coerce_to_string()
        .map(|text| text.into_owned())
        .unwrap_or_default()
}

fn invalid(message: impl Into<String>) -> ValidationError {
    ValidationError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> ValidationError {
    ValidationError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn engine(error: ComputeApiError) -> ValidationError {
    ValidationError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: serde_json::Error) -> ValidationError {
    encoding_message(format!("Failed to encode validation schema: {error}"))
}

fn encoding_message(message: impl Into<String>) -> ValidationError {
    ValidationError {
        code: "GeneralException",
        message: message.into(),
    }
}
