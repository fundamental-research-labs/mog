//! Used ranges and search results bind ordinary writable Range proxies.
use crate::{
    dispatch::{ExtensionHandler, HostDispatchContext},
    host::{BatchError, RangeRef},
    range_navigation::{RangeAddress, parse_range_address},
};
use serde_json::{Value, json};

pub(crate) struct RangeQueriesHandler;
impl ExtensionHandler for RangeQueriesHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "rangeQuery"
    }
    fn handle(
        &self,
        op: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let (sheet, scope) = if let Some(id) = op["rangeId"].as_str() {
            let range = context.range(id)?;
            let scope = range
                .address()
                .map(|a| parse_range_address(&range.sheet(), a))
                .transpose()
                .map_err(nav)?
                .unwrap_or(RangeAddress::WholeSheet);
            (range.sheet(), scope)
        } else {
            (
                context.worksheet(text(op, "worksheetId")?)?.sheet(),
                RangeAddress::WholeSheet,
            )
        };
        let id = text(op, "id")?;
        let args = &op["args"];
        let method = text(op, "method")?;
        let found = match method {
            "used" => {
                let values_only = optional_bool(&args[0], false)?;
                sheet
                    .used_range_bounds(scope.bounds(), values_only)
                    .map_err(engine)?
                    .map(rect)
                    .or_else(|| {
                        if op["worksheetId"].is_string() && op["nullable"] != true {
                            Some(rect((0, 0, 0, 0)))
                        } else {
                            None
                        }
                    })
            }
            "intersection" => {
                let other = if let Some(id) = args[0]["rangeId"].as_str() {
                    let range = context.range(id)?;
                    if range.sheet().id() != sheet.id() {
                        return Err(invalid("Ranges must be on the same worksheet"));
                    }
                    range
                        .address()
                        .map(|a| parse_range_address(&sheet, a))
                        .transpose()
                        .map_err(nav)?
                        .unwrap_or(RangeAddress::WholeSheet)
                } else {
                    parse_range_address(
                        &sheet,
                        args[0]
                            .as_str()
                            .ok_or_else(|| invalid("A range or address is required"))?,
                    )
                    .map_err(nav)?
                };
                let (a, b, c, d) = scope.bounds();
                let (e, f, g, h) = other.bounds();
                let bounds = (a.max(e), b.max(f), c.min(g), d.min(h));
                (bounds.0 <= bounds.2 && bounds.1 <= bounds.3).then(|| rect(bounds))
            }
            "find" | "replace" => {
                let search = args[0]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| invalid("Search text must be a non-empty string"))?;
                let criteria = if method == "find" { &args[1] } else { &args[2] };
                if !criteria.is_object() {
                    return Err(invalid("Search criteria must be an object"));
                }
                let match_case = optional_bool(&criteria["matchCase"], false)?;
                let complete = optional_bool(&criteria["completeMatch"], false)?;
                let reverse = match criteria["searchDirection"].as_str() {
                    None | Some("Forward") => false,
                    Some("Backwards") => true,
                    _ => return Err(invalid("Invalid searchDirection")),
                };
                let pattern = wildcard_pattern(search);
                let single = scope.cell_count() == 1;
                let search_scope = if method == "find" && single {
                    RangeAddress::WholeSheet
                } else {
                    scope.clone()
                };
                let mut matches = sheet
                    .find_cells(
                        search_scope.bounds(),
                        &pattern,
                        match_case,
                        complete,
                        method == "replace",
                    )
                    .map_err(engine)?;
                if method == "replace" {
                    let replacement = args[1]
                        .as_str()
                        .ok_or_else(|| invalid("Replacement must be a string"))?;
                    let pattern = if complete {
                        format!("^(?:{pattern})$")
                    } else {
                        pattern
                    };
                    let regex = regex::RegexBuilder::new(&pattern)
                        .case_insensitive(!match_case)
                        .build()
                        .map_err(engine)?;
                    let mut count = 0;
                    for (row, col) in matches {
                        let value = match sheet.get_formula((row, col)).map_err(engine)? {
                            Some(formula) => formula,
                            None => sheet
                                .get_cell_value((row, col))
                                .map_err(engine)?
                                .to_string(),
                        };
                        if regex.is_match(&value) {
                            let new = regex.replace_all(&value, regex::NoExpand(replacement));
                            sheet.set_cell((row, col), new.as_ref()).map_err(engine)?;
                            count += 1;
                        }
                    }
                    context.result(id, json!(count));
                    return Ok(true);
                }
                if reverse {
                    matches.reverse();
                }
                if single && !matches.is_empty() {
                    let (row, col, _, _) = scope.bounds();
                    let first = matches
                        .iter()
                        .position(|pos| {
                            if reverse {
                                *pos < (row, col)
                            } else {
                                *pos > (row, col)
                            }
                        })
                        .unwrap_or(0);
                    matches.rotate_left(first);
                }
                matches
                    .first()
                    .map(|&(row, col)| rect((row, col, row, col)))
            }
            _ => return Err(invalid("Unknown range query")),
        };
        if found.is_none() && op["nullable"] != true {
            return Err(BatchError {
                code: "ItemNotFound",
                message: "No matching cells were found".into(),
            });
        }
        let is_null = found.is_none();
        context.bind_range(
            id,
            RangeRef::new(sheet, found.map(|a| a.to_a1()), is_null),
            is_null,
        );
        Ok(true)
    }
}
fn rect((sr, sc, er, ec): (u32, u32, u32, u32)) -> RangeAddress {
    RangeAddress::Cells {
        start_row: sr,
        start_column: sc,
        end_row: er,
        end_column: ec,
    }
}
fn wildcard_pattern(text: &str) -> String {
    let mut pattern = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => pattern.push_str(".*"),
            '?' => pattern.push('.'),
            '~' if chars.peek().is_some_and(|c| matches!(c, '*' | '?' | '~')) => {
                pattern.push_str(&regex::escape(&chars.next().unwrap().to_string()))
            }
            _ => pattern.push_str(&regex::escape(&ch.to_string())),
        }
    }
    pattern
}
fn optional_bool(value: &Value, default: bool) -> Result<bool, BatchError> {
    if value.is_null() {
        Ok(default)
    } else {
        value.as_bool().ok_or_else(|| invalid("Expected a boolean"))
    }
}
fn text<'a>(op: &'a Value, key: &str) -> Result<&'a str, BatchError> {
    op[key]
        .as_str()
        .ok_or_else(|| invalid(format!("{key} is required")))
}
fn nav(e: crate::range_navigation::RangeNavigationError) -> BatchError {
    BatchError {
        code: e.code,
        message: e.message,
    }
}
fn invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}
fn engine(error: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}
