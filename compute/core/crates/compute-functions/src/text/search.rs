//! Search functions: FIND, SEARCH, SUBSTITUTE, REPLACE

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::helpers::criteria::WildcardPattern;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnFind;
impl PureFunction for FnFind {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FIND"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let find_text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let within_text = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("FIND: start_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => (n as usize).saturating_sub(1),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // FIND is case-sensitive
        let search_in = &within_text[within_text
            .char_indices()
            .nth(start_num)
            .map_or(within_text.len(), |(i, _)| i)..];
        match search_in.find(&*find_text) {
            Some(pos) => {
                // Convert byte offset to char offset, add start_num, 1-based
                let char_pos = search_in[..pos].chars().count();
                CellValue::number((char_pos + start_num + 1) as f64)
            }
            None => CellValue::error_with_message(
                CellError::Value,
                format!("FIND: '{find_text}' not found in '{within_text}'"),
            ),
        }
    }
}

pub(crate) struct FnSearch;
impl PureFunction for FnSearch {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SEARCH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let find_text = match args[0].coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(e) => return CellValue::Error(e, None),
        };
        let within_text = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("SEARCH: start_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => (n as usize).saturating_sub(1),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // SEARCH is case-insensitive and supports wildcards
        let within_lower = within_text.to_lowercase();
        let search_in: String = within_lower.chars().skip(start_num).collect();
        if find_text.contains('*') || find_text.contains('?') {
            // Wildcard search - find first matching position
            let pattern = WildcardPattern::new(&find_text);
            let search_chars: Vec<char> = search_in.chars().collect();
            for i in 0..=search_chars.len() {
                let remaining: String = search_chars[i..].iter().collect();
                if pattern.matches(&remaining) {
                    return CellValue::number((i + start_num + 1) as f64);
                }
                // Also try matching just starting from position i
                for j in i..=search_chars.len() {
                    let substr: String = search_chars[i..j].iter().collect();
                    if pattern.matches(&substr) {
                        return CellValue::number((i + start_num + 1) as f64);
                    }
                }
            }
            CellValue::error_with_message(
                CellError::Value,
                format!("SEARCH: '{find_text}' not found in '{within_text}'"),
            )
        } else {
            match search_in.find(&find_text) {
                Some(pos) => {
                    let char_pos = search_in[..pos].chars().count();
                    CellValue::number((char_pos + start_num + 1) as f64)
                }
                None => CellValue::error_with_message(
                    CellError::Value,
                    format!("SEARCH: '{find_text}' not found in '{within_text}'"),
                ),
            }
        }
    }
}

pub(crate) struct FnSubstitute;
impl PureFunction for FnSubstitute {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SUBSTITUTE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let old_text = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let new_text = match args[2].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        if old_text.is_empty() {
            return CellValue::Text(text.into());
        }
        let instance_num = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("SUBSTITUTE: instance_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => Some(n as usize),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            None
        };

        match instance_num {
            None => {
                // Replace all occurrences
                CellValue::Text(text.replace(&old_text, &new_text).into())
            }
            Some(instance) => {
                // Replace only the Nth occurrence
                let mut count = 0usize;
                let mut result = String::new();
                let mut remaining = text.as_str();
                while let Some(pos) = remaining.find(&old_text) {
                    count += 1;
                    if count == instance {
                        result.push_str(&remaining[..pos]);
                        result.push_str(&new_text);
                        result.push_str(&remaining[pos + old_text.len()..]);
                        return CellValue::Text(result.into());
                    }
                    result.push_str(&remaining[..pos + old_text.len()]);
                    remaining = &remaining[pos + old_text.len()..];
                }
                result.push_str(remaining);
                CellValue::Text(result.into())
            }
        }
    }
}

pub(crate) struct FnReplace;
impl PureFunction for FnReplace {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REPLACE"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        for arg in args.iter().take(4) {
            if let Some(e) = check_error(arg) {
                return e;
            }
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("REPLACE: start_num must be >= 1, got {n}"),
                );
            }
            Ok(n) => (n as usize).saturating_sub(1),
            Err(e) => return CellValue::Error(e, None),
        };
        let num_chars = match args[2].coerce_to_number() {
            Ok(n) if n < 0.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("REPLACE: num_chars must be >= 0, got {n}"),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let new_text = match args[3].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };

        let chars: Vec<char> = text.chars().collect();
        let start = start.min(chars.len());
        let end = (start + num_chars).min(chars.len());

        let mut result = String::new();
        for c in &chars[..start] {
            result.push(*c);
        }
        result.push_str(&new_text);
        for c in &chars[end..] {
            result.push(*c);
        }
        CellValue::Text(result.into())
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFind));
    registry.register(Box::new(FnSearch));
    registry.register(Box::new(FnSubstitute));
    registry.register(Box::new(FnReplace));
}
