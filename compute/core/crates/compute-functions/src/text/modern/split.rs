use value_types::CellValue;

use crate::PureFunction;

use super::args::parse_split_args;
use super::delimiter::split_by_delimiters;

pub(super) struct FnTextSplit;

impl PureFunction for FnTextSplit {
    fn is_scalar_arg(&self, index: usize) -> bool {
        !matches!(index, 1 | 2)
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
        let parsed = match parse_split_args(args) {
            Ok(parsed) => parsed,
            Err(error) => return error,
        };

        let mut rows: Vec<String> = match &parsed.row_delimiters {
            Some(row_delimiters) => {
                split_by_delimiters(&parsed.text, row_delimiters, parsed.match_mode)
            }
            None => vec![parsed.text.clone()],
        };

        if parsed.ignore_empty {
            rows.retain(|row| !row.is_empty());
        }

        let col_delimiters = match &parsed.col_delimiters {
            Some(col_delimiters) => col_delimiters,
            None => {
                let result: Vec<Vec<CellValue>> = rows
                    .iter()
                    .map(|row| vec![CellValue::Text(row.clone().into())])
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
            let mut cols = split_by_delimiters(row, col_delimiters, parsed.match_mode);
            if parsed.ignore_empty {
                cols.retain(|col| !col.is_empty());
            }
            max_cols = max_cols.max(cols.len());
            result.push(
                cols.into_iter()
                    .map(|text| CellValue::Text(text.into()))
                    .collect(),
            );
        }

        for row in &mut result {
            while row.len() < max_cols {
                row.push(parsed.pad_with.clone());
            }
        }

        if result.len() == 1 {
            if result[0].len() == 1 {
                return result[0][0].clone();
            }
            return CellValue::from_rows(result);
        }

        CellValue::from_rows(result)
    }
}
