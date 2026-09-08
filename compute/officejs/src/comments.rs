//! Office.js comment and reply adapters.
//!
//! The JavaScript proxies in comments.js use the extension dispatch hook
//! rather than a second host-side workbook. All reads resolve the current
//! comment from compute-api so updates made through another proxy are visible
//! immediately. The adapter deliberately exposes only threaded comments;
//! legacy notes remain available to the compute API's note-specific surface.
//!
//! Wire operations claimed by CommentHandler:
//!
//! * getCommentCollection { id, worksheetId: null|string }
//! * commentCollectionGetCount { collectionId, resultId }
//! * commentCollectionGetItem { id, collectionId, key, orNullObject }
//! * commentCollectionGetItemAt { id, collectionId, index, orNullObject }
//! * commentCollectionGetItemByCell { id, collectionId, rangeId?, address? }
//! * commentCollectionGetItemByReplyId { id, collectionId, replyId }
//! * commentAdd { id, collectionId, rangeId?, address?, content, contentType? }
//! * getCommentReplyCollection { id, commentId }
//! * commentReplyCollectionGetCount { collectionId, resultId }
//! * commentReplyCollectionGetItem { id, collectionId, key, orNullObject }
//! * commentReplyCollectionGetItemAt { id, collectionId, index, orNullObject }
//! * commentReplyAdd { id, commentId, content, contentType? }
//! * commentDelete { id }, commentReplyDelete { id }
//! * commentUpdateMentions { id, content, mentions }
//!
//! Generic load and set operations are routed by the shared host extension
//! binding to ExtensionObject implementations below.

use std::collections::HashMap;
use std::sync::Arc;

use compute_api::{Sheet, Workbook, mutation::CellInput};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;
use crate::range_navigation::{RangeAddress, RangeNavigationError, parse_range_address};

/// Office.js does not provide the current host user's identity to this
/// headless runtime. New comments use this explicit value instead of
/// masquerading as a human user; imported author names/emails are preserved.
pub(crate) const UNAVAILABLE_HOST_AUTHOR: &str = "Unavailable";

