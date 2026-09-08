(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs || {};

  // Excel exposes the collection in this order.  The order is observable via
  // items and getItemAt, so keep it as one shared contract instead of deriving
  // it from the sparse CellBorders object.
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
  var BORDER_PROPERTIES = [
    "color",
    "sideIndex",
    "style",
    "tintAndShade",
    "weight",
  ];
  var COLLECTION_PROPERTIES = ["count", "tintAndShade", "items"];
  var ITEM_PROPERTIES = ["color", "sideIndex", "style", "tintAndShade", "weight"];

  function propertyNotLoaded(name) {
    var error = new global.OfficeExtension.Error({
      code: "PropertyNotLoaded",
      message:
        "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context.",
    });
    error.name = "RichApi.Error";
    error.code = "PropertyNotLoaded";
    return error;
  }

  function invalidArgument(message) {
    return new global.OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function appendUnique(output, value) {
    if (output.indexOf(value) < 0) output.push(value);
  }

  function normalizeNames(value, defaults) {
    if (value == null || value === undefined) return defaults.slice();
    if (typeof value === "string") {
      return value
        .split(",")
        .map(function (name) {
          return name.trim();
        })
        .filter(Boolean);
    }
    if (Array.isArray(value)) {
      var names = [];
      value.forEach(function (entry) {
        normalizeNames(entry, defaults).forEach(function (name) {
          appendUnique(names, name);
        });
      });
      return names;
    }
    if (typeof value !== "object") return [String(value)];

    var names = value.$all === true ? defaults.slice() : [];
    if (value.select != null) {
      normalizeNames(value.select, []).forEach(function (name) {
        appendUnique(names, name);
      });
    }
    if (value.expand != null) {
      normalizeNames(value.expand, []).forEach(function (name) {
        appendUnique(names, name);
      });
    }
    Object.keys(value).forEach(function (key) {
      if (key === "$all" || key === "select" || key === "expand" || key === "top" || key === "skip") return;
      var child = value[key];
      if (child === true) appendUnique(names, key);
      else if (child && typeof child === "object") {
        if (child.$all === true) appendUnique(names, key);
        normalizeNames(child, []).forEach(function (name) {
          appendUnique(names, key + "/" + name);
        });
      }
    });
    return names;
  }

  function normalizeCollectionNames(value) {
    // Collection load options use the collection's scalar names directly and
    // use items/<property> for fields requested on every child.  This is the
    // shape consumed by the shared host collection hydration protocol.
    var names = [];
    var defaults = COLLECTION_PROPERTIES.slice();
    if (value == null || value === undefined) {
      names.push("count", "tintAndShade", "items/$all");
      return names;
    }

    function add(name) {
      appendUnique(names, name);
    }

    function addItemNames(itemValue) {
      if (itemValue == null || itemValue === undefined || itemValue === true) {
        add("items");
        return;
      }
      if (typeof itemValue === "string" || Array.isArray(itemValue)) {
        normalizeNames(itemValue, []).forEach(function (name) {
          add("items/" + name);
        });
        return;
      }
      if (typeof itemValue !== "object") {
        add("items/" + String(itemValue));
        return;
      }
      if (itemValue.$all === true) add("items/$all");
      if (itemValue.select != null) {
        normalizeNames(itemValue.select, []).forEach(function (name) {
          add("items/" + name);
        });
      }
      if (itemValue.expand != null) {
        normalizeNames(itemValue.expand, []).forEach(function (name) {
          add("items/" + name);
        });
      }
      Object.keys(itemValue).forEach(function (key) {
        if (key === "$all" || key === "select" || key === "expand" || key === "top" || key === "skip") return;
        if (itemValue[key] === true) add("items/" + key);
        else if (itemValue[key] && typeof itemValue[key] === "object") {
          // Nested item navigation is unsupported by RangeBorder. Preserve
          // the path so the host reports a precise unsupported-property error.
          add("items/" + key + "/" + normalizeNames(itemValue[key], []).join("/"));
        }
      });
      if (itemValue.$all !== true && Object.keys(itemValue).length === 0) add("items");
    }

    function visit(input) {
      if (input == null || input === undefined) {
        defaults.forEach(add);
        add("items/$all");
        return;
      }
      if (typeof input === "string") {
        input
          .split(",")
          .map(function (name) { return name.trim(); })
          .filter(Boolean)
          .forEach(function (name) {
            if (name === "items") add("items");
            else if (ITEM_PROPERTIES.indexOf(name) >= 0) add("items/" + name);
            else add(name);
          });
        return;
      }
      if (Array.isArray(input)) {
        input.forEach(visit);
        return;
      }
      if (typeof input !== "object") {
        add(String(input));
        return;
      }
      if (input.$all === true) {
        add("count");
        add("tintAndShade");
        add("items/$all");
      }
      if (input.select != null) visit(input.select);
      if (input.expand != null) visit(input.expand);
      Object.keys(input).forEach(function (key) {
        if (key === "$all" || key === "select" || key === "expand" || key === "top" || key === "skip") return;
        var child = input[key];
        if (key === "items") addItemNames(child);
        else if (child === true) {
          if (ITEM_PROPERTIES.indexOf(key) >= 0) add("items/" + key);
          else add(key);
        } else if (child && typeof child === "object") {
          add(key + "/" + normalizeNames(child, []).join("/"));
        }
      });
    }

    visit(value);
    return names;
  }

  function defineScalar(proto, name, writable) {
    if (Object.getOwnPropertyDescriptor(proto, name)) return;
    Object.defineProperty(proto, name, {
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

  function borderSet(source, options) {
    requirePropertyObject(source);
    var isClientObject = source instanceof ClientObject;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
    }

    // `sideIndex` is metadata on the live object, rather than a member of
    // RangeBorderUpdateData. Match Office's UpdateOptions behavior for a
    // plain object that attempts to include the read-only field. A source
    // RangeBorder may contain sideIndex in toJSON, but copying it is skipped.
    if (!isClientObject && Object.prototype.hasOwnProperty.call(source, "sideIndex") &&
        (!options || options.throwOnReadOnly !== false)) {
      throw invalidArgument("The property 'sideIndex' is read-only.");
    }

    ["color", "style", "tintAndShade", "weight"].forEach(function (name) {
      if (isClientObject) {
        if (source._loaded[name]) this[name] = source[name];
      } else if (Object.prototype.hasOwnProperty.call(source, name)) {
        this[name] = source[name];
      }
    }, this);
  }

  function borderToJSON() {
    var data = {};
    BORDER_PROPERTIES.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  }

  function collectionToJSON() {
    var data = {};
    if (this._loaded.items) {
      data.items = (this._items || []).map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      });
    }
    // `count` and collection tint are scalar properties on the live object,
    // but RangeBorderCollectionData intentionally contains only items.  Keep
    // toJSON aligned with Microsoft's shallow data contract.
    return data;
  }

  function RangeBorderCollection(context, range) {
    ClientObject.call(this, context);
    this._range = range;
    this._rangeId = range._id;
    this._items = [];
    this._itemsByKey = Object.create(null);
    this._scalarProperties = COLLECTION_PROPERTIES.slice();
    this.context._queue.push({
      op: "getRangeBorderCollection",
      id: this._id,
      rangeId: range._id,
    });
    if (typeof officeJs.configureCollection === "function") {
      var collection = this;
      officeJs.configureCollection(this, function (key) {
        return collection.getItem(key);
      });
    }
  }
  RangeBorderCollection.prototype = Object.create(ClientObject.prototype);
  RangeBorderCollection.prototype.constructor = RangeBorderCollection;

  defineScalar(RangeBorderCollection.prototype, "count", false);
  defineScalar(RangeBorderCollection.prototype, "tintAndShade", true);

  Object.defineProperty(RangeBorderCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
  });

  RangeBorderCollection.prototype.getItem = function (index) {
    if (typeof index !== "string") {
      throw invalidArgument("RangeBorderCollection.getItem requires a BorderIndex string");
    }
    if (BORDER_KEYS.indexOf(index) < 0) {
      throw invalidArgument("Unsupported BorderIndex value '" + index + "'");
    }
    if (this._itemsByKey[index]) return this._itemsByKey[index];
    var border = new RangeBorder(this.context, this, index);
    this._itemsByKey[index] = border;
    return border;
  };

  RangeBorderCollection.prototype.getItemAt = function (index) {
    if (typeof index !== "number" || !isFinite(index) || Math.floor(index) !== index) {
      throw invalidArgument("RangeBorderCollection.getItemAt requires an integer index");
    }
    if (index < 0 || index >= BORDER_KEYS.length) {
      throw invalidArgument("RangeBorderCollection index is out of range");
    }
    return this.getItem(BORDER_KEYS[index]);
  };

  RangeBorderCollection.prototype.load = function (options) {
    var properties = normalizeCollectionNames(options);
    if (properties.length) {
      this.context._queue.push({
        op: "load",
        id: this._id,
        properties: properties,
      });
    }
    return this;
  };

  RangeBorderCollection.prototype.toJSON = collectionToJSON;

  function RangeBorder(context, collection, key) {
    ClientObject.call(this, context);
    this._collection = collection;
    this._collectionId = collection._id;
    this._range = collection._range;
    this._rangeId = collection._rangeId;
    this._selectorKey = key;
    this._scalarProperties = BORDER_PROPERTIES.slice();
    this.context._queue.push({
      op: "getRangeBorder",
      id: this._id,
      collectionId: collection._id,
      index: key,
    });
  }
  RangeBorder.prototype = Object.create(ClientObject.prototype);
  RangeBorder.prototype.constructor = RangeBorder;

  ["color", "style", "tintAndShade", "weight"].forEach(function (name) {
    defineScalar(RangeBorder.prototype, name, true);
  });
  defineScalar(RangeBorder.prototype, "sideIndex", false);
  RangeBorder.prototype.set = borderSet;
  RangeBorder.prototype.toJSON = borderToJSON;

  // RangeFormat is created by format.js, which intentionally owns the other
  // format children.  Extend its prototype after that module has installed
  // the constructor; no constructor wrapping is needed.
  Object.defineProperty(Excel.RangeFormat.prototype, "borders", {
    get: function () {
      if (!this._borders) this._borders = new RangeBorderCollection(this.context, this._range);
      return this._borders;
    },
  });
  if (typeof officeJs.addNavigationProperties === "function") {
    officeJs.addNavigationProperties(Excel.RangeFormat.prototype, ["borders"]);
  } else {
    // Keep the extension usable in a bootstrap-only harness that predates the
    // shared metadata helper. Production uses addNavigationProperties above.
    var navigation = Excel.RangeFormat.prototype._navigationProperties || [];
    if (navigation.indexOf("borders") < 0) navigation.push("borders");
    Excel.RangeFormat.prototype._navigationProperties = navigation;
  }
  if (typeof officeJs.addScalarProperties === "function") {
    officeJs.addScalarProperties(RangeBorder.prototype, BORDER_PROPERTIES);
    officeJs.addScalarProperties(RangeBorderCollection.prototype, COLLECTION_PROPERTIES);
  }

  // format.js predates collection navigation and only serializes its scalar
  // fields. Add the shallow borders member while preserving its behavior for
  // all existing format fields.
  var originalFormatToJSON = Excel.RangeFormat.prototype.toJSON;
  Excel.RangeFormat.prototype.toJSON = function () {
    var data = originalFormatToJSON ? originalFormatToJSON.call(this) : {};
    if (this._borders && this._borders._loaded.items) {
      data.borders = this._borders.toJSON().items;
    }
    return data;
  };

  Excel.RangeBorder = RangeBorder;
  Excel.RangeBorderCollection = RangeBorderCollection;
  Excel.__mogBorderKeys = BORDER_KEYS.slice();
})(globalThis);
