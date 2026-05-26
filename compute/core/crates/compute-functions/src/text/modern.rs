//! Modern Text functions (Excel 365): TEXTBEFORE, TEXTAFTER, TEXTSPLIT

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnTextBefore;
impl PureFunction for FnTextBefore {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTBEFORE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let delimiter = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let instance_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let match_mode = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let match_end = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // if_not_found: if provided, return that on failure; else #N/A
        let if_not_found = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                format!("TEXTBEFORE: delimiter '{delimiter}' not found in text"),
            )
        };

        if instance_num == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "TEXTBEFORE: instance_num must not be 0",
            );
        }
        if delimiter.is_empty() {
            return if match_end != 0 {
                CellValue::Text(text.into())
            } else {
                CellValue::error_with_message(
                    CellError::Value,
                    "TEXTBEFORE: delimiter must not be empty",
                )
            };
        }

        // Build char-index positions: find all occurrences using char indices
        let text_chars: Vec<char> = text.chars().collect();
        let delim_chars: Vec<char> = if match_mode == 1 {
            delimiter.to_lowercase().chars().collect()
        } else {
            delimiter.chars().collect()
        };
        let search_chars: Vec<char> = if match_mode == 1 {
            text.to_lowercase().chars().collect()
        } else {
            text_chars.clone()
        };

        let mut positions = Vec::new(); // char-based positions
        let mut i = 0;
        while i + delim_chars.len() <= search_chars.len() {
            if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                positions.push(i);
                i += delim_chars.len(); // advance by delimiter length (Excel: no overlapping matches)
            } else {
                i += 1;
            }
        }

        if positions.is_empty() {
            return if_not_found;
        }

        // Get target instance
        let target_index = if instance_num > 0 {
            (instance_num - 1) as usize
        } else {
            let from_end = (-instance_num) as usize;
            if from_end > positions.len() {
                return if_not_found;
            }
            positions.len() - from_end
        };

        if target_index >= positions.len() {
            return if_not_found;
        }

        let result: String = text_chars[..positions[target_index]].iter().collect();
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnTextAfter;
impl PureFunction for FnTextAfter {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTAFTER"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let delimiter = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let instance_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let match_mode = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let match_end = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let if_not_found = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                format!("TEXTAFTER: delimiter '{delimiter}' not found in text"),
            )
        };

        if instance_num == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "TEXTAFTER: instance_num must not be 0",
            );
        }
        if delimiter.is_empty() {
            return if match_end != 0 {
                CellValue::Text(String::new().into())
            } else {
                CellValue::error_with_message(
                    CellError::Value,
                    "TEXTAFTER: delimiter must not be empty",
                )
            };
        }

        // Build char-index positions: find all occurrences using char indices
        let text_chars: Vec<char> = text.chars().collect();
        let delim_chars: Vec<char> = if match_mode == 1 {
            delimiter.to_lowercase().chars().collect()
        } else {
            delimiter.chars().collect()
        };
        let search_chars: Vec<char> = if match_mode == 1 {
            text.to_lowercase().chars().collect()
        } else {
            text_chars.clone()
        };

        let mut positions = Vec::new(); // char-based positions
        let mut i = 0;
        while i + delim_chars.len() <= search_chars.len() {
            if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                positions.push(i);
                i += delim_chars.len(); // advance by delimiter length (Excel: no overlapping matches)
            } else {
                i += 1;
            }
        }

        if positions.is_empty() {
            return if_not_found;
        }

        // Get target instance
        let target_index = if instance_num > 0 {
            (instance_num - 1) as usize
        } else {
            let from_end = (-instance_num) as usize;
            if from_end > positions.len() {
                return if_not_found;
            }
            positions.len() - from_end
        };

        if target_index >= positions.len() {
            return if_not_found;
        }

        let after_pos = positions[target_index] + delim_chars.len();
        let result: String = text_chars[after_pos..].iter().collect();
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnTextSplit;
impl PureFunction for FnTextSplit {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTSPLIT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };

        // col_delimiter (arg 1) — can be null/empty to skip
        let col_delimiter = if matches!(args[1], CellValue::Null) {
            None
        } else {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_string() {
                Ok(s) if s.is_empty() => None,
                Ok(s) => Some(s.into_owned()),
                Err(e) => return CellValue::Error(e, None),
            }
        };

        // row_delimiter (arg 2) — optional
        let row_delimiter = if args.len() > 2 {
            if matches!(args[2], CellValue::Null) {
                None
            } else {
                if let Some(e) = check_error(&args[2]) {
                    return e;
                }
                match args[2].coerce_to_string() {
                    Ok(s) if s.is_empty() => None,
                    Ok(s) => Some(s.into_owned()),
                    Err(e) => return CellValue::Error(e, None),
                }
            }
        } else {
            None
        };

        // ignore_empty (arg 3)
        let ignore_empty = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        // match_mode (arg 4): 0=case-sensitive, 1=case-insensitive
        let match_mode = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        // pad_with (arg 5)
        let pad_with = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                "TEXTSPLIT: row has fewer columns than the widest row",
            )
        };

        // Helper: split a string by delimiter respecting match_mode (char-safe)
        let split_text = |s: &str, delim: &str| -> Vec<String> {
            let s_chars: Vec<char> = s.chars().collect();
            let delim_chars: Vec<char> = if match_mode == 1 {
                delim.to_lowercase().chars().collect()
            } else {
                delim.chars().collect()
            };
            let search_chars: Vec<char> = if match_mode == 1 {
                s.to_lowercase().chars().collect()
            } else {
                s_chars.clone()
            };

            let mut parts = Vec::new();
            let mut last = 0;
            let mut i = 0;
            while i + delim_chars.len() <= search_chars.len() {
                if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                    parts.push(s_chars[last..i].iter().collect::<String>());
                    last = i + delim_chars.len();
                    i = last;
                } else {
                    i += 1;
                }
            }
            parts.push(s_chars[last..].iter().collect::<String>());
            parts
        };

        // Split by row delimiter first
        let mut rows: Vec<String> = match &row_delimiter {
            Some(rd) => split_text(&text, rd),
            None => vec![text.clone()],
        };

        if ignore_empty {
            rows.retain(|r| !r.is_empty());
        }

        // Split each row by column delimiter
        let col_delim = match &col_delimiter {
            Some(cd) => cd.clone(),
            None => {
                // No column delimiter — return as single column
                let result: Vec<Vec<CellValue>> = rows
                    .iter()
                    .map(|r| vec![CellValue::Text(r.clone().into())])
                    .collect();
                if result.len() == 1 && result[0].len() == 1 {
                    return result[0][0].clone();
                }
                return CellValue::from_rows(result);
            }
        };

        let mut result: Vec<Vec<CellValue>> = Vec::new();
        let mut max_cols = 0;

        for row in &rows {
            let mut cols: Vec<String> = split_text(row, &col_delim);
            if ignore_empty {
                cols.retain(|c| !c.is_empty());
            }
            max_cols = max_cols.max(cols.len());
            let row_vals: Vec<CellValue> = cols
                .into_iter()
                .map(|s| CellValue::Text(s.into()))
                .collect();
            result.push(row_vals);
        }

        // Pad rows to same length
        for row in &mut result {
            while row.len() < max_cols {
                row.push(pad_with.clone());
            }
        }

        // Return 1D if single row
        if result.len() == 1 {
            if result[0].len() == 1 {
                return result[0][0].clone();
            }
            return CellValue::from_rows(result);
        }

        CellValue::from_rows(result)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTextBefore));
    registry.register(Box::new(FnTextAfter));
    registry.register(Box::new(FnTextSplit));
}