const DEFAULT_COMMENT_PROPERTIES: &[&str] = &[
    "authorEmail",
    "authorName",
    "content",
    "contentType",
    "creationDate",
    "id",
    "mentions",
    "resolved",
    "richContent",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommentError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl CommentError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn item_not_found(key: impl AsRef<str>) -> Self {
        Self {
            code: "ItemNotFound",
            message: format!("Comment '{}' was not found.", key.as_ref()),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }
}

fn batch_error(error: CommentError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn engine(error: impl std::fmt::Display) -> CommentError {
    CommentError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: impl std::fmt::Display) -> CommentError {
    CommentError {
        code: "GeneralException",
        message: format!("failed to decode persisted comment data: {error}"),
    }
}

fn unsupported_load(object: &str, property: &str) -> CommentError {
    CommentError {
        code: "InvalidArgument",
        message: format!("{object}.{property} is not supported"),
    }
}

/// A small local projection of the persisted domain comment. Keeping this
/// wire model in the officejs crate avoids making the runtime depend on the
/// domain-types crate directly; compute-api remains the only production data
/// boundary.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredComment {
    #[serde(default)]
    id: String,
    #[serde(default)]
    cell_ref: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    author_email: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    runs: Vec<StoredRun>,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    resolved: Option<bool>,
    #[serde(default)]
    created_at: Option<u64>,
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    mentions: Vec<StoredMention>,
    #[serde(default)]
    comment_type: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRun {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMention {
    #[serde(default)]
    display_text: String,
    #[serde(default)]
    email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkbookCommentWire {
    sheet_id: String,
    comment: StoredComment,
}

#[derive(Debug, Clone)]
struct CommentRecord {
    sheet: Sheet,
    comment: StoredComment,
}

fn decode_comment<T: Serialize>(value: &T) -> Result<StoredComment, CommentError> {
    let value = serde_json::to_value(value).map_err(encoding)?;
    serde_json::from_value(value).map_err(encoding)
}

fn plain_content(comment: &StoredComment) -> String {
    comment
        .content
        .clone()
        .unwrap_or_else(|| comment.runs.iter().map(|run| run.text.as_str()).collect())
}

fn is_threaded(comment: &StoredComment) -> bool {
    comment
        .comment_type
        .as_deref()
        .map(|kind| kind.eq_ignore_ascii_case("threadedComment"))
        .unwrap_or(true)
}

fn is_root(comment: &StoredComment) -> bool {
    is_threaded(comment) && comment.parent_id.is_none()
}

fn content_type(comment: &StoredComment) -> &'static str {
    if comment
        .content_type
        .as_deref()
        .is_some_and(|kind| kind.eq_ignore_ascii_case("mention"))
    {
        "Mention"
    } else {
        "Plain"
    }
}

fn comment_properties(
    comment: &StoredComment,
    properties: &[String],
) -> Result<HashMap<String, Value>, CommentError> {
    let mut result = HashMap::new();
    for property in properties {
        let value = match property.as_str() {
            "authorEmail" => Value::String(comment.author_email.clone().unwrap_or_default()),
            "authorName" => Value::String(comment.author.clone()),
            "content" => Value::String(plain_content(comment)),
            "contentType" => Value::String(content_type(comment).to_string()),
            // created_at is compute-api's lossless Unix-millisecond
            // representation. The JavaScript proxy turns this into Date;
            // notes imported from legacy comments correctly remain null.
            "creationDate" => comment
                .created_at
                .map_or(Value::Null, |millis| json!(millis)),
            "id" => Value::String(comment.id.clone()),
            "mentions" => Value::Array(
                comment
                    .mentions
                    .iter()
                    .enumerate()
                    .map(|(id, mention)| {
                        json!({
                            "id": id,
                            "name": mention.display_text,
                            "email": mention.email.clone().unwrap_or_default(),
                        })
                    })
                    .collect(),
            ),
            "resolved" => Value::Bool(comment.resolved.unwrap_or(false)),
            "richContent" => Value::String(plain_content(comment)),
            other => return Err(unsupported_load("Comment", other)),
        };
        result.insert(property.clone(), value);
    }
    Ok(result)
}

fn collection_item_properties(properties: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for property in properties {
        if let Some(item_property) = property.strip_prefix("items/") {
            if !item_property.is_empty() && !result.iter().any(|p| p == item_property) {
                result.push(item_property.to_string());
            }
        }
    }
    if result.is_empty() {
        DEFAULT_COMMENT_PROPERTIES
            .iter()
            .map(|property| (*property).to_string())
            .collect()
    } else {
        result
    }
}

fn index_argument(index: i64, length: usize, object: &str) -> Result<usize, CommentError> {
    if index < 0 {
        return Err(CommentError::invalid(format!(
            "{object}.getItemAt index must be non-negative"
        )));
    }
    let index = index as usize;
    if index >= length {
        return Err(CommentError::item_not_found(index.to_string()));
    }
    Ok(index)
}

fn persisted_id(result: &compute_api::MutationResult) -> Result<String, CommentError> {
    let value = result
        .data
        .clone()
        .ok_or_else(|| encoding("the compute engine returned no comment data"))?;
    let comment: StoredComment = serde_json::from_value(value).map_err(encoding)?;
    if comment.id.is_empty() {
        Err(encoding("the compute engine returned an empty comment id"))
    } else {
        Ok(comment.id)
    }
}

/// The parsed content/contentType payload accepted by Office.js add and
/// reply operations.
#[derive(Debug, Clone)]
pub(crate) struct CommentInput {
    pub(crate) content: String,
    pub(crate) content_type: CommentContentType,
    pub(crate) mentions: Vec<OfficeMention>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommentContentType {
    Plain,
    Mention,
}

#[derive(Debug, Clone)]
pub(crate) struct OfficeMention {
    pub(crate) name: String,
    pub(crate) email: Option<String>,
}

impl CommentInput {
    pub(crate) fn from_wire(
        content: &Value,
        content_type: Option<&str>,
    ) -> Result<Self, CommentError> {
        let content_type = match content_type.unwrap_or("Plain") {
            "Plain" | "plain" => CommentContentType::Plain,
            "Mention" | "mention" => CommentContentType::Mention,
            other => {
                return Err(CommentError::invalid(format!(
                    "Comment contentType must be 'Plain' or 'Mention', got '{other}'"
                )));
            }
        };
        match content {
            Value::String(content) => Ok(Self {
                content: content.clone(),
                content_type,
                mentions: Vec::new(),
            }),
            Value::Object(object) => {
                let content = object
                    .get("richContent")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        CommentError::invalid("CommentRichContent.richContent must be a string")
                    })?
                    .to_string();
                let mentions = object
                    .get("mentions")
                    .map(parse_mentions)
                    .transpose()?
                    .unwrap_or_default();
                Ok(Self {
                    content,
                    content_type,
                    mentions,
                })
            }
            _ => Err(CommentError::invalid(
                "Comment content must be a string or CommentRichContent object",
            )),
        }
    }

    fn domain_mentions(&self) -> Result<Value, CommentError> {
        let mentions = self
            .mentions
            .iter()
            .map(|mention| {
                let start_index = self.content.find(&mention.name).unwrap_or(0) as u32;
                json!({
                    "displayText": mention.name,
                    // The Office.js mention id is an index into richContent,
                    // not a user identity. Keep the domain's required
                    // identity explicit when the host supplied no email.
                    "userId": mention.email.clone().unwrap_or_else(|| UNAVAILABLE_HOST_AUTHOR.to_string()),
                    "email": mention.email,
                    "startIndex": start_index,
                    "length": mention.name.chars().count() as u32,
                })
            })
            .collect::<Vec<_>>();
        Ok(Value::Array(mentions))
    }
}

fn parse_mentions(value: &Value) -> Result<Vec<OfficeMention>, CommentError> {
    let entries = value
        .as_array()
        .ok_or_else(|| CommentError::invalid("CommentRichContent.mentions must be an array"))?;
    entries
        .iter()
        .map(|entry| {
            let object = entry
                .as_object()
                .ok_or_else(|| CommentError::invalid("each CommentMention must be an object"))?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| CommentError::invalid("CommentMention.name must be a string"))?;
            let email = match object.get("email") {
                None | Some(Value::Null) => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .ok_or_else(|| {
                            CommentError::invalid("CommentMention.email must be a string")
                        })?
                        .to_string(),
                ),
            };
            Ok(OfficeMention {
                name: name.to_string(),
                email,
            })
        })
        .collect()
}

/// Resolve a collection's worksheet scope, if any, to persisted sheet data.
#[derive(Clone)]
pub(crate) struct CommentCollectionRef {
    workbook: Workbook,
    worksheet: Option<Sheet>,
}

