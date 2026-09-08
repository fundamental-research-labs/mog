(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function richError(code, message) {
    var error = new OfficeExtension.Error({ code: code, message: message });
    error.name = "RichApi.Error";
    error.code = code;
    return error;
  }

  function propertyNotLoaded(name) {
    return richError(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function invalidArgument(message) {
    return richError("InvalidArgument", message);
  }

  function invalidRequestContext() {
    return richError(
      "InvalidRequestContext",
      "The object belongs to a different request context."
    );
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function stringArgument(value, property) {
    if (typeof value !== "string" || value.length === 0) {
      throw invalidArgument(property + " must be a non-empty string");
    }
    return value;
  }

  function integerArgument(value, property) {
    if (
      typeof value !== "number" ||
      !isFinite(value) ||
      Math.floor(value) !== value ||
      value < 0
    ) {
      throw invalidArgument(property + " must be a non-negative integer");
    }
    return value;
  }

  function normalizeContentType(contentType, property) {
    if (contentType === undefined || contentType === null) return "Plain";
    if (contentType === "Plain" || contentType === "plain") return "Plain";
    if (contentType === "Mention" || contentType === "mention") return "Mention";
    throw invalidArgument(
      (property || "contentType") + " must be \"Plain\" or \"Mention\""
    );
  }

  function normalizeContent(content, contentType, property) {
    var type = normalizeContentType(contentType, property + " contentType");
    if (typeof content === "string") {
      return { wire: content, contentType: type };
    }
    if (
      !content ||
      typeof content !== "object" ||
      typeof content.richContent !== "string"
    ) {
      throw invalidArgument(
        property + " content must be a string or CommentRichContent object"
      );
    }
    if (
      content.mentions !== undefined &&
      content.mentions !== null &&
      !Array.isArray(content.mentions)
    ) {
      throw invalidArgument(property + " content.mentions must be an array");
    }
    return {
      wire: {
        richContent: content.richContent,
        mentions: content.mentions || [],
      },
      contentType: type,
    };
  }

  function requireCellAddress(address, property) {
    if (address instanceof Excel.Range) return address;
    if (typeof address !== "string" || address.length === 0) {
      throw invalidArgument(property + " requires a Range or full cell address");
    }
    if (address.indexOf("!") < 0) {
      throw invalidArgument(
        property + " string addresses must include the worksheet name"
      );
    }
    return address;
  }

  function queueCommentLookup(comment, collection, key, byIndex, orNullObject) {
    comment._collection = collection;
    comment._commentCollection = collection;
    var operation = {
      op: byIndex ? "commentCollectionGetItemAt" : "commentCollectionGetItem",
      id: comment._id,
      collectionId: collection._id,
      orNullObject: orNullObject === true,
    };
    if (byIndex) operation.index = key;
    else operation.key = String(key);
    comment.context._queue.push(operation);
    return comment;
  }

  function queueReplyLookup(reply, collection, key, byIndex, orNullObject) {
    reply._collection = collection;
    var operation = {
      op: byIndex
        ? "commentReplyCollectionGetItemAt"
        : "commentReplyCollectionGetItem",
      id: reply._id,
      collectionId: collection._id,
      orNullObject: orNullObject === true,
    };
    if (byIndex) operation.index = key;
    else operation.key = String(key);
    reply.context._queue.push(operation);
    return reply;
  }

  function CommentCollection(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._scalarProperties = ["items"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);
    context._queue.push({
      op: "getCommentCollection",
      id: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    });
    officeJs.configureCollection(this, function (key) {
      return this.getItem(String(key));
    });
  }
  CommentCollection.prototype = Object.create(ClientObject.prototype);
  CommentCollection.prototype.constructor = CommentCollection;

  Object.defineProperty(CommentCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  CommentCollection.prototype.add = function (
    cellAddress,
    content,
    contentType
  ) {
    var target = requireCellAddress(cellAddress, "CommentCollection.add cellAddress");
    if (target instanceof Excel.Range && target.context !== this.context) {
      throw invalidRequestContext();
    }
    var normalized = normalizeContent(
      content,
      contentType,
      "CommentCollection.add"
    );
    var comment = new Comment(this.context, this);
    var operation = {
      op: "commentAdd",
      id: comment._id,
      collectionId: this._id,
      content: normalized.wire,
      contentType: normalized.contentType,
    };
    if (target instanceof Excel.Range) operation.rangeId = target._id;
    else operation.address = target;
    this.context._queue.push(operation);
    return comment;
  };

  CommentCollection.prototype.getCount = function () {
    var result = officeJs.createClientResult(this.context);
    this.context._queue.push({
      op: "commentCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  CommentCollection.prototype.getItem = function (commentId) {
    var key = stringArgument(commentId, "CommentCollection.getItem commentId");
    var cacheKey = "key:" + key.toLowerCase();
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueCommentLookup(
        new Comment(this.context, this),
        this,
        key,
        false,
        false
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentCollection.prototype.getItemAt = function (index) {
    index = integerArgument(index, "CommentCollection.getItemAt index");
    var cacheKey = "index:" + index;
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueCommentLookup(
        new Comment(this.context, this),
        this,
        index,
        true,
        false
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentCollection.prototype.getItemByCell = function (cellAddress) {
    var target = requireCellAddress(
      cellAddress,
      "CommentCollection.getItemByCell cellAddress"
    );
    if (target instanceof Excel.Range && target.context !== this.context) {
      throw invalidRequestContext();
    }
    var comment = new Comment(this.context, this);
    var operation = {
      op: "commentCollectionGetItemByCell",
      id: comment._id,
      collectionId: this._id,
    };
    if (target instanceof Excel.Range) operation.rangeId = target._id;
    else operation.address = target;
    this.context._queue.push(operation);
    return comment;
  };

  CommentCollection.prototype.getItemByReplyId = function (replyId) {
    var key = stringArgument(
      replyId,
      "CommentCollection.getItemByReplyId replyId"
    );
    var comment = new Comment(this.context, this);
    this.context._queue.push({
      op: "commentCollectionGetItemByReplyId",
      id: comment._id,
      collectionId: this._id,
      replyId: key,
    });
    return comment;
  };

  CommentCollection.prototype.getItemOrNullObject = function (commentId) {
    var key = stringArgument(
      commentId,
      "CommentCollection.getItemOrNullObject commentId"
    );
    var cacheKey = "null:" + key.toLowerCase();
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueCommentLookup(
        new Comment(this.context, this),
        this,
        key,
        false,
        true
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function Comment(context, collection) {
    ClientObject.call(this, context);
    this._collection = collection || null;
    this._commentCollection = collection || null;
    this._scalarProperties = [
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
    this._navigationProperties = ["replies"];
  }
  Comment.prototype = Object.create(ClientObject.prototype);
  Comment.prototype.constructor = Comment;

  function readOnlyCommentProperty(name) {
    Object.defineProperty(Comment.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  }

  [
    "authorEmail",
    "authorName",
    "contentType",
    "id",
    "mentions",
    "resolved",
    "richContent",
  ].forEach(readOnlyCommentProperty);

  Object.defineProperty(Comment.prototype, "creationDate", {
    get: function () {
      if (!this._loaded.creationDate) throw propertyNotLoaded("creationDate");
      if (this._creationDate === null || this._creationDate === undefined) {
        return null;
      }
      if (this._creationDate instanceof Date) return this._creationDate;
      return new Date(this._creationDate);
    },
    configurable: true,
  });

  Object.defineProperty(Comment.prototype, "content", {
    get: function () {
      if (!this._loaded.content) throw propertyNotLoaded("content");
      return this._content;
    },
    set: function (value) {
      if (typeof value !== "string") {
        throw invalidArgument("Comment.content must be a string");
      }
      this._content = value;
      this._loaded.content = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "content",
        value: value,
      });
    },
    configurable: true,
  });

  Object.defineProperty(Comment.prototype, "resolved", {
    get: function () {
      if (!this._loaded.resolved) throw propertyNotLoaded("resolved");
      return this._resolved;
    },
    set: function (value) {
      if (typeof value !== "boolean") {
        throw invalidArgument("Comment.resolved must be a boolean");
      }
      this._resolved = value;
      this._loaded.resolved = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "resolved",
        value: value,
      });
    },
    configurable: true,
  });

  Object.defineProperty(Comment.prototype, "replies", {
    get: function () {
      if (!this._replies) {
        this._replies = new CommentReplyCollection(this.context, this);
      }
      return this._replies;
    },
    configurable: true,
  });

  Comment.prototype.set = function (source) {
    requirePropertyObject(source);
    if (source instanceof ClientObject && source.context !== this.context) {
      throw invalidRequestContext();
    }
    if (Object.prototype.hasOwnProperty.call(source, "content")) {
      this.content = source.content;
    }
    if (Object.prototype.hasOwnProperty.call(source, "resolved")) {
      this.resolved = source.resolved;
    }
    return this;
  };

  Comment.prototype.delete = function () {
    this.context._queue.push({ op: "commentDelete", id: this._id });
  };

  Comment.prototype.getLocation = function () {
    var range = new Excel.Range(this.context, null, null);
    range._commentSourceId = this._id;
    this.context._queue.push({
      op: "commentGetLocation",
      id: range._id,
      commentId: this._id,
    });
    return range;
  };

  Comment.prototype.updateMentions = function (contentWithMentions) {
    var normalized = normalizeContent(
      contentWithMentions,
      "Mention",
      "Comment.updateMentions"
    );
    var wire = normalized.wire;
    if (typeof wire === "string") {
      wire = { richContent: wire, mentions: [] };
    }
    this.context._queue.push({
      op: "commentUpdateMentions",
      id: this._id,
      content: wire.richContent,
      mentions: wire.mentions || [],
    });
  };

  Comment.prototype.toJSON = function () {
    var data = {};
    [
      "authorEmail",
      "authorName",
      "content",
      "contentType",
      "creationDate",
      "id",
      "mentions",
      "resolved",
      "richContent",
    ].forEach(function (name) {
      if (!this._loaded[name]) return;
      data[name] = this[name];
    }, this);
    if (this._replies && this._replies._loaded.items) {
      data.replies = this._replies.items.map(function (reply) {
        return reply && typeof reply.toJSON === "function"
          ? reply.toJSON()
          : reply;
      });
    }
    return data;
  };

  function CommentReplyCollection(context, comment) {
    ClientObject.call(this, context);
    this._comment = comment;
    this._collection = comment ? comment._collection : null;
    this._scalarProperties = ["items"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);
    context._queue.push({
      op: "getCommentReplyCollection",
      id: this._id,
      commentId: comment._id,
    });
    officeJs.configureCollection(this, function (key) {
      return this.getItem(String(key));
    });
  }
  CommentReplyCollection.prototype = Object.create(ClientObject.prototype);
  CommentReplyCollection.prototype.constructor = CommentReplyCollection;

  Object.defineProperty(CommentReplyCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  CommentReplyCollection.prototype.add = function (content, contentType) {
    var normalized = normalizeContent(
      content,
      contentType,
      "CommentReplyCollection.add"
    );
    var reply = new CommentReply(this.context, this);
    this.context._queue.push({
      op: "commentReplyAdd",
      id: reply._id,
      commentId: this._comment._id,
      content: normalized.wire,
      contentType: normalized.contentType,
    });
    return reply;
  };

  CommentReplyCollection.prototype.getCount = function () {
    var result = officeJs.createClientResult(this.context);
    this.context._queue.push({
      op: "commentReplyCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  CommentReplyCollection.prototype.getItem = function (replyId) {
    var key = stringArgument(
      replyId,
      "CommentReplyCollection.getItem commentReplyId"
    );
    var cacheKey = "key:" + key.toLowerCase();
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueReplyLookup(
        new CommentReply(this.context, this),
        this,
        key,
        false,
        false
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentReplyCollection.prototype.getItemAt = function (index) {
    index = integerArgument(
      index,
      "CommentReplyCollection.getItemAt index"
    );
    var cacheKey = "index:" + index;
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueReplyLookup(
        new CommentReply(this.context, this),
        this,
        index,
        true,
        false
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentReplyCollection.prototype.getItemOrNullObject = function (replyId) {
    var key = stringArgument(
      replyId,
      "CommentReplyCollection.getItemOrNullObject commentReplyId"
    );
    var cacheKey = "null:" + key.toLowerCase();
    if (!this._itemCache[cacheKey]) {
      this._itemCache[cacheKey] = queueReplyLookup(
        new CommentReply(this.context, this),
        this,
        key,
        false,
        true
      );
    }
    return this._itemCache[cacheKey];
  };

  CommentReplyCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function CommentReply(context, collection) {
    ClientObject.call(this, context);
    this._collection = collection || null;
    this._comment = collection ? collection._comment : null;
    this._scalarProperties = [
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
  }
  CommentReply.prototype = Object.create(ClientObject.prototype);
  CommentReply.prototype.constructor = CommentReply;

  function readOnlyReplyProperty(name) {
    Object.defineProperty(CommentReply.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  }

  [
    "authorEmail",
    "authorName",
    "contentType",
    "id",
    "mentions",
    "resolved",
    "richContent",
  ].forEach(readOnlyReplyProperty);

  Object.defineProperty(CommentReply.prototype, "creationDate", {
    get: function () {
      if (!this._loaded.creationDate) throw propertyNotLoaded("creationDate");
      if (this._creationDate === null || this._creationDate === undefined) {
        return null;
      }
      if (this._creationDate instanceof Date) return this._creationDate;
      return new Date(this._creationDate);
    },
    configurable: true,
  });

  Object.defineProperty(CommentReply.prototype, "content", {
    get: function () {
      if (!this._loaded.content) throw propertyNotLoaded("content");
      return this._content;
    },
    set: function (value) {
      if (typeof value !== "string") {
        throw invalidArgument("CommentReply.content must be a string");
      }
      this._content = value;
      this._loaded.content = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "content",
        value: value,
      });
    },
    configurable: true,
  });

  CommentReply.prototype.set = function (source) {
    requirePropertyObject(source);
    if (source instanceof ClientObject && source.context !== this.context) {
      throw invalidRequestContext();
    }
    if (Object.prototype.hasOwnProperty.call(source, "content")) {
      this.content = source.content;
    }
    return this;
  };

  CommentReply.prototype.delete = function () {
    this.context._queue.push({ op: "commentReplyDelete", id: this._id });
  };

  CommentReply.prototype.getLocation = function () {
    var range = new Excel.Range(this.context, null, null);
    range._commentSourceId = this._id;
    this.context._queue.push({
      op: "commentReplyGetLocation",
      id: range._id,
      replyId: this._id,
    });
    return range;
  };

  CommentReply.prototype.getParentComment = function () {
    return this._comment;
  };

  CommentReply.prototype.updateMentions = function (contentWithMentions) {
    var normalized = normalizeContent(
      contentWithMentions,
      "Mention",
      "CommentReply.updateMentions"
    );
    var wire = normalized.wire;
    if (typeof wire === "string") {
      wire = { richContent: wire, mentions: [] };
    }
    this.context._queue.push({
      op: "commentUpdateMentions",
      id: this._id,
      content: wire.richContent,
      mentions: wire.mentions || [],
    });
  };

  CommentReply.prototype.toJSON = function () {
    var data = {};
    [
      "authorEmail",
      "authorName",
      "content",
      "contentType",
      "creationDate",
      "id",
      "mentions",
      "resolved",
      "richContent",
    ].forEach(function (name) {
      if (!this._loaded[name]) return;
      data[name] = this[name];
    }, this);
    return data;
  };

  Object.defineProperty(Excel.Workbook.prototype, "comments", {
    get: function () {
      if (!this._comments) {
        this._comments = new CommentCollection(this.context, null);
      }
      return this._comments;
    },
    configurable: true,
  });

  Object.defineProperty(Excel.Worksheet.prototype, "comments", {
    get: function () {
      if (!this._comments) {
        this._comments = new CommentCollection(this.context, this);
      }
      return this._comments;
    },
    configurable: true,
  });

  Excel.CommentCollection = CommentCollection;
  Excel.Comment = Comment;
  Excel.CommentReplyCollection = CommentReplyCollection;
  Excel.CommentReply = CommentReply;
})(globalThis);
