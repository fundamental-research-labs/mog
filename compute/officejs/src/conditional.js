(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function queueParentSet(parent, property, value) {
    parent.context._queue.push({
      op: "set",
      id: parent._id,
      property: property,
      value: value,
    });
  }

  function FormatFill(parent, prefix) {
    this._parent = parent;
    this._prefix = prefix;
  }
  Object.defineProperty(FormatFill.prototype, "color", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".format.fill.color", value);
    },
  });

  function FormatFont(parent, prefix) {
    this._parent = parent;
    this._prefix = prefix;
  }
  Object.defineProperty(FormatFont.prototype, "bold", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".format.font.bold", value);
    },
  });
  Object.defineProperty(FormatFont.prototype, "color", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".format.font.color", value);
    },
  });

  function FormatProxy(parent, prefix) {
    this._parent = parent;
    this._prefix = prefix;
  }
  Object.defineProperty(FormatProxy.prototype, "fill", {
    get: function () {
      if (!this._fill) this._fill = new FormatFill(this._parent, this._prefix);
      return this._fill;
    },
  });
  Object.defineProperty(FormatProxy.prototype, "font", {
    get: function () {
      if (!this._font) this._font = new FormatFont(this._parent, this._prefix);
      return this._font;
    },
  });

  function RuleProxy(parent, prefix) {
    this._parent = parent;
    this._prefix = prefix;
  }
  Object.defineProperty(RuleProxy.prototype, "rule", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".rule", value);
    },
  });
  Object.defineProperty(RuleProxy.prototype, "format", {
    get: function () {
      if (!this._format) this._format = new FormatProxy(this._parent, this._prefix);
      return this._format;
    },
  });
  Object.defineProperty(RuleProxy.prototype, "criteria", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".criteria", value);
    },
  });
  Object.defineProperty(RuleProxy.prototype, "style", {
    set: function (value) {
      queueParentSet(this._parent, this._prefix + ".style", value);
    },
  });

  function ConditionalFormat(context, range, type) {
    ClientObject.call(this, context);
    this._range = range;
    this._cfType = type;
    this._scalarProperties = ["id", "type", "priority", "stopIfTrue"];
    if (type !== undefined) this.context._queue.push({
      op: "cfAdd", id: this._id, rangeId: range._id, type: String(type)
    });
  }
  ConditionalFormat.prototype = Object.create(ClientObject.prototype);
  ConditionalFormat.prototype.constructor = ConditionalFormat;

  ["id", "type", "priority", "stopIfTrue"].forEach(function (name) {
    Object.defineProperty(ConditionalFormat.prototype, name, { get: function () {
      if (!this._loaded[name]) throw new global.OfficeExtension.Error({ code: "PropertyNotLoaded", message: "Load " + name + " before reading it." });
      return this[name === "id" ? "_idValue" : "_" + name];
    }});
  });
  ConditionalFormat.prototype.delete = function () {
    this.context._queue.push({ op: "cfQuery", method: "delete", sourceId: this._id });
  };
  function formatRange(object, nullable) {
    var result = new Excel.Range(object.context, object._range._worksheet, null);
    object.context._queue.push({ op: "cfQuery", method: "range", sourceId: object._id, id: result._id, nullable: nullable });
    return result;
  }
  ConditionalFormat.prototype.getRange = function () { return formatRange(this, false); };
  ConditionalFormat.prototype.getRangeOrNullObject = function () { return formatRange(this, true); };

  ["cellValue", "colorScale", "dataBar", "iconSet", "preset", "textComparison"].forEach(
    function (name) {
      Object.defineProperty(ConditionalFormat.prototype, name, {
        get: function () {
          var key = "_" + name;
          if (!this[key]) this[key] = new RuleProxy(this, name);
          return this[key];
        },
      });
    }
  );

  function ConditionalFormatCollection(context, range) {
    ClientObject.call(this, context);
    this._range = range;
  }
  ConditionalFormatCollection.prototype = Object.create(ClientObject.prototype);
  ConditionalFormatCollection.prototype.constructor = ConditionalFormatCollection;

  function queryCollection(collection, method, key, result) {
    collection.context._queue.push({ op: "cfQuery", method: method, rangeId: collection._range._id, key: key, id: result && result._id });
    return result;
  }
  ConditionalFormatCollection.prototype.getCount = function () {
    return queryCollection(this, "count", null, global.__mogOfficeJs.createClientResult(this.context));
  };
  ConditionalFormatCollection.prototype.getItem = function (id) {
    return queryCollection(this, "item", id, new ConditionalFormat(this.context, this._range));
  };
  ConditionalFormatCollection.prototype.getItemAt = function (index) {
    return queryCollection(this, "at", index, new ConditionalFormat(this.context, this._range));
  };
  ConditionalFormatCollection.prototype.getItemOrNullObject = function (id) {
    return queryCollection(this, "itemOrNull", id, new ConditionalFormat(this.context, this._range));
  };
  ConditionalFormatCollection.prototype.clearAll = function () { queryCollection(this, "clear"); };

  ConditionalFormatCollection.prototype.add = function (type) {
    return new ConditionalFormat(this.context, this._range, type);
  };

  Object.defineProperty(Excel.Range.prototype, "conditionalFormats", {
    configurable: true,
    get: function () {
      if (!this._conditionalFormats) {
        this._conditionalFormats = new ConditionalFormatCollection(this.context, this);
      }
      return this._conditionalFormats;
    },
  });

  Excel.ConditionalFormat = ConditionalFormat;
  Excel.ConditionalFormatCollection = ConditionalFormatCollection;
})(globalThis);