impl CommentCollectionRef {
    pub(crate) fn new(workbook: Workbook, worksheet: Option<Sheet>) -> Self {
        Self {
            workbook,
            worksheet,
        }
    }

    pub(crate) fn worksheet(&self) -> Option<Sheet> {
        self.worksheet.clone()
    }

    fn records(&self) -> Result<Vec<CommentRecord>, CommentError> {
        if let Some(sheet) = &self.worksheet {
            let comments = sheet.comments().get_all().map_err(engine)?;
            comments
                .iter()
                .map(|comment| {
                    Ok(CommentRecord {
                        sheet: sheet.clone(),
                        comment: decode_comment(comment)?,
                    })
                })
                .collect()
        } else {
            let comments = self.workbook.get_all_comments().map_err(engine)?;
            comments
                .iter()
                .map(|comment| {
                    let wire: WorkbookCommentWire =
                        serde_json::from_value(serde_json::to_value(comment).map_err(encoding)?)
                            .map_err(encoding)?;
                    let sheet_id =
                        compute_api::SheetId::from_uuid_str(&wire.sheet_id).map_err(engine)?;
                    let sheet = self.workbook.sheet(&sheet_id).map_err(engine)?;
                    Ok(CommentRecord {
                        sheet,
                        comment: wire.comment,
                    })
                })
                .collect()
        }
    }

    fn threaded_roots(&self) -> Result<Vec<CommentRecord>, CommentError> {
        Ok(self
            .records()?
            .into_iter()
            .filter(|r| is_root(&r.comment))
            .collect())
    }

    pub(crate) fn count(&self) -> Result<usize, CommentError> {
        Ok(self.threaded_roots()?.len())
    }

    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<CommentCollectionItem>, CommentError> {
        let item_properties = collection_item_properties(properties);
        self.threaded_roots()?
            .into_iter()
            .map(|record| {
                Ok(CommentCollectionItem {
                    key: record.comment.id.clone(),
                    worksheet_id: record.sheet.id().to_uuid_string(),
                    properties: comment_properties(&record.comment, &item_properties)?,
                })
            })
            .collect()
    }

    pub(crate) fn get_item(&self, id: &str) -> Result<CommentRef, CommentError> {
        let record = self
            .threaded_roots()?
            .into_iter()
            .find(|record| record.comment.id == id)
            .ok_or_else(|| CommentError::item_not_found(id))?;
        Ok(CommentRef::new(
            self.workbook.clone(),
            record.sheet,
            record.comment.id,
            false,
        ))
    }

    pub(crate) fn get_item_at(&self, index: i64) -> Result<CommentRef, CommentError> {
        let records = self.threaded_roots()?;
        let index = index_argument(index, records.len(), "CommentCollection")?;
        let record = &records[index];
        Ok(CommentRef::new(
            self.workbook.clone(),
            record.sheet.clone(),
            record.comment.id.clone(),
            false,
        ))
    }

