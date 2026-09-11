//! Workbook.comments.add host operations.

use domain_types::domain::comment::CommentType;
use serde_json::Value;

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::BatchError;
use crate::range_navigation::parse_range_address;

pub(crate) struct CommentsHandler;

impl ExtensionHandler for CommentsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "commentAdd"
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let address = operation
            .get("cellAddress")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("comments.add requires a cell address"))?;
        let content = operation
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        let (sheet_name, cell) = split_address(address)?;
        let sheet = context
            .workbook()
            .sheet_by_name(&sheet_name)
            .map_err(engine)?;
        let parsed = parse_range_address(&sheet, &cell).map_err(|error| BatchError {
            code: error.code,
            message: error.message,
        })?;
        let (row, col, _, _) = parsed.bounds();
        sheet
            .comments()
            .add_at(
                row,
                col,
                "User",
                content,
                None,
                None,
                CommentType::ThreadedComment,
            )
            .map_err(engine)?;
        let _ = context;
        Ok(true)
    }
}

fn split_address(address: &str) -> Result<(String, String), BatchError> {
    match address.rsplit_once('!') {
        Some((sheet, cell)) => {
            let sheet = sheet.trim().trim_matches('\'').replace("''", "'");
            Ok((sheet, cell.trim().to_string()))
        }
        None => Ok(("Sheet1".to_string(), address.trim().to_string())),
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
