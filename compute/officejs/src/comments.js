(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function CommentCollection(context) {
    ClientObject.call(this, context);
  }
  CommentCollection.prototype = Object.create(ClientObject.prototype);
  CommentCollection.prototype.constructor = CommentCollection;

  CommentCollection.prototype.add = function (cellAddress, content) {
    var comment = new Comment(this.context);
    this.context._queue.push({
      op: "commentAdd",
      id: comment._id,
      cellAddress: String(cellAddress),
      content: content == null ? "" : String(content),
    });
    return comment;
  };

  function Comment(context) {
    ClientObject.call(this, context);
  }
  Comment.prototype = Object.create(ClientObject.prototype);
  Comment.prototype.constructor = Comment;

  Object.defineProperty(Excel.Workbook.prototype, "comments", {
    configurable: true,
    get: function () {
      if (!this._comments) this._comments = new CommentCollection(this.context);
      return this._comments;
    },
  });

  Excel.CommentCollection = CommentCollection;
  Excel.Comment = Comment;
})(globalThis);