    pub(crate) fn get_item_or_null_object(
        &self,
        id: &str,
    ) -> Result<Option<CommentRef>, CommentError> {
        match self.get_item(id) {
            Ok(comment) => Ok(Some(comment)),
            Err(error) if error.code == "ItemNotFound" => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub(crate) fn get_item_by_reply_id(&self, reply_id: &str) -> Result<CommentRef, CommentError> {
        let record = self
            .records()?
            .into_iter()
            .find(|record| is_threaded(&record.comment) && record.comment.id == reply_id)
            .ok_or_else(|| CommentError::item_not_found(reply_id))?;
        let root_id = record
            .comment
            .thread_id
            .clone()
            .or(record.comment.parent_id.clone())
            .unwrap_or(record.comment.id.clone());
        self.get_item(&root_id)
    }

    /// Resolve the address argument to a single cell and return its stable
    /// cell identity. Existing data is never overwritten. A blank cell is
    /// materialized as an empty literal only for CommentCollection.add,
    /// because the compute-api comment primitive intentionally takes the
    /// stable identity that backs persisted metadata.
    pub(crate) fn resolve_target(
        &self,
        address: Option<&str>,
        range: Option<&crate::host::RangeRef>,
        materialize_blank: bool,
    ) -> Result<(Sheet, String), CommentError> {
        let (sheet, raw_address) = match range {
            Some(range) => {
                if range.is_null_object() {
                    return Err(CommentError {
                        code: "InvalidObjectPath",
                        message: "The comment cell Range is a null object.".to_string(),
                    });
                }
                if let Some(scope) = &self.worksheet
                    && scope.id() != range.sheet().id()
                {
                    return Err(CommentError::invalid(
                        "The comment cell belongs to a different worksheet",
                    ));
                }
                (
                    range.sheet(),
                    range
                        .address()
                        .ok_or_else(|| {
                            CommentError::invalid(
                                "CommentCollection.add requires a single-cell bounded Range",
                            )
                        })?
                        .to_string(),
                )
            }
            None => {
                let address = address.ok_or_else(|| {
                    CommentError::invalid("CommentCollection.add requires a cell address")
                })?;
                let (sheet, reference) = self.resolve_text_address(address)?;
                (sheet, reference)
            }
        };
        let parsed = parse_range_address(&sheet, &raw_address).map_err(range_error)?;
        let RangeAddress::Cells {
            start_row,
            start_column,
            end_row,
            end_column,
        } = parsed
        else {
            return Err(CommentError::invalid(
                "CommentCollection requires a single-cell address",
            ));
        };
        if start_row != end_row || start_column != end_column {
            return Err(CommentError::invalid(
                "CommentCollection requires a single-cell address",
            ));
        }
        let canonical = parsed.to_a1();
        let data = sheet.get_cell_data(canonical.as_str()).map_err(engine)?;
        if let Some(cell_id) = data
            .as_ref()
            .and_then(|data| data.get("cell_id"))
            .and_then(Value::as_str)
            .filter(|cell_id| !cell_id.is_empty())
        {
            return Ok((sheet, cell_id.to_string()));
        }
        if !materialize_blank {
            return Ok((sheet, canonical));
        }
        if data.is_some() {
            return Err(CommentError::invalid(
                "The target cell has no stable identity and cannot be materialized without changing its data",
            ));
        }
        sheet
            .set_range_typed(
                canonical.as_str(),
                &[vec![Some(CellInput::Literal {
                    text: String::new(),
                })]],
            )
            .map_err(engine)?;
        let data = sheet
            .get_cell_data(canonical.as_str())
            .map_err(engine)?
            .ok_or_else(|| encoding("materialized comment target has no cell data"))?;
        let cell_id = data
            .get("cell_id")
            .and_then(Value::as_str)
            .filter(|cell_id| !cell_id.is_empty())
            .ok_or_else(|| encoding("materialized comment target has no stable identity"))?;
        Ok((sheet, cell_id.to_string()))
    }

    fn resolve_text_address(&self, address: &str) -> Result<(Sheet, String), CommentError> {
        let separator = address.rfind('!').ok_or_else(|| {
            CommentError::invalid(
                "CommentCollection cellAddress strings must include the worksheet name",
            )
        })?;
        let sheet_token = unquote_sheet_name(&address[..separator]).ok_or_else(|| {
            CommentError::invalid("CommentCollection cellAddress has an invalid worksheet name")
        })?;
        let sheet = self.workbook.sheet_by_name(&sheet_token).map_err(engine)?;
        if let Some(scope) = &self.worksheet
            && scope.id() != sheet.id()
        {
            return Err(CommentError::invalid(
                "The comment cell address belongs to a different worksheet",
            ));
        }
        Ok((sheet, address[separator + 1..].to_string()))
    }

    pub(crate) fn add(
        &self,
        sheet: Sheet,
        cell_id: &str,
        input: &CommentInput,
    ) -> Result<CommentRef, CommentError> {
        if let Some(scope) = &self.worksheet
            && scope.id() != sheet.id()
        {
            return Err(CommentError::invalid(
                "The comment cell belongs to a different worksheet",
            ));
        }
        let result = sheet
            .comments()
            .add(
                cell_id,
                UNAVAILABLE_HOST_AUTHOR,
                &input.content,
                None,
                None,
                Default::default(),
            )
            .map_err(engine)?;
        let id = persisted_id(&result)?;
        apply_mention_content(&sheet, &id, input)?;
        Ok(CommentRef::new(self.workbook.clone(), sheet, id, false))
    }
}

fn range_error(error: RangeNavigationError) -> CommentError {
    CommentError {
        code: error.code,
        message: error.message,
    }
}

fn unquote_sheet_name(token: &str) -> Option<String> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    if token.starts_with('\'') {
        if !token.ends_with('\'') || token.len() < 2 {
            return None;
        }
        return Some(token[1..token.len() - 1].replace("''", "'"));
    }
    Some(token.to_string())
}

fn apply_mention_content(
    sheet: &Sheet,
    comment_id: &str,
    input: &CommentInput,
) -> Result<(), CommentError> {
    if input.content_type != CommentContentType::Mention {
        return Ok(());
    }
    let mention_value = input.domain_mentions()?;
    let mentions = serde_json::from_value(mention_value).map_err(encoding)?;
    sheet
        .comments()
        .update_mentions(comment_id, &input.content, mentions)
        .map_err(engine)?;
    Ok(())
}

/// One collection descriptor consumed by __mogOfficeJs.configureCollection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommentCollectionItem {
    pub(crate) key: String,
    pub(crate) worksheet_id: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A live comment proxy bound to a specific worksheet and stable comment ID.
#[derive(Clone)]
pub(crate) struct CommentRef {
    workbook: Workbook,
    sheet: Sheet,
    id: String,
    null_object: bool,
}

impl CommentRef {
    fn new(workbook: Workbook, sheet: Sheet, id: String, null_object: bool) -> Self {
        Self {
            workbook,
            sheet,
            id,
            null_object,
        }
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }

