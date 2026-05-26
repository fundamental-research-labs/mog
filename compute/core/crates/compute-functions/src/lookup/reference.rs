//! Reference functions: ADDRESS, AREAS.
//! Note: INDIRECT and OFFSET are handled as special forms in eval/dispatch.rs.
//! ROW, COLUMN, ROWS, COLUMNS are handled in eval/dispatch.rs.

use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

/// Convert 0-based column index to Excel column letter(s). "A"=0, "Z"=25, "AA"=26, etc.
fn col_to_letter(col: u32) -> String {
    let mut result = String::new();
    let mut c = col;
    loop {
        result.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    result
}
// ---------------------------------------------------------------------------
// ADDRESS
// ---------------------------------------------------------------------------

pub(super) struct FnAddress;
impl PureFunction for FnAddress {
    fn name(&self) -> &'static str {
        "ADDRESS"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = crate::helpers::coercion::check_error(&args[0]) {
            return e;
        }
        if let Some(e) = crate::helpers::coercion::check_error(&args[1]) {
            return e;
        }

        let row = match args[0].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("ADDRESS: row_num ({}) must be at least 1", n as i32),
                );
            }
            Ok(n) => n as u32,
            Err(e) => return CellValue::Error(e, None),
        };
        let col = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("ADDRESS: column_num ({}) must be at least 1", n as i32),
                );
            }
            Ok(n) => n as u32,
            Err(e) => return CellValue::Error(e, None),
        };
        let abs_num = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as u32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1 // default: $A$1
        };
        let a1_style = if args.len() > 3 {
            match args[3].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            true
        };
        let sheet_name = if args.len() > 4 {
            match args[4].coerce_to_string() {
                Ok(s) if !s.is_empty() => Some(s),
                Ok(_) => None,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            None
        };

        if !a1_style {
            // R1C1 style — abs_num controls absolute vs relative
            let mut result = String::new();
            if let Some(sheet) = &sheet_name {
                result.push_str(sheet);
                result.push('!');
            }
            let row_part = match abs_num {
                1 | 2 => format!("R{}", row),
                3 | 4 => format!("R[{}]", row),
                _ => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("ADDRESS: abs_num ({abs_num}) must be 1, 2, 3, or 4"),
                    );
                }
            };
            let col_part = match abs_num {
                1 | 3 => format!("C{}", col),
                2 | 4 => format!("C[{}]", col),
                _ => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("ADDRESS: abs_num ({abs_num}) must be 1, 2, 3, or 4"),
                    );
                }
            };
            result.push_str(&row_part);
            result.push_str(&col_part);
            return CellValue::Text(result.into());
        }

        let col_letter = col_to_letter(col - 1);

        let address = match abs_num {
            1 => format!("${}${}", col_letter, row), // $A$1
            2 => format!("{}${}", col_letter, row),  // A$1
            3 => format!("${}{}", col_letter, row),  // $A1
            4 => format!("{}{}", col_letter, row),   // A1
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("ADDRESS: abs_num ({abs_num}) must be 1, 2, 3, or 4"),
                );
            }
        };

        let result = match sheet_name {
            Some(sheet) => format!("{}!{}", sheet, address),
            None => address,
        };
        CellValue::Text(result.into())
    }
}

// ---------------------------------------------------------------------------
// AREAS
// ---------------------------------------------------------------------------

pub(super) struct FnAreas;
impl PureFunction for FnAreas {
    fn name(&self) -> &'static str {
        "AREAS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        // Stub: single reference always returns 1 area.
        // Full implementation would need to count distinct areas in the reference.
        CellValue::number(1.0)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAddress));
    registry.register(Box::new(FnAreas));
}
