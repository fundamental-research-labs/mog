(function (global) {
  "use strict";
  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function queue(source, method, args, result) {
    var op = { op: "comments", sourceId: source._id, method: method, args: args || [] };
    if (result) op.id = result._id;
    source.context._queue.push(op);
    return result;
  }
  function addressArgument(source, address) {
    if (address instanceof Excel.Range) {
      if (address.context !== source.context) throw new global.OfficeExtension.Error({ code: "InvalidRequestContext", message: "The range belongs to another context." });
      return { rangeId: address._id };
    }
    return address;
  }
  function collection(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._scalarProperties = ["items"];
    global.__mogOfficeJs.configureCollection(this, function (key) { return this.getItem(key); });
    context._queue.push({ op: "comments", method: "collection", id: this._id, parentId: parent && parent._id });
  }
  function CommentCollection(context) { collection.call(this, context); }
  function CommentReplyCollection(context, parent) { collection.call(this, context, parent); }
  [CommentCollection, CommentReplyCollection].forEach(function (ctor) {
    ctor.prototype = Object.create(ClientObject.prototype);
    ctor.prototype.constructor = ctor;
    ctor.prototype.getCount = function () {
      return queue(this, "count", [], global.__mogOfficeJs.createClientResult(this.context));
    };
    ctor.prototype.getItem = function (id) { return item(this, "item", id); };
    ctor.prototype.getItemAt = function (index) { return item(this, "at", index); };
    ctor.prototype.getItemOrNullObject = function (id) { return item(this, "itemOrNull", id); };
    ctor.prototype.toJSON = function () {
      return this._loaded.items ? { items: this._items.map(function (item) { return item.toJSON(); }) } : {};
    };
  });
  function item(source, method, key) {
    return queue(source, method, [key], new (source._parent ? CommentReply : Comment)(source.context));
  }
  CommentCollection.prototype.add = function (address, content, contentType) {
    return queue(this, "add", [addressArgument(this, address), content, contentType], new Comment(this.context));
  };
  CommentCollection.prototype.getItemByCell = function (address) { return item(this, "byCell", addressArgument(this, address)); };
  CommentCollection.prototype.getItemByReplyId = function (id) { return item(this, "byReply", id); };
  CommentReplyCollection.prototype.add = function (content, contentType) {
    return queue(this, "addReply", [content, contentType], new CommentReply(this.context));
  };
  function comment(context, reply) {
    ClientObject.call(this, context);
    this._scalarProperties = ["id", "content", "authorName", "authorEmail"];
    if (!reply) this._scalarProperties.push("resolved");
  }
  function Comment(context) { comment.call(this, context, false); }
  function CommentReply(context) { comment.call(this, context, true); }
  [Comment, CommentReply].forEach(function (ctor) {
    ctor.prototype = Object.create(ClientObject.prototype);
    ctor.prototype.constructor = ctor;
    (ctor === Comment ? ["id", "content", "authorName", "authorEmail", "resolved"] : ["id", "content", "authorName", "authorEmail"]).forEach(function (name) {
      var descriptor = { get: function () {
        if (!this._loaded[name]) throw new global.OfficeExtension.Error({ code: "PropertyNotLoaded", message: "Load " + name + " and sync before reading it." });
        return this[name === "id" ? "_idValue" : "_" + name];
      }};
      if (name === "content" || name === "resolved") descriptor.set = function (value) {
        this.context._queue.push({ op: "set", id: this._id, property: name, value: value });
      };
      Object.defineProperty(ctor.prototype, name, descriptor);
    });
    ctor.prototype.delete = function () { queue(this, "delete"); };
    ctor.prototype.getLocation = function () { return queue(this, "location", [], new Excel.Range(this.context, null, null)); };
    ctor.prototype.toJSON = function () {
      var data = {}, self = this;
      this._scalarProperties.forEach(function (name) { if (self._loaded[name]) data[name] = self[name]; });
      return data;
    };
  });
  CommentReply.prototype.getParentComment = function () { return queue(this, "parent", [], new Comment(this.context)); };
  Object.defineProperty(Comment.prototype, "replies", { get: function () {
    if (!this._replies) this._replies = new CommentReplyCollection(this.context, this);
    return this._replies;
  }});
  Object.defineProperty(Excel.Workbook.prototype, "comments", { configurable: true, get: function () {
    if (!this._comments) this._comments = new CommentCollection(this.context);
    return this._comments;
  }});
  Excel.CommentCollection = CommentCollection;
  Excel.Comment = Comment;
  Excel.CommentReplyCollection = CommentReplyCollection;
  Excel.CommentReply = CommentReply;
})(globalThis);
