use value_types::{CellError, CellValue};

use crate::PureFunction;

use super::args::{BeforeAfterArgs, parse_before_after_args};
use super::delimiter::{DelimiterMatch, match_positions};

pub(super) struct FnTextBefore;
pub(super) struct FnTextAfter;

enum Direction {
    Before,
    After,
}

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
        evaluate(args, "TEXTBEFORE", Direction::Before)
    }
}

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
        evaluate(args, "TEXTAFTER", Direction::After)
    }
}

fn evaluate(args: &[CellValue], function_name: &'static str, direction: Direction) -> CellValue {
    let parsed = match parse_before_after_args(args, function_name) {
        Ok(parsed) => parsed,
        Err(error) => return error,
    };

    if parsed.instance_num == 0 {
        return CellValue::error_with_message(
            CellError::Value,
            format!("{function_name}: instance_num must not be 0"),
        );
    }

    if parsed.delimiter.is_empty() {
        return if parsed.match_end != 0 {
            match direction {
                Direction::Before => CellValue::Text(parsed.text.into()),
                Direction::After => CellValue::Text(String::new().into()),
            }
        } else {
            CellValue::error_with_message(
                CellError::Value,
                format!("{function_name}: delimiter must not be empty"),
            )
        };
    }

    match selected_match(&parsed) {
        Some(target) => result_for_match(parsed.text.as_str(), target, direction),
        None => parsed.if_not_found,
    }
}

fn selected_match(parsed: &BeforeAfterArgs) -> Option<DelimiterMatch> {
    let mut positions = match_positions(&parsed.text, &parsed.delimiter, parsed.match_mode);
    if parsed.match_end != 0 {
        positions.push(DelimiterMatch {
            start: parsed.text.chars().count(),
            len: 0,
        });
    }

    let target_index = if parsed.instance_num > 0 {
        (parsed.instance_num - 1) as usize
    } else {
        let from_end = (-parsed.instance_num) as usize;
        if from_end > positions.len() {
            return None;
        }
        positions.len() - from_end
    };

    positions.get(target_index).copied()
}

fn result_for_match(text: &str, target: DelimiterMatch, direction: Direction) -> CellValue {
    let text_chars: Vec<char> = text.chars().collect();
    let result: String = match direction {
        Direction::Before => text_chars[..target.start].iter().collect(),
        Direction::After => {
            let after_pos = if target.start == text_chars.len() {
                text_chars.len()
            } else {
                target.start + target.len
            };
            text_chars[after_pos..].iter().collect()
        }
    };
    CellValue::Text(result.into())
}