    fn resolve(&self) -> Result<StoredComment, CommentError> {
        if self.null_object {
            return Err(CommentError {
                code: "InvalidObjectPath",
                message: "Comment is a null object.".to_string(),
            });
        }
        let comment = self
            .sheet
            .comments()
            .get(&self.id)
            .map_err(engine)?
            .ok_or_else(|| CommentError::item_not_found(&self.id))?;
        decode_comment(&comment)
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, CommentError> {
        if self.null_object {
            let mut result = HashMap::new();
            for property in properties {
                if property == "isNullObject" {
                    result.insert(property.clone(), Value::Bool(true));
                } else {
                    return Err(CommentError {
                        code: "InvalidObjectPath",
                        message: format!("Comment.{property} cannot be loaded from a null object"),
                    });
                }
            }
            return Ok(result);
        }
        let properties = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect::<Vec<_>>();
        comment_properties(&self.resolve()?, &properties)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), CommentError> {
        let _comment = self.resolve()?;
        match property {
            "content" => {
                let content = value
                    .as_str()
                    .ok_or_else(|| CommentError::invalid("Comment.content must be a string"))?;
                self.sheet
                    .comments()
                    .update(&self.id, content)
                    .map_err(engine)?;
                Ok(())
            }
            "resolved" => {
                let resolved = value
                    .as_bool()
                    .ok_or_else(|| CommentError::invalid("Comment.resolved must be a boolean"))?;
                self.sheet
                    .comments()
                    .set_thread_resolved(&self.id, resolved)
                    .map_err(engine)?;
                Ok(())
            }
            other => Err(CommentError::unsupported(format!(
                "Comment.{other} is read-only or unsupported"
            ))),
        }
    }

    pub(crate) fn delete(&self) -> Result<(), CommentError> {
        let comment = self.resolve()?;
        // Office's Comment.delete removes the complete thread. Delete replies
        // first so the root operation remains valid even if the backend later
        // adds cascading deletion semantics of its own.
        let thread_id = comment
            .thread_id
            .clone()
            .unwrap_or_else(|| comment.id.clone());
        let thread = self
            .sheet
            .comments()
            .get_thread(&thread_id)
            .map_err(engine)?;
        for reply in thread.iter().filter_map(|reply| {
            decode_comment(reply)
                .ok()
                .filter(|reply| reply.id != comment.id)
                .map(|reply| reply.id)
        }) {
            self.sheet.comments().delete(&reply).map_err(engine)?;
        }
        self.sheet.comments().delete(&comment.id).map_err(engine)?;
        Ok(())
    }

    pub(crate) fn update_mentions(
        &self,
        content: &Value,
        mentions: Option<&Value>,
    ) -> Result<(), CommentError> {
        let content = content.as_str().ok_or_else(|| {
            CommentError::invalid("CommentRichContent.richContent must be a string")
        })?;
        let mentions = mentions
            .map(parse_mentions)
            .transpose()?
            .unwrap_or_default();
        let input = CommentInput {
            content: content.to_string(),
            content_type: CommentContentType::Mention,
            mentions,
        };
        apply_mention_content(&self.sheet, &self.id, &input)
    }

    pub(crate) fn replies(&self) -> CommentReplyCollectionRef {
        CommentReplyCollectionRef {
            parent: Arc::new(self.clone()),
        }
    }

    /// Return the persisted cell reference. For live comments this is a
    /// stable cell ID; imported comments may carry an A1 reference. The host
    /// can use this to bind getLocation when a range reverse lookup exists.
    pub(crate) fn cell_ref(&self) -> Result<String, CommentError> {
        Ok(self.resolve()?.cell_ref)
    }
}

impl ExtensionObject for CommentRef {
    fn object_type(&self) -> &'static str {
        "Comment"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        CommentRef::load(self, properties).map_err(batch_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        CommentRef::set(self, property, value).map_err(batch_error)
    }
}

/// A collection of direct replies to a root comment.
#[derive(Clone)]
pub(crate) struct CommentReplyCollectionRef {
    parent: Arc<CommentRef>,
}

impl CommentReplyCollectionRef {
    pub(crate) fn parent(&self) -> Arc<CommentRef> {
        self.parent.clone()
    }

