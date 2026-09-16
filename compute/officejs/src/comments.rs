//! Threaded comment proxies retain engine IDs so lookups, edits and replies
//! continue to refer to the same thread across syncs and worksheet edits.
use crate::{
    dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext},
    host::{BatchError, RangeRef},
    range_navigation::{RangeAddress, parse_range_address},
};
use compute_api::{Sheet, Workbook};
use domain_types::{Comment, domain::comment::CommentType};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

pub(crate) struct CommentsHandler;
#[derive(Clone)]
struct CommentRef {
    sheet: Sheet,
    id: String,
}
struct CollectionRef {
    workbook: Workbook,
    parent: Option<CommentRef>,
}

impl CommentRef {
    fn get(&self) -> Result<Comment, BatchError> {
        self.sheet
            .comments()
            .get(&self.id)
            .map_err(engine)?
            .ok_or_else(missing)
    }
}
impl CollectionRef {
    fn items(&self) -> Result<Vec<CommentRef>, BatchError> {
        let sheets = if let Some(parent) = &self.parent {
            parent.get()?;
            vec![parent.sheet.clone()]
        } else {
            (0..self.workbook.sheet_count().map_err(engine)?)
                .map(|i| self.workbook.sheet_by_index(i).map_err(engine))
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut items = Vec::new();
        for sheet in sheets {
            let mut comments = sheet.comments().get_all().map_err(engine)?;
            comments.retain(|c| {
                c.comment_type == CommentType::ThreadedComment
                    && c.parent_id.as_deref() == self.parent.as_ref().map(|p| p.id.as_str())
            });
            // Engine storage is unordered. Excel exposes roots in cell order and
            // replies in creation order, preserving insertion order on ties.
            if self.parent.is_some() {
                comments.sort_by_key(|comment| comment.created_at);
            } else {
                let mut located = comments
                    .into_iter()
                    .map(|c| Ok((sheet.comments().location(&c.id).map_err(engine)?, c)))
                    .collect::<Result<Vec<_>, BatchError>>()?;
                located.sort_by(|a, b| a.0.cmp(&b.0));
                comments = located.into_iter().map(|(_, c)| c).collect();
            }
            items.extend(comments.into_iter().map(|c| CommentRef {
                sheet: sheet.clone(),
                id: c.id,
            }));
        }
        Ok(items)
    }
}
impl ExtensionHandler for CommentsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "comments"
    }
    fn handle(
        &self,
        op: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let method = text(op, "method")?;
        let args = op["args"].as_array().cloned().unwrap_or_default();
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        if method == "collection" {
            let parent = op["parentId"]
                .as_str()
                .map(|id| {
                    context
                        .extension_object::<CommentRef>(id)
                        .map(|p| (*p).clone())
                })
                .transpose()?;
            context.bind_object(
                text(op, "id")?,
                Arc::new(CollectionRef {
                    workbook: context.workbook(),
                    parent,
                }),
            );
            return Ok(true);
        }
        let source = text(op, "sourceId")?;
        if matches!(method, "delete" | "location" | "parent") {
            let object = context.extension_object::<CommentRef>(source)?;
            let comment = object.get()?;
            match method {
                "delete" => {
                    if comment.parent_id.is_none() {
                        for reply in object.sheet.comments().get_all().map_err(engine)? {
                            if reply.parent_id.as_deref() == Some(&object.id) {
                                object.sheet.comments().delete(&reply.id).map_err(engine)?;
                            }
                        }
                    }
                    object.sheet.comments().delete(&object.id).map_err(engine)?;
                }
                "location" => {
                    let (row, col) = object
                        .sheet
                        .comments()
                        .location(&object.id)
                        .map_err(engine)?
                        .ok_or_else(missing)?;
                    let address = RangeAddress::Cells {
                        start_row: row,
                        start_column: col,
                        end_row: row,
                        end_column: col,
                    }
                    .to_a1();
                    context.bind_range(
                        text(op, "id")?,
                        RangeRef::new(object.sheet.clone(), Some(address), false),
                        false,
                    );
                }
                _ => {
                    let id = comment.parent_id.ok_or_else(missing)?;
                    context.bind_object(
                        text(op, "id")?,
                        Arc::new(CommentRef {
                            sheet: object.sheet.clone(),
                            id,
                        }),
                    );
                }
            }
            return Ok(true);
        }
        let collection = context.extension_object::<CollectionRef>(source)?;
        let id = text(op, "id")?;
        if method == "add" || method == "addReply" {
            let (sheet, row, col, parent, content, content_type) = if method == "add" {
                let (sheet, row, col) = location_arg(context, arg(0))?;
                if sheet
                    .comments()
                    .get_at(row, col)
                    .map_err(engine)?
                    .iter()
                    .any(|c| {
                        c.comment_type == CommentType::ThreadedComment && c.parent_id.is_none()
                    })
                {
                    return Err(invalid("A comment already exists at this cell"));
                }
                (sheet, row, col, None, arg(1), arg(2))
            } else {
                let parent = collection.parent.as_ref().ok_or_else(missing)?;
                parent.get()?;
                let (row, col) = parent
                    .sheet
                    .comments()
                    .location(&parent.id)
                    .map_err(engine)?
                    .ok_or_else(missing)?;
                (
                    parent.sheet.clone(),
                    row,
                    col,
                    Some(parent.id.as_str()),
                    arg(0),
                    arg(1),
                )
            };
            if !content_type.is_null() && content_type.as_str() != Some("Plain") {
                return Err(invalid("This overload requires plain comment content"));
            }
            let content = content
                .as_str()
                .ok_or_else(|| invalid("Comment content must be a string"))?;
            let result = sheet
                .comments()
                .add_at(
                    row,
                    col,
                    "User",
                    content,
                    None,
                    parent,
                    CommentType::ThreadedComment,
                )
                .map_err(engine)?;
            let comment_id = result
                .data
                .as_ref()
                .and_then(|v| v["id"].as_str())
                .ok_or_else(missing)?
                .to_string();
            context.bind_object(
                id,
                Arc::new(CommentRef {
                    sheet,
                    id: comment_id,
                }),
            );
            return Ok(true);
        }
        let items = collection.items()?;
        if method == "count" {
            context.result(id, json!(items.len()));
            return Ok(true);
        }
        let found = match method {
            "at" => {
                let index = arg(0)
                    .as_u64()
                    .ok_or_else(|| invalid("index must be a non-negative integer"))?;
                items.get(index as usize).cloned()
            }
            "item" | "itemOrNull" => items
                .into_iter()
                .find(|item| Some(item.id.as_str()) == arg(0).as_str()),
            "byCell" => {
                let (sheet, row, col) = location_arg(context, arg(0))?;
                let root = sheet
                    .comments()
                    .get_at(row, col)
                    .map_err(engine)?
                    .into_iter()
                    .find(|c| {
                        c.comment_type == CommentType::ThreadedComment && c.parent_id.is_none()
                    });
                root.map(|c| CommentRef { sheet, id: c.id })
            }
            "byReply" => {
                let reply_id = arg(0)
                    .as_str()
                    .ok_or_else(|| invalid("replyId must be a string"))?;
                let mut found = None;
                for item in items {
                    if let Some(reply) = item.sheet.comments().get(reply_id).map_err(engine)? {
                        if reply.parent_id.as_deref() == Some(&item.id) {
                            found = Some(item);
                            break;
                        }
                    }
                }
                found
            }
            _ => return Err(invalid("Unknown comment operation")),
        };
        if let Some(found) = found {
            context.bind_object(id, Arc::new(found));
        } else if method == "itemOrNull" {
            context.bind_null(id);
        } else {
            return Err(missing());
        }
        Ok(true)
    }
}
impl ExtensionObject for CommentRef {
    fn object_type(&self) -> &'static str {
        "Comment"
    }
    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let comment = self.get()?;
        properties
            .iter()
            .map(|name| {
                let value = match name.as_str() {
                    "id" => json!(comment.id),
                    "content" => json!(comment.content.as_deref().unwrap_or("")),
                    "authorName" => json!(comment.author),
                    "authorEmail" => json!(comment.author_email.as_deref().unwrap_or("")),
                    "resolved" => json!(comment.resolved.unwrap_or(false)),
                    _ => return Err(invalid(format!("Unknown comment property: {name}"))),
                };
                Ok((name.clone(), value))
            })
            .collect()
    }
    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        let comment = self.get()?;
        match property {
            "content" => {
                self.sheet
                    .comments()
                    .update(
                        &self.id,
                        value
                            .as_str()
                            .ok_or_else(|| invalid("content must be a string"))?,
                    )
                    .map_err(engine)?;
            }
            "resolved" if comment.parent_id.is_none() => {
                self.sheet
                    .comments()
                    .set_thread_resolved(
                        &comment.cell_ref,
                        value
                            .as_bool()
                            .ok_or_else(|| invalid("resolved must be a boolean"))?,
                    )
                    .map_err(engine)?;
            }
            _ => return Err(invalid("Unknown or read-only comment property")),
        }
        Ok(())
    }
}
impl ExtensionObject for CollectionRef {
    fn object_type(&self) -> &'static str {
        "CommentCollection"
    }
    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let fields = properties
            .iter()
            .filter_map(|p| p.strip_prefix("items/").map(str::to_string))
            .collect::<Vec<_>>();
        if properties
            .iter()
            .any(|p| p != "items" && !p.starts_with("items/"))
        {
            return Err(invalid("Unknown comment collection property"));
        }
        let items = self
            .items()?
            .iter()
            .map(|item| Ok(json!({ "key": item.id, "properties": item.load(&fields)? })))
            .collect::<Result<Vec<_>, BatchError>>()?;
        Ok(HashMap::from([("items".into(), json!(items))]))
    }
    fn set(&self, _: &str, _: &Value) -> Result<(), BatchError> {
        Err(invalid("Collection properties are read-only"))
    }
}
fn location_arg(
    context: &HostDispatchContext<'_>,
    value: &Value,
) -> Result<(Sheet, u32, u32), BatchError> {
    let (sheet, address) = if let Some(id) = value["rangeId"].as_str() {
        let range = context.range(id)?;
        (
            range.sheet(),
            range
                .address()
                .ok_or_else(|| invalid("A single cell is required"))?
                .to_string(),
        )
    } else {
        let address = value
            .as_str()
            .ok_or_else(|| invalid("A cell address or Range is required"))?;
        let sheet = if let Some((name, _)) = address.rsplit_once('!') {
            context
                .workbook()
                .sheet_by_name(&name.trim_matches('\'').replace("''", "'"))
                .map_err(engine)?
        } else {
            context.workbook().sheet_by_index(0).map_err(engine)?
        };
        (sheet, address.to_string())
    };
    let parsed = parse_range_address(&sheet, &address).map_err(|e| BatchError {
        code: e.code,
        message: e.message,
    })?;
    let (row, col, er, ec) = parsed.bounds();
    if row != er || col != ec {
        return Err(invalid("A single cell is required"));
    }
    Ok((sheet, row, col))
}
fn text<'a>(op: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    op[field]
        .as_str()
        .ok_or_else(|| invalid(format!("{field} is required")))
}
fn missing() -> BatchError {
    BatchError {
        code: "ItemNotFound",
        message: "The comment was not found".into(),
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
