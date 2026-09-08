//! Comment and reply regressions through the shipped Office.js runtime.

use mog::run_office_js;
use serde_json::json;

#[test]
fn comments_persist_through_collection_lookup_and_reply_lifecycle() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const comments = sheet.comments;
          const root = comments.add(sheet.getRange("A1"), "root comment");
          root.load("authorEmail,authorName,content,contentType,creationDate,id,resolved,richContent");
          const count = comments.getCount();
          await context.sync();

          const reply = root.replies.add("first reply");
          reply.load("authorEmail,authorName,content,contentType,creationDate,id,resolved,richContent");
          const replyCount = root.replies.getCount();
          root.replies.load("items");
          await context.sync();

          const byCell = comments.getItemByCell(sheet.getRange("A1"));
          byCell.load("id,content");
          const byReply = comments.getItemByReplyId(reply.id);
          byReply.load("id");
          await context.sync();

          root.content = "edited root";
          root.resolved = true;
          reply.content = "edited reply";
          root.load("content,resolved");
          reply.load("content,resolved");
          await context.sync();

          const beforeDelete = {
            root: root.toJSON(),
            reply: reply.toJSON(),
            replyCount: replyCount.value,
            byCell: byCell.toJSON(),
            byReply: byReply.toJSON(),
            dateIsDate: root.creationDate instanceof Date,
            types: {
              workbookCollection: context.workbook.comments instanceof Excel.CommentCollection,
              worksheetCollection: comments instanceof Excel.CommentCollection,
              comment: root instanceof Excel.Comment,
              replyCollection: root.replies instanceof Excel.CommentReplyCollection,
              reply: reply instanceof Excel.CommentReply,
              clientObject: root instanceof OfficeExtension.ClientObject
            }
          };

          root.delete();
          await context.sync();
          const missing = comments.getItemOrNullObject(root.id);
          missing.load("isNullObject");
          const afterCount = comments.getCount();
          await context.sync();
          return {
            beforeDelete,
            afterDelete: {
              isNullObject: missing.isNullObject,
              count: afterCount.value
            }
          };
        });
        "#,
    )
    .expect("comment and reply lifecycle should succeed");

    assert_eq!(
        output.value["beforeDelete"]["root"]["authorName"],
        json!("Unavailable")
    );
    assert_eq!(output.value["beforeDelete"]["root"]["authorEmail"], json!(""));
    assert_eq!(
        output.value["beforeDelete"]["root"]["content"],
        json!("edited root")
    );
    assert_eq!(
        output.value["beforeDelete"]["reply"]["content"],
        json!("edited reply")
    );
    assert_eq!(output.value["beforeDelete"]["root"]["contentType"], json!("Plain"));
    assert_eq!(output.value["beforeDelete"]["reply"]["contentType"], json!("Plain"));
    assert_eq!(output.value["beforeDelete"]["root"]["resolved"], json!(true));
    assert_eq!(output.value["beforeDelete"]["reply"]["resolved"], json!(true));
    assert_eq!(output.value["beforeDelete"]["replyCount"], json!(1));
    assert_eq!(
        output.value["beforeDelete"]["byCell"]["content"],
        json!("root comment")
    );
    assert_eq!(
        output.value["beforeDelete"]["byReply"]["id"],
        output.value["beforeDelete"]["root"]["id"]
    );
    assert_eq!(output.value["beforeDelete"]["dateIsDate"], json!(true));
    assert_eq!(
        output.value["beforeDelete"]["types"],
        json!({
            "workbookCollection": true,
            "worksheetCollection": true,
            "comment": true,
            "replyCollection": true,
            "reply": true,
            "clientObject": true
        })
    );
    assert_eq!(
        output.value["afterDelete"],
        json!({ "isNullObject": true, "count": 0 })
    );
}

#[test]
fn comments_support_plain_and_mention_content_payloads() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const comments = context.workbook.comments;
          const plain = comments.add(
            "Sheet1!B2",
            "plain",
            Excel.ContentType.plain
          );
          const mention = comments.add(
            "Sheet1!C3",
            {
              richContent: "hello Alice",
              mentions: [{ id: 0, name: "Alice", email: "alice@example.com" }]
            },
            "Mention"
          );
          plain.load("content,contentType,mentions");
          mention.load("content,contentType,mentions,richContent");
          const count = comments.getCount();
          await context.sync();
          return {
            plain: plain.toJSON(),
            mention: mention.toJSON(),
            count: count.value
          };
        });
        "#,
    )
    .expect("comment content payloads should succeed");

    assert_eq!(
        output.value["plain"],
        json!({
            "content": "plain",
            "contentType": "Plain",
            "mentions": []
        })
    );
    assert_eq!(
        output.value["mention"]["content"],
        json!("hello Alice")
    );
    assert_eq!(
        output.value["mention"]["contentType"],
        json!("Mention")
    );
    assert_eq!(
        output.value["mention"]["mentions"][0],
        json!({
            "id": 0,
            "name": "Alice",
            "email": "alice@example.com"
        })
    );
    assert_eq!(output.value["count"], json!(2));
}