    fn records(&self) -> Result<Vec<StoredComment>, CommentError> {
        let root = self.parent.resolve()?;
        self.parent
            .sheet
            .comments()
            .get_thread(root.thread_id.as_deref().unwrap_or(root.id.as_str()))
            .map_err(engine)?
            .iter()
            .map(decode_comment)
            .filter_map(|result| match result {
                Ok(comment) if comment.parent_id.as_deref() == Some(root.id.as_str()) => {
                    Some(Ok(comment))
                }
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect()
    }

    pub(crate) fn count(&self) -> Result<usize, CommentError> {
        Ok(self.records()?.len())
    }

    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<CommentCollectionItem>, CommentError> {
        let item_properties = collection_item_properties(properties);
        self.records()?
            .into_iter()
            .map(|comment| {
                Ok(CommentCollectionItem {
                    key: comment.id.clone(),
                    worksheet_id: self.parent.sheet.id().to_uuid_string(),
                    properties: comment_properties(&comment, &item_properties)?,
                })
            })
            .collect()
    }

    pub(crate) fn get_item(&self, id: &str) -> Result<CommentReplyRef, CommentError> {
        if !self.records()?.iter().any(|comment| comment.id == id) {
            return Err(CommentError::item_not_found(id));
        }
        Ok(CommentReplyRef {
            parent: self.parent.clone(),
            id: id.to_string(),
            null_object: false,
        })
    }

    pub(crate) fn get_item_at(&self, index: i64) -> Result<CommentReplyRef, CommentError> {
        let records = self.records()?;
        let index = index_argument(index, records.len(), "CommentReplyCollection")?;
        Ok(CommentReplyRef {
            parent: self.parent.clone(),
            id: records[index].id.clone(),
            null_object: false,
        })
    }

    pub(crate) fn get_item_or_null_object(
        &self,
        id: &str,
    ) -> Result<Option<CommentReplyRef>, CommentError> {
        match self.get_item(id) {
            Ok(reply) => Ok(Some(reply)),
            Err(error) if error.code == "ItemNotFound" => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub(crate) fn add(&self, input: &CommentInput) -> Result<CommentReplyRef, CommentError> {
        let root = self.parent.resolve()?;
        let result = self
            .parent
            .sheet
            .comments()
            .add(
                &root.cell_ref,
                UNAVAILABLE_HOST_AUTHOR,
                &input.content,
                None,
                Some(&root.id),
                Default::default(),
            )
            .map_err(engine)?;
        let id = persisted_id(&result)?;
        apply_mention_content(&self.parent.sheet, &id, input)?;
        Ok(CommentReplyRef {
            parent: self.parent.clone(),
            id,
            null_object: false,
        })
    }
}

impl ExtensionObject for CommentReplyCollectionRef {
    fn object_type(&self) -> &'static str {
        "CommentReplyCollection"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let mut result = HashMap::new();
        let item_properties = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect::<Vec<_>>();
        if properties.iter().any(|property| property == "items")
            || properties
                .iter()
                .any(|property| property.starts_with("items/"))
        {
            let items = self
                .collection_items(&item_properties)
                .map_err(batch_error)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(items)
                    .map_err(encoding)
                    .map_err(batch_error)?,
            );
        } else if properties.iter().any(|property| property != "isNullObject") {
            let property = properties
                .iter()
                .find(|property| property.as_str() != "isNullObject")
                .expect("property exists");
            return Err(batch_error(unsupported_load(
                "CommentReplyCollection",
                property,
            )));
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(batch_error(CommentError::unsupported(format!(
            "CommentReplyCollection.{property} is read-only or unsupported"
        ))))
    }
}

/// A live reply proxy anchored to its root comment.
#[derive(Clone)]
pub(crate) struct CommentReplyRef {
    parent: Arc<CommentRef>,
    id: String,
    null_object: bool,
}

impl CommentReplyRef {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn parent(&self) -> Arc<CommentRef> {
        self.parent.clone()
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }

    fn resolve(&self) -> Result<StoredComment, CommentError> {
        if self.null_object {
            return Err(CommentError {
                code: "InvalidObjectPath",
                message: "CommentReply is a null object.".to_string(),
            });
        }
        let root = self.parent.resolve()?;
        let comments = self
            .parent
            .sheet
            .comments()
            .get_thread(root.thread_id.as_deref().unwrap_or(root.id.as_str()))
            .map_err(engine)?;
        comments
            .iter()
            .map(decode_comment)
            .filter_map(Result::ok)
            .find(|comment| comment.id == self.id && comment.parent_id.is_some())
            .ok_or_else(|| CommentError::item_not_found(&self.id))
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, CommentError> {
        if self.null_object {
            let mut result = HashMap::new();
            for property in properties {
                if property == "isNullObject" {
                    result.insert(property.clone(), Value::Bool(true));
                } else {
                    return Err(CommentError {
                        code: "InvalidObjectPath",
                        message: format!(
                            "CommentReply.{property} cannot be loaded from a null object"
                        ),
                    });
                }
            }
            return Ok(result);
        }
        let properties = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect::<Vec<_>>();
        comment_properties(&self.resolve()?, &properties)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), CommentError> {
        let _reply = self.resolve()?;
        match property {
            "content" => {
                let content = value.as_str().ok_or_else(|| {
                    CommentError::invalid("CommentReply.content must be a string")
                })?;
                self.parent
                    .sheet
                    .comments()
                    .update(&self.id, content)
                    .map_err(engine)?;
                Ok(())
            }
            other => Err(CommentError::unsupported(format!(
                "CommentReply.{other} is read-only or unsupported"
            ))),
        }
    }

    pub(crate) fn delete(&self) -> Result<(), CommentError> {
        self.resolve()?;
        self.parent
            .sheet
            .comments()
            .delete(&self.id)
            .map_err(engine)?;
        Ok(())
    }

    pub(crate) fn update_mentions(
        &self,
        content: &Value,
        mentions: Option<&Value>,
    ) -> Result<(), CommentError> {
        let content = content.as_str().ok_or_else(|| {
            CommentError::invalid("CommentRichContent.richContent must be a string")
        })?;
        let mentions = mentions
            .map(parse_mentions)
            .transpose()?
            .unwrap_or_default();
        let input = CommentInput {
            content: content.to_string(),
            content_type: CommentContentType::Mention,
            mentions,
        };
        apply_mention_content(&self.parent.sheet, &self.id, &input)
    }
}

impl ExtensionObject for CommentReplyRef {
    fn object_type(&self) -> &'static str {
        "CommentReply"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        CommentReplyRef::load(self, properties).map_err(batch_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        CommentReplyRef::set(self, property, value).map_err(batch_error)
    }
}

impl ExtensionObject for CommentCollectionRef {
    fn object_type(&self) -> &'static str {
        "CommentCollection"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let mut result = HashMap::new();
        let item_properties = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect::<Vec<_>>();
        if properties.iter().any(|property| property == "items")
            || properties
                .iter()
                .any(|property| property.starts_with("items/"))
        {
            let items = self
                .collection_items(&item_properties)
                .map_err(batch_error)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(items)
                    .map_err(encoding)
                    .map_err(batch_error)?,
            );
        } else if properties.iter().any(|property| property != "isNullObject") {
            let property = properties
                .iter()
                .find(|property| property.as_str() != "isNullObject")
                .expect("property exists");
            return Err(batch_error(unsupported_load("CommentCollection", property)));
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(batch_error(CommentError::unsupported(format!(
            "CommentCollection.{property} is read-only or unsupported"
        ))))
    }
}

/// Family handler used by Host::register_extension.
pub(crate) struct CommentHandler;

pub(crate) fn handler() -> CommentHandler {
    CommentHandler
}

impl ExtensionHandler for CommentHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "getCommentCollection"
                | "commentCollectionGetCount"
                | "commentCollectionGetItem"
                | "commentCollectionGetItemAt"
                | "commentCollectionGetItemByCell"
                | "commentCollectionGetItemByReplyId"
                | "commentAdd"
                | "getCommentReplyCollection"
                | "commentReplyCollectionGetCount"
                | "commentReplyCollectionGetItem"
                | "commentReplyCollectionGetItemAt"
                | "commentReplyAdd"
                | "commentDelete"
                | "commentReplyDelete"
                | "commentUpdateMentions"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let op = operation
            .get("op")
            .and_then(Value::as_str)
            .expect("can_handle only receives operations with an op");
        match op {
            "getCommentCollection" => {
                let id = required_string(operation, "id")?;
                let worksheet = optional_string(operation, "worksheetId")?
                    .map(|worksheet_id| context.worksheet(worksheet_id).map(|ref_| ref_.sheet()))
                    .transpose()?;
                context.bind_object(
                    id,
                    Arc::new(CommentCollectionRef::new(context.workbook(), worksheet)),
                );
                Ok(true)
            }
            "commentCollectionGetCount" => {
                let collection_id = required_string(operation, "collectionId")?;
                let result_id = required_string(operation, "resultId")?;
                let collection = context.extension_object::<CommentCollectionRef>(collection_id)?;
                context.set_result(result_id, json!(collection.count().map_err(batch_error)?));
                Ok(true)
            }
            "commentCollectionGetItem" | "commentCollectionGetItemAt" => {
                let id = required_string(operation, "id")?;
                let collection_id = required_string(operation, "collectionId")?;
                let collection = context.extension_object::<CommentCollectionRef>(collection_id)?;
                let or_null = operation
                    .get("orNullObject")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let item = if op == "commentCollectionGetItem" {
                    collection.get_item(required_string(operation, "key")?)
                } else {
                    collection.get_item_at(required_i64(operation, "index")?)
                };
                match item {
                    Ok(item) => {
                        context.bind_object(id, Arc::new(item));
                    }
                    Err(error) if or_null && error.code == "ItemNotFound" => {
                        context.bind_null_object(id);
                    }
                    Err(error) => return Err(batch_error(error)),
                }
                Ok(true)
            }
            "commentCollectionGetItemByCell" => {
                let id = required_string(operation, "id")?;
                let collection_id = required_string(operation, "collectionId")?;
                let collection = context.extension_object::<CommentCollectionRef>(collection_id)?;
                let (sheet, canonical) = target_for_lookup(operation, context, &collection)?;
                let cell_id = sheet
                    .get_cell_data(canonical.as_str())
                    .map_err(engine)
                    .map_err(batch_error)?
                    .and_then(|data| {
                        data.get("cell_id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    });
                let record = collection
                    .records()?
                    .into_iter()
                    .find(|record| {
                        record.comment.cell_ref == canonical
                            || cell_id
                                .as_deref()
                                .is_some_and(|cell_id| record.comment.cell_ref == cell_id)
                    })
                    .ok_or_else(|| CommentError::item_not_found(canonical.clone()));
                context.bind_object(
                    id,
                    Arc::new(record.map(|record| {
                        CommentRef::new(
                            collection.workbook.clone(),
                            record.sheet,
                            record.comment.id,
                            false,
                        )
                    })?),
                );
                Ok(true)
            }
            "commentCollectionGetItemByReplyId" => {
                let id = required_string(operation, "id")?;
                let collection_id = required_string(operation, "collectionId")?;
                let reply_id = required_string(operation, "replyId")?;
                let collection = context.extension_object::<CommentCollectionRef>(collection_id)?;
                let item = collection
                    .get_item_by_reply_id(reply_id)
                    .map_err(batch_error)?;
                context.bind_object(id, Arc::new(item));
                Ok(true)
            }
            "commentAdd" => {
                let id = required_string(operation, "id")?;
                let collection_id = required_string(operation, "collectionId")?;
                let collection = context.extension_object::<CommentCollectionRef>(collection_id)?;
                let range_id = optional_string(operation, "rangeId")?;
                let range = range_id
                    .map(|range_id| context.range(range_id))
                    .transpose()?;
                let address = optional_string(operation, "address")?;
                let input = CommentInput::from_wire(
                    operation.get("content").ok_or_else(|| {
                        batch_error(CommentError::invalid("Comment.add requires content"))
                    })?,
                    optional_string(operation, "contentType")?,
                )
                .map_err(batch_error)?;
                let (sheet, cell_id) = collection
                    .resolve_target(address, range.as_ref(), true)
                    .map_err(batch_error)?;
                let item = collection
                    .add(sheet, &cell_id, &input)
                    .map_err(batch_error)?;
                context.bind_object(id, Arc::new(item));
                Ok(true)
            }
            "getCommentReplyCollection" => {
                let id = required_string(operation, "id")?;
                let comment_id = required_string(operation, "commentId")?;
                let comment = context.extension_object::<CommentRef>(comment_id)?;
                context.bind_object(id, Arc::new(comment.replies()));
                Ok(true)
            }
            "commentReplyCollectionGetCount" => {
                let collection_id = required_string(operation, "collectionId")?;
                let result_id = required_string(operation, "resultId")?;
                let collection =
                    context.extension_object::<CommentReplyCollectionRef>(collection_id)?;
                context.set_result(result_id, json!(collection.count().map_err(batch_error)?));
                Ok(true)
            }
            "commentReplyCollectionGetItem" | "commentReplyCollectionGetItemAt" => {
                let id = required_string(operation, "id")?;
                let collection_id = required_string(operation, "collectionId")?;
                let collection =
                    context.extension_object::<CommentReplyCollectionRef>(collection_id)?;
                let or_null = operation
                    .get("orNullObject")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let item = if op == "commentReplyCollectionGetItem" {
                    collection.get_item(required_string(operation, "key")?)
                } else {
                    collection.get_item_at(required_i64(operation, "index")?)
                };
                match item {
                    Ok(item) => context.bind_object(id, Arc::new(item)),
                    Err(error) if or_null && error.code == "ItemNotFound" => {
                        context.bind_null_object(id)
                    }
                    Err(error) => return Err(batch_error(error)),
                }
                Ok(true)
            }
            "commentReplyAdd" => {
                let id = required_string(operation, "id")?;
                let comment_id = required_string(operation, "commentId")?;
                let comment = context.extension_object::<CommentRef>(comment_id)?;
                let input = CommentInput::from_wire(
                    operation.get("content").ok_or_else(|| {
                        batch_error(CommentError::invalid(
                            "CommentReplyCollection.add requires content",
                        ))
                    })?,
                    optional_string(operation, "contentType")?,
                )
                .map_err(batch_error)?;
                let item = comment.replies().add(&input).map_err(batch_error)?;
                context.bind_object(id, Arc::new(item));
                Ok(true)
            }
            "commentDelete" => {
                let id = required_string(operation, "id")?;
                let comment = context.extension_object::<CommentRef>(id)?;
                comment.delete().map_err(batch_error)?;
                Ok(true)
            }
            "commentReplyDelete" => {
                let id = required_string(operation, "id")?;
                let reply = context.extension_object::<CommentReplyRef>(id)?;
                reply.delete().map_err(batch_error)?;
                Ok(true)
            }
            "commentUpdateMentions" => {
                let id = required_string(operation, "id")?;
                let content = operation.get("content").ok_or_else(|| {
                    batch_error(CommentError::invalid(
                        "Comment.updateMentions requires content",
                    ))
                })?;
                let mentions = operation.get("mentions");
                if let Ok(comment) = context.extension_object::<CommentRef>(id) {
                    comment
                        .update_mentions(content, mentions)
                        .map_err(batch_error)?;
                } else {
                    let reply = context.extension_object::<CommentReplyRef>(id)?;
                    reply
                        .update_mentions(content, mentions)
                        .map_err(batch_error)?;
                }
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

fn required_string<'a>(operation: &'a Value, name: &str) -> Result<&'a str, BatchError> {
    operation
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("comment operation requires a non-empty string '{name}'"),
        })
}

fn optional_string<'a>(operation: &'a Value, name: &str) -> Result<Option<&'a str>, BatchError> {
    match operation.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| BatchError {
                code: "InvalidArgument",
                message: format!("comment operation field '{name}' must be a string"),
            }),
    }
}

fn required_i64(operation: &Value, name: &str) -> Result<i64, BatchError> {
    operation
        .get(name)
        .and_then(Value::as_i64)
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("comment operation requires integer '{name}'"),
        })
}

