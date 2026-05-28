use value_types::{CellError, CellValue};

use crate::PureFunction;

pub(in crate::lookup) struct FnSequence;

impl PureFunction for FnSequence {
    fn name(&self) -> &'static str {
        "SEQUENCE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let rows = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let cols = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let start = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        let step = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };

        if rows <= 0 || cols <= 0 {
            return CellValue::error_with_message(
                CellError::Calc,
                format!("SEQUENCE: rows ({rows}) and columns ({cols}) must be positive"),
            );
        }

        let rows = rows as usize;
        let cols = cols as usize;
        let mut result = Vec::with_capacity(rows);
        let mut current = start;
        for _ in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for _ in 0..cols {
                row.push(CellValue::number(current));
                current += step;
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}
