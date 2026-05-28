use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;

pub(super) struct BeforeAfterArgs {
    pub(super) text: String,
    pub(super) delimiter: String,
    pub(super) instance_num: i64,
    pub(super) match_mode: i32,
    pub(super) match_end: i32,
    pub(super) if_not_found: CellValue,
}

pub(super) struct SplitArgs {
    pub(super) text: String,
    pub(super) col_delimiters: Option<Vec<String>>,
    pub(super) row_delimiters: Option<Vec<String>>,
    pub(super) ignore_empty: bool,
    pub(super) match_mode: i32,
    pub(super) pad_with: CellValue,
}

pub(super) fn parse_before_after_args(
    args: &[CellValue],
    function_name: &'static str,
) -> Result<BeforeAfterArgs, CellValue> {
    if let Some(e) = check_error(&args[0]) {
        return Err(e);
    }
    if let Some(e) = check_error(&args[1]) {
        return Err(e);
    }

    let text = args[0]
        .coerce_to_string()
        .map(|s| s.into_owned())
        .map_err(|e| CellValue::Error(e, None))?;
    let delimiter = args[1]
        .coerce_to_string()
        .map(|s| s.into_owned())
        .map_err(|e| CellValue::Error(e, None))?;

    let instance_num = if args.len() > 2 {
        if let Some(e) = check_error(&args[2]) {
            return Err(e);
        }
        args[2]
            .coerce_to_number()
            .map(|n| n as i64)
            .map_err(|e| CellValue::Error(e, None))?
    } else {
        1
    };

    let match_mode = if args.len() > 3 {
        if let Some(e) = check_error(&args[3]) {
            return Err(e);
        }
        args[3]
            .coerce_to_number()
            .map(|n| n as i32)
            .map_err(|e| CellValue::Error(e, None))?
    } else {
        0
    };

    let match_end = if args.len() > 4 {
        if let Some(e) = check_error(&args[4]) {
            return Err(e);
        }
        args[4]
            .coerce_to_number()
            .map(|n| n as i32)
            .map_err(|e| CellValue::Error(e, None))?
    } else {
        0
    };

    let if_not_found = if args.len() > 5 {
        if let Some(e) = check_error(&args[5]) {
            return Err(e);
        }
        args[5].clone()
    } else {
        CellValue::error_with_message(
            CellError::Na,
            format!("{function_name}: delimiter '{delimiter}' not found in text"),
        )
    };

    Ok(BeforeAfterArgs {
        text,
        delimiter,
        instance_num,
        match_mode,
        match_end,
        if_not_found,
    })
}

pub(super) fn parse_split_args(args: &[CellValue]) -> Result<SplitArgs, CellValue> {
    if let Some(e) = check_error(&args[0]) {
        return Err(e);
    }

    let text = args[0]
        .coerce_to_string()
        .map(|s| s.into_owned())
        .map_err(|e| CellValue::Error(e, None))?;

    let col_delimiters = collect_delimiters(&args[1]).map_err(|e| CellValue::Error(e, None))?;

    let row_delimiters = if args.len() > 2 {
        collect_delimiters(&args[2]).map_err(|e| CellValue::Error(e, None))?
    } else {
        None
    };

    let ignore_empty = if args.len() > 3 {
        if let Some(e) = check_error(&args[3]) {
            return Err(e);
        }
        args[3]
            .coerce_to_bool()
            .map_err(|e| CellValue::Error(e, None))?
    } else {
        false
    };

    let match_mode = if args.len() > 4 {
        if let Some(e) = check_error(&args[4]) {
            return Err(e);
        }
        args[4]
            .coerce_to_number()
            .map(|n| n as i32)
            .map_err(|e| CellValue::Error(e, None))?
    } else {
        0
    };

    let pad_with = if args.len() > 5 {
        if let Some(e) = check_error(&args[5]) {
            return Err(e);
        }
        args[5].clone()
    } else {
        CellValue::error_with_message(
            CellError::Na,
            "TEXTSPLIT: row has fewer columns than the widest row",
        )
    };

    Ok(SplitArgs {
        text,
        col_delimiters,
        row_delimiters,
        ignore_empty,
        match_mode,
        pad_with,
    })
}

fn collect_delimiters(arg: &CellValue) -> Result<Option<Vec<String>>, CellError> {
    match arg {
        CellValue::Null => Ok(None),
        CellValue::Array(arr) => {
            let mut delimiters = Vec::new();
            for value in arr.iter() {
                let delimiter = value.coerce_to_string()?.into_owned();
                if !delimiter.is_empty() {
                    delimiters.push(delimiter);
                }
            }
            if delimiters.is_empty() {
                Ok(None)
            } else {
                Ok(Some(delimiters))
            }
        }
        _ => {
            let delimiter = arg.coerce_to_string()?.into_owned();
            if delimiter.is_empty() {
                Ok(None)
            } else {
                Ok(Some(vec![delimiter]))
            }
        }
    }
}