fn target_for_lookup(
    operation: &Value,
    context: &HostDispatchContext<'_>,
    collection: &CommentCollectionRef,
) -> Result<(Sheet, String), BatchError> {
    if let Some(range_id) = optional_string(operation, "rangeId")? {
        let range = context.range(range_id)?;
        if range.is_null_object() {
            return Err(BatchError {
                code: "InvalidObjectPath",
                message: "The comment cell Range is a null object.".to_string(),
            });
        }
        let address = range.address().ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: "CommentCollection.getItemByCell requires a single-cell Range".to_string(),
        })?;
        let sheet = range.sheet();
        if let Some(scope) = collection.worksheet.as_ref()
            && scope.id() != sheet.id()
        {
            return Err(BatchError {
                code: "InvalidArgument",
                message: "The comment cell belongs to a different worksheet".to_string(),
            });
        }
        let parsed = parse_range_address(&sheet, address)
            .map_err(range_error)
            .map_err(batch_error)?;
        let RangeAddress::Cells {
            start_row,
            start_column,
            end_row,
            end_column,
        } = parsed
        else {
            return Err(BatchError {
                code: "InvalidArgument",
                message: "CommentCollection.getItemByCell requires a single-cell Range".to_string(),
            });
        };
        if start_row != end_row || start_column != end_column {
            return Err(BatchError {
                code: "InvalidArgument",
                message: "CommentCollection.getItemByCell requires a single-cell Range".to_string(),
            });
        }
        return Ok((sheet, parsed.to_a1()));
    }
    let address = required_string(operation, "address")?;
    let (sheet, reference) = collection
        .resolve_text_address(address)
        .map_err(batch_error)?;
    let parsed = parse_range_address(&sheet, &reference)
        .map_err(range_error)
        .map_err(batch_error)?;
    let RangeAddress::Cells {
        start_row,
        start_column,
        end_row,
        end_column,
    } = parsed
    else {
        return Err(BatchError {
            code: "InvalidArgument",
            message: "CommentCollection.getItemByCell requires a single-cell address".to_string(),
        });
    };
    if start_row != end_row || start_column != end_column {
        return Err(BatchError {
            code: "InvalidArgument",
            message: "CommentCollection.getItemByCell requires a single-cell address".to_string(),
        });
    }
    Ok((sheet, parsed.to_a1()))
}
