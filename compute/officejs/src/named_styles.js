(function (global) {
  "use strict";

  // Excel.Style is a named cell-style object.  The range formatting classes
  // already own the font/fill/protection/border proxy implementations; this
  // module only supplies the named-style object paths and retargets those
  // existing proxies to style-backed host operations.
  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var hooks = global.__mogOfficeJs || {};

  var STYLE_SCALARS = [
    "autoIndent",
    "builtIn",
    "formulaHidden",
    "horizontalAlignment",
    "includeAlignment",
    "includeBorder",
    "includeFont",
    "includeNumber",
    "includePatterns",
    "includeProtection",
    "indentLevel",
    "locked",
    "name",
    "numberFormat",
    "numberFormatLocal",
    "readingOrder",
    "shrinkToFit",
    "textOrientation",
    "verticalAlignment",
    "wrapText",
  ];
  var STYLE_READONLY = ["builtIn", "name"];
  var STYLE_NAVIGATION = ["borders", "fill", "font"];
  var STYLE_ITEM_SCALARS = STYLE_SCALARS.slice();
  var BORDER_KEYS = [
    "EdgeTop",
    "EdgeBottom",
    "EdgeLeft",
    "EdgeRight",
    "InsideVertical",
    "InsideHorizontal",
    "DiagonalDown",
    "DiagonalUp",
  ];

  function error(code, message) {
    var result = new OfficeExtension.Error({ code: code, message: message });
    result.name = "RichApi.Error";
    result.code = code;
    return result;
  }

  function propertyNotLoaded(name) {
    return error(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function invalidArgument(message) {
    return error("InvalidArgument", message);
  }

  function requireString(value, property) {
    if (typeof value !== "string" || value.length === 0) {
      throw invalidArgument(property + " must be a non-empty string");
    }
    return value;
  }

  function replaceQueuedRangeOperation(context, id, replacement) {
    var queue = context._queue;
    var operation = queue[queue.length - 1];
    if (!operation || operation.id !== id) {
      throw new Error("named style child did not queue its expected binding operation");
    }
    queue[queue.length - 1] = replacement;
  }

  function styleFormatChild(style, Constructor, kind) {
    // RangeFont/RangeFill/FormatProtection are the established formatting
    // proxies.  Their constructor queues getRangeFormat against a target with
    // an _id; replacing that one operation keeps the proxy class and its
    // set/load/toJSON semantics while selecting a named-style backend.
    var child = new Constructor(style.context, { _id: style._id });
    replaceQueuedRangeOperation(style.context, child._id, {
      op: "getStyleFormat",
      id: child._id,
      styleId: style._id,
      kind: kind,
    });
    child._styleId = style._id;
    return child;
  }

  function styleBorderCollection(style) {
    var collection = new Excel.RangeBorderCollection(style.context, { _id: style._id });
    replaceQueuedRangeOperation(style.context, collection._id, {
      op: "getStyleBorderCollection",
      id: collection._id,
      styleId: style._id,
    });
    collection._styleId = style._id;
    collection._style = style;
    return collection;
  }

  function setStyleBorders(collection, source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var properties = source instanceof ClientObject ? source.toJSON() : source;
    if (properties.tintAndShade !== undefined) {
      collection.tintAndShade = properties.tintAndShade;
    }
    if (properties.items !== undefined) {
      if (!Array.isArray(properties.items)) {
        throw invalidArgument("Style.borders.items must be an array");
      }
      properties.items.forEach(function (item) {
        if (!item || typeof item !== "object") {
          throw invalidArgument("Style.borders.items entries must be objects");
        }
        var side = item.sideIndex;
        requireString(side, "Style.borders item sideIndex");
        collection.getItem(side).set(item, options);
      });
    }
    return collection;
  }

  function styleScalarDescriptor(name, writable) {
    Object.defineProperty(Style.prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: writable
        ? function (value) {
            this["_" + name] = value;
            this._loaded[name] = true;
            this.context._queue.push({
              op: "set",
              id: this._id,
              property: name,
              value: value,
            });
          }
        : undefined,
    });
  }

  function styleToJSON() {
    var data = {};
    STYLE_SCALARS.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);

    if (this._font) data.font = this._font.toJSON();
    if (this._fill) data.fill = this._fill.toJSON();
    if (this._borders && this._borders._loaded.items) {
      // StyleData.borders is an array of RangeBorderData, while the live
      // RangeBorderCollection data wrapper contains an `items` member.
      data.borders = this._borders.toJSON().items || [];
    }
    return data;
  }

  function setProperties(source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }

    var isClientObject = source instanceof ClientObject;
    var properties = source;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      properties = source.toJSON();
    }

    STYLE_SCALARS.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(properties, name) || properties[name] === undefined) {
        return;
      }
      if (STYLE_READONLY.indexOf(name) >= 0) {
        if (!options || options.throwOnReadOnly !== false) {
          throw invalidArgument("The property '" + name + "' is read-only.");
        }
        return;
      }
      this[name] = properties[name];
    }, this);

    STYLE_NAVIGATION.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(properties, name) || properties[name] === undefined) {
        return;
      }
      var child = isClientObject ? source[name] : properties[name];
      if (name === "borders") setStyleBorders(this[name], child, options);
      else this[name].set(child, options);
    }, this);
  }

  function Style(context, collection) {
    ClientObject.call(this, context);
    this._collection = collection || null;
    this._scalarProperties = STYLE_SCALARS.slice();
    this._navigationProperties = STYLE_NAVIGATION.slice();
  }
  Style.prototype = Object.create(ClientObject.prototype);
  Style.prototype.constructor = Style;
  Style.prototype.set = setProperties;
  Style.prototype.toJSON = styleToJSON;
  Style.prototype.delete = function () {
    this.context._queue.push({ op: "styleDelete", id: this._id });
  };

  STYLE_SCALARS.forEach(function (name) {
    styleScalarDescriptor(name, STYLE_READONLY.indexOf(name) < 0);
  });

  Object.defineProperty(Style.prototype, "font", {
    configurable: true,
    get: function () {
      if (!this._font) this._font = styleFormatChild(this, Excel.RangeFont, "font");
      return this._font;
    },
  });
  Object.defineProperty(Style.prototype, "fill", {
    configurable: true,
    get: function () {
      if (!this._fill) this._fill = styleFormatChild(this, Excel.RangeFill, "fill");
      return this._fill;
    },
  });
  Object.defineProperty(Style.prototype, "borders", {
    configurable: true,
    get: function () {
      if (!this._borders) this._borders = styleBorderCollection(this);
      return this._borders;
    },
  });

  function collectionToJSON() {
    if (!this._loaded.items) return {};
    return {
      items: (this._items || []).map(function (item) {
        return item.toJSON();
      }),
    };
  }

  function StyleCollection(context) {
    ClientObject.call(this, context);
    this._scalarProperties = ["items"];
    this.context._queue.push({ op: "getStyleCollection", id: this._id });
    if (typeof hooks.configureCollection === "function") {
      hooks.configureCollection(this, function (key) {
        return this.getItem(String(key));
      });
    }
  }
  StyleCollection.prototype = Object.create(ClientObject.prototype);
  StyleCollection.prototype.constructor = StyleCollection;
  StyleCollection.prototype.add = function (name) {
    requireString(name, "StyleCollection.add name");
    this.context._queue.push({
      op: "styleAdd",
      collectionId: this._id,
      name: name,
    });
  };
  StyleCollection.prototype.getCount = function () {
    var result = hooks.createClientResult(this.context);
    this.context._queue.push({ op: "styleGetCount", resultId: result._id });
    return result;
  };
  StyleCollection.prototype.getItem = function (name) {
    requireString(name, "StyleCollection.getItem name");
    var style = new Style(this.context, this);
    this.context._queue.push({
      op: "styleGetItem",
      id: style._id,
      collectionId: this._id,
      name: name,
      orNullObject: false,
    });
    return style;
  };
  StyleCollection.prototype.getItemAt = function (index) {
    if (typeof index !== "number" || !isFinite(index) || Math.floor(index) !== index) {
      throw invalidArgument("StyleCollection.getItemAt requires an integer index");
    }
    var style = new Style(this.context, this);
    this.context._queue.push({
      op: "styleGetItemAt",
      id: style._id,
      collectionId: this._id,
      index: index,
    });
    return style;
  };
  StyleCollection.prototype.getItemOrNullObject = function (name) {
    requireString(name, "StyleCollection.getItemOrNullObject name");
    var style = new Style(this.context, this);
    this.context._queue.push({
      op: "styleGetItem",
      id: style._id,
      collectionId: this._id,
      name: name,
      orNullObject: true,
    });
    return style;
  };
  StyleCollection.prototype.toJSON = collectionToJSON;

  // A style border collection needs a style-specific binding for collection
  // members.  The normal RangeBorderCollection implementation remains the
  // source of validation, caching, scalar descriptors, and toJSON behavior.
  var rangeBorderGetItem = Excel.RangeBorderCollection.prototype.getItem;
  Excel.RangeBorderCollection.prototype.getItem = function (index) {
    if (!this._styleId) return rangeBorderGetItem.call(this, index);
    if (typeof index !== "string" || BORDER_KEYS.indexOf(index) < 0) {
      throw invalidArgument("Unsupported BorderIndex value '" + index + "'");
    }
    if (this._itemsByKey[index]) return this._itemsByKey[index];
    var border = new Excel.RangeBorder(this.context, this, index);
    replaceQueuedRangeOperation(this.context, border._id, {
      op: "getStyleBorder",
      id: border._id,
      collectionId: this._id,
      styleId: this._styleId,
      index: index,
    });
    border._styleId = this._styleId;
    this._itemsByKey[index] = border;
    return border;
  };

  // The generated RangeBorderCollection has no explicit `set` method in the
  // pinned class declaration, but Style.set accepts RangeBorderCollection
  // update data with an `items` array.  Add this only to style-backed
  // collections; ordinary range collections keep their existing surface.
  var rangeBorderCollectionSet = Excel.RangeBorderCollection.prototype.set;
  Excel.RangeBorderCollection.prototype.set = function (source, options) {
    if (!this._styleId) {
      if (typeof rangeBorderCollectionSet === "function") {
        return rangeBorderCollectionSet.call(this, source, options);
      }
      throw invalidArgument("RangeBorderCollection.set is unavailable");
    }
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var properties = source instanceof ClientObject ? source.toJSON() : source;
    if (properties.tintAndShade !== undefined) this.tintAndShade = properties.tintAndShade;
    if (properties.items !== undefined) {
      if (!Array.isArray(properties.items)) {
        throw invalidArgument("RangeBorderCollection.items must be an array");
      }
      properties.items.forEach(function (item) {
        if (!item || typeof item !== "object") {
          throw invalidArgument("RangeBorderCollection.items entries must be objects");
        }
        var side = item.sideIndex;
        requireString(side, "RangeBorderCollection item sideIndex");
        this.getItem(side).set(item, options);
      }, this);
    }
    return this;
  };

  Object.defineProperty(Excel.Workbook.prototype, "styles", {
    configurable: true,
    get: function () {
      if (!this._styles) this._styles = new StyleCollection(this.context);
      return this._styles;
    },
  });

  Object.defineProperty(Excel.Range.prototype, "style", {
    configurable: true,
    get: function () {
      if (!this._loaded.style) throw propertyNotLoaded("style");
      return this._style;
    },
    set: function (value) {
      requireString(value, "Range.style");
      this._style = value;
      this._loaded.style = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "style",
        value: value,
      });
    },
  });
  if (typeof hooks.addScalarProperties === "function") {
    hooks.addScalarProperties(Excel.Range.prototype, ["style"]);
  }

  Excel.Style = Style;
  Excel.StyleCollection = StyleCollection;
})(globalThis);
