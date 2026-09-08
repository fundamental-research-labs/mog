(function (global) {
  "use strict";

  // This module contains the Office.js proxy layer for the four PivotTable
  // hierarchy collections.  The host owns the persisted pivot config; these
  // objects only keep request-context identity and queue the corresponding
  // operation.  The `pivotId` in each operation is the persisted pivot ID,
  // while `id` remains the request-context proxy ID.

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs || {};
  var configureCollection = officeJs.configureCollection;

  function propertyNotLoaded(name) {
    var error = new OfficeExtension.Error({
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
    var error = new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function invalidRequestContext() {
    var error = new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
    error.name = "RichApi.Error";
    error.code = "InvalidRequestContext";
    return error;
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function stringArgument(value, property) {
    if (typeof value !== "string") throw invalidArgument(property + " must be a string");
    return value;
  }

  function integerArgument(value, property) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalidArgument(property + " must be an integer");
    }
    if (value < 0) throw invalidArgument(property + " must be non-negative");
    return value;
  }

  function enumArgument(value, property, values) {
    stringArgument(value, property);
    if (values.indexOf(value) < 0) {
      throw invalidArgument(property + " has an invalid value");
    }
    return value;
  }

  var AGGREGATION_FUNCTIONS = [
    "Unknown",
    "Automatic",
    "Sum",
    "Count",
    "Average",
    "Max",
    "Min",
    "Product",
    "CountNumbers",
    "StandardDeviation",
    "StandardDeviationP",
    "Variance",
    "VarianceP",
  ];

  var SHOW_AS_CALCULATIONS = [
    "Unknown",
    "None",
    "PercentOfGrandTotal",
    "PercentOfRowTotal",
    "PercentOfColumnTotal",
    "PercentOfParentRowTotal",
    "PercentOfParentColumnTotal",
    "PercentOfParentTotal",
    "PercentOf",
    "RunningTotal",
    "PercentRunningTotal",
    "DifferenceFrom",
    "PercentDifferenceFrom",
    "RankAscending",
    "RankDecending",
    "Index",
  ];

  function validateScalar(name, value) {
    switch (name) {
      case "name":
      case "numberFormat":
        return stringArgument(value, "PivotHierarchy." + name);
      case "position":
        return integerArgument(value, "PivotHierarchy.position");
      case "enableMultipleFilterItems":
        if (typeof value !== "boolean") {
          throw invalidArgument("PivotHierarchy.enableMultipleFilterItems must be a boolean");
        }
        return value;
      case "summarizeBy":
        return enumArgument(value, "DataPivotHierarchy.summarizeBy", AGGREGATION_FUNCTIONS);
      case "showAs":
        if (value == null || typeof value !== "object" || Array.isArray(value)) {
          throw invalidArgument("DataPivotHierarchy.showAs must be an object");
        }
        if (!Object.prototype.hasOwnProperty.call(value, "calculation")) {
          throw invalidArgument("DataPivotHierarchy.showAs.calculation is required");
        }
        enumArgument(value.calculation, "DataPivotHierarchy.showAs.calculation", SHOW_AS_CALCULATIONS);
        return value;
      default:
        return value;
    }
  }

  // PivotTable implementations can expose the persisted ID under any of
  // these private fields while they are being constructed.  Keeping this
  // lookup in one place lets the proxy preserve the proxy/persisted ID split.
  function persistedPivotId(pivot) {
    if (!pivot) return "";
    if (pivot._pivotRef) {
      var refId = persistedPivotId(pivot._pivotRef);
      if (refId) return refId;
    }
    // A PivotTable obtained by name starts with `_pivotId`/`_key` equal to
    // that display name.  Once its binding has loaded, `_idValue` is the
    // engine's stable persisted identity and must win over those hints;
    // otherwise a hierarchy collection would look up the name as an ID and
    // every `hierarchies` item would report ItemNotFound.
    var candidates = [
      pivot._idValue,
      pivot._pivotId,
      pivot._pivotKey,
      pivot._key,
      pivot._nameHint,
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "string" && candidates[i].length > 0) {
        return candidates[i];
      }
    }
    // A pivot created by the core adapter is always bound before one of its
    // hierarchy collections is accessed.  This fallback preserves a useful
    // object-path error for an unbound proxy instead of throwing in JavaScript.
    return pivot._id;
  }

  function hierarchyKey(hierarchy) {
    if (!hierarchy) return "";
    var candidates = [
      hierarchy._key,
      hierarchy._pivotHierarchyId,
      hierarchy._idValue,
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "string" && candidates[i].length > 0) {
        return candidates[i];
      }
    }
    return hierarchy._id;
  }

  function samePivot(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    return persistedPivotId(left) === persistedPivotId(right);
  }

  function collectionItemCacheKey(key, nullObject) {
    return (nullObject ? "null:" : "item:") + String(key).toLowerCase();
  }

  function itemConstructorFor(kind) {
    switch (kind) {
      case "all": return Excel.PivotHierarchy;
      case "row":
      case "column": return Excel.RowColumnPivotHierarchy;
      case "data": return Excel.DataPivotHierarchy;
      case "filter": return Excel.FilterPivotHierarchy;
      default: throw invalidArgument("Unsupported PivotHierarchy collection kind");
    }
  }

  function itemTypeFor(kind) {
    switch (kind) {
      case "all": return Excel.PivotHierarchy;
      case "row":
      case "column": return Excel.RowColumnPivotHierarchy;
      case "data": return Excel.DataPivotHierarchy;
      case "filter": return Excel.FilterPivotHierarchy;
      default: return null;
    }
  }

  function PivotHierarchyCollectionBase(context, pivot, kind) {
    ClientObject.call(this, context);
    this._pivot = pivot || null;
    this._pivotId = persistedPivotId(pivot);
    this._kind = kind;
    this._scalarProperties = ["items", "count"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);

    // The pivot core adapter resolves `pivotId` against its persisted config.
    // `pivotObjectId` is retained as a path hint for hosts that bind the
    // collection through the already registered PivotTable proxy.
    context._queue.push({
      op: "pivotGetHierarchyCollection",
      id: this._id,
      pivotId: this._pivotId,
      pivotObjectId: pivot ? pivot._id : null,
      kind: kind,
    });

    if (typeof configureCollection === "function") {
      configureCollection(this, function (key) {
        // Descriptor hydration happens after the host finishes the current
        // sync.  Queue the ordinary item binding for the next sync so an item
        // obtained from `collection.items` can be mutated just like one from
        // an explicit getItem call.
        return this._getItem(key, true, false);
      });
    } else {
      // The shipped bootstrap provides configureCollection.  This fallback
      // keeps this module independently evaluable by the conformance harness.
      var collection = this;
      this._hydrateItems = function (descriptors) {
        if (!Array.isArray(descriptors)) {
          throw new OfficeExtension.Error({
            code: "GeneralException",
            message: "The host returned an invalid collection result.",
          });
        }
        return descriptors.map(function (descriptor) {
          if (!descriptor || typeof descriptor !== "object" || !("key" in descriptor)) {
            throw new OfficeExtension.Error({
              code: "GeneralException",
              message: "The host returned an invalid collection item descriptor.",
            });
          }
          var item = collection._getItem(descriptor.key, true, false);
          var properties = descriptor.properties || {};
          Object.keys(properties).forEach(function (name) {
            if (typeof officeJs.hydrateProperty === "function") {
              officeJs.hydrateProperty(item, name, properties[name]);
            } else {
              item._loaded[name] = true;
              item[name === "id" ? "_idValue" : "_" + name] = properties[name];
            }
          });
          return item;
        });
      };
      Object.defineProperty(this, "items", {
        get: function () {
          if (!this._loaded.items) throw propertyNotLoaded("items");
          return this._items || [];
        },
        configurable: true,
      });
    }
  }
  PivotHierarchyCollectionBase.prototype = Object.create(ClientObject.prototype);
  PivotHierarchyCollectionBase.prototype.constructor = PivotHierarchyCollectionBase;

  Object.defineProperty(PivotHierarchyCollectionBase.prototype, "count", {
    get: function () {
      if (!this._loaded.count) throw propertyNotLoaded("count");
      return this._count;
    },
    configurable: true,
  });

  PivotHierarchyCollectionBase.prototype._newItem = function (key) {
    var Constructor = itemConstructorFor(this._kind);
    return new Constructor(this.context, this._pivot, key, false, this);
  };

  PivotHierarchyCollectionBase.prototype._getItem = function (key, bind, orNullObject) {
    key = String(key);
    var cacheKey = collectionItemCacheKey(key, orNullObject === true);
    var item = this._itemCache[cacheKey];
    if (!item) {
      item = this._newItem(key);
      item._key = key;
      item._collection = this;
      this._itemCache[cacheKey] = item;
    }
    if (bind === true) {
      this.context._queue.push({
        op: "pivotHierarchyGetItem",
        id: item._id,
        collectionId: this._id,
        pivotId: this._pivotId,
        pivotObjectId: this._pivot ? this._pivot._id : null,
        kind: this._kind,
        key: key,
        orNullObject: orNullObject === true,
      });
    }
    return item;
  };

  PivotHierarchyCollectionBase.prototype.getItem = function (key) {
    stringArgument(key, "PivotHierarchyCollection.getItem name");
    return this._getItem(key, true, false);
  };

  PivotHierarchyCollectionBase.prototype.getItemOrNullObject = function (key) {
    stringArgument(key, "PivotHierarchyCollection.getItemOrNullObject name");
    return this._getItem(key, true, true);
  };

  PivotHierarchyCollectionBase.prototype.getCount = function () {
    var result = typeof officeJs.createClientResult === "function"
      ? officeJs.createClientResult(this.context)
      : new OfficeExtension.ClientResult(this.context);
    this.context._queue.push({
      op: "pivotHierarchyCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  PivotHierarchyCollectionBase.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function defineCollectionCtor(name, parent) {
    var Constructor = function (context, pivot, explicitKind) {
      PivotHierarchyCollectionBase.call(this, context, pivot, explicitKind || name);
    };
    Constructor.prototype = Object.create(parent.prototype);
    Constructor.prototype.constructor = Constructor;
    return Constructor;
  }

  function addHierarchy(collection, pivotHierarchy) {
    if (
      !(pivotHierarchy instanceof Excel.PivotHierarchy) ||
      pivotHierarchy.constructor !== Excel.PivotHierarchy
    ) {
      throw invalidArgument("PivotHierarchyCollection.add requires a PivotHierarchy");
    }
    if (pivotHierarchy.context !== collection.context) throw invalidRequestContext();
    if (!samePivot(collection._pivot, pivotHierarchy._pivot)) {
      throw invalidArgument("The PivotHierarchy belongs to a different PivotTable");
    }

    var key = hierarchyKey(pivotHierarchy);
    var item = collection._newItem(key);
    item._key = key;
    item._collection = collection;
    collection.context._queue.push({
      op: "pivotHierarchyAdd",
      id: item._id,
      collectionId: collection._id,
      pivotId: collection._pivotId,
      pivotObjectId: collection._pivot ? collection._pivot._id : null,
      hierarchyObjectId: pivotHierarchy._id,
      hierarchyId: key,
      kind: collection._kind,
    });
    return item;
  }

  function removeHierarchy(collection, hierarchy) {
    var Expected = itemTypeFor(collection._kind);
    if (!(hierarchy instanceof Expected)) {
      throw invalidArgument("PivotHierarchyCollection.remove requires an item from this collection");
    }
    if (hierarchy.context !== collection.context) throw invalidRequestContext();
    if (!samePivot(collection._pivot, hierarchy._pivot)) {
      throw invalidArgument("The PivotHierarchy belongs to a different PivotTable");
    }
    collection.context._queue.push({
      op: "pivotHierarchyRemove",
      id: hierarchy._id,
      collectionId: collection._id,
      pivotId: collection._pivotId,
      pivotObjectId: collection._pivot ? collection._pivot._id : null,
      hierarchyId: hierarchyKey(hierarchy),
      kind: collection._kind,
    });
  }

  function PivotHierarchy(context, pivot, key, bind, collection) {
    ClientObject.call(this, context);
    this._pivot = pivot || null;
    this._collection = collection || null;
    this._key = key == null ? null : String(key);
    this._scalarProperties = ["id", "name"];
    if (bind === true && collection) collection._getItem(this._key, true, false);
  }
  PivotHierarchy.prototype = Object.create(ClientObject.prototype);
  PivotHierarchy.prototype.constructor = PivotHierarchy;

  function RowColumnPivotHierarchy(context, pivot, key, bind, collection) {
    PivotHierarchy.call(this, context, pivot, key, bind, collection);
    this._scalarProperties = ["id", "name", "position"];
  }
  RowColumnPivotHierarchy.prototype = Object.create(PivotHierarchy.prototype);
  RowColumnPivotHierarchy.prototype.constructor = RowColumnPivotHierarchy;

  function FilterPivotHierarchy(context, pivot, key, bind, collection) {
    PivotHierarchy.call(this, context, pivot, key, bind, collection);
    this._scalarProperties = ["enableMultipleFilterItems", "id", "name", "position"];
  }
  FilterPivotHierarchy.prototype = Object.create(PivotHierarchy.prototype);
  FilterPivotHierarchy.prototype.constructor = FilterPivotHierarchy;

  function DataPivotHierarchy(context, pivot, key, bind, collection) {
    PivotHierarchy.call(this, context, pivot, key, bind, collection);
    this._scalarProperties = [
      "field",
      "id",
      "name",
      "numberFormat",
      "position",
      "showAs",
      "summarizeBy",
    ];
  }
  DataPivotHierarchy.prototype = Object.create(PivotHierarchy.prototype);
  DataPivotHierarchy.prototype.constructor = DataPivotHierarchy;

  function defineReadWriteScalars(Constructor, names) {
    names.forEach(function (name) {
      Object.defineProperty(Constructor.prototype, name, {
        get: function () {
          if (!this._loaded[name]) throw propertyNotLoaded(name);
          return this["_" + name];
        },
        set: function (value) {
          value = validateScalar(name, value);
          this["_" + name] = value;
          this._loaded[name] = true;
          this.context._queue.push({
            op: "set",
            id: this._id,
            property: name,
            value: value,
          });
        },
        configurable: true,
      });
    });
  }

  function defineReadOnlyScalar(Constructor, name) {
    Object.defineProperty(Constructor.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return name === "id" ? this._idValue : this["_" + name];
      },
      configurable: true,
    });
  }

  defineReadOnlyScalar(PivotHierarchy, "id");
  defineReadWriteScalars(PivotHierarchy, ["name"]);

  defineReadOnlyScalar(RowColumnPivotHierarchy, "id");
  defineReadWriteScalars(RowColumnPivotHierarchy, ["name", "position"]);

  defineReadOnlyScalar(FilterPivotHierarchy, "id");
  defineReadWriteScalars(FilterPivotHierarchy, ["enableMultipleFilterItems", "name", "position"]);

  defineReadOnlyScalar(DataPivotHierarchy, "id");
  defineReadWriteScalars(DataPivotHierarchy, [
    "name",
    "numberFormat",
    "position",
    "showAs",
    "summarizeBy",
  ]);

  // The compute pivot model exposes a data hierarchy's source field as the
  // compact `{ id, name }` descriptor returned by the host.  Keep it a
  // readonly, load-gated property here; a later PivotField family can replace
  // the descriptor with a richer proxy without changing this data hierarchy
  // contract.
  Object.defineProperty(DataPivotHierarchy.prototype, "field", {
    get: function () {
      if (!this._loaded.field) throw propertyNotLoaded("field");
      return this._field;
    },
    configurable: true,
  });

  function setProperties(source, options, names) {
    requirePropertyObject(source);
    var properties = source;
    if (source instanceof ClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      properties = source.toJSON();
    }
    if (
      Object.prototype.hasOwnProperty.call(properties, "id") &&
      properties.id !== undefined &&
      !(options && options.throwOnReadOnly === false)
    ) {
      throw invalidArgument("PivotHierarchy.id is read-only");
    }
    names.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(properties, name) && properties[name] !== undefined) {
        this[name] = properties[name];
      }
    }, this);
  }

  PivotHierarchy.prototype.set = function (source, options) {
    setProperties.call(this, source, options, ["name"]);
  };
  RowColumnPivotHierarchy.prototype.set = function (source, options) {
    setProperties.call(this, source, options, ["name", "position"]);
  };
  FilterPivotHierarchy.prototype.set = function (source, options) {
    setProperties.call(this, source, options, ["enableMultipleFilterItems", "name", "position"]);
  };
  DataPivotHierarchy.prototype.set = function (source, options) {
    setProperties.call(this, source, options, [
      "name",
      "numberFormat",
      "position",
      "showAs",
      "summarizeBy",
    ]);
  };

  function setToDefault() {
    this.context._queue.push({
      op: "pivotHierarchySetToDefault",
      id: this._id,
      pivotId: persistedPivotId(this._pivot),
      hierarchyId: hierarchyKey(this),
    });
  }
  RowColumnPivotHierarchy.prototype.setToDefault = setToDefault;
  FilterPivotHierarchy.prototype.setToDefault = setToDefault;
  DataPivotHierarchy.prototype.setToDefault = setToDefault;

  function toJSON() {
    var data = {};
    (this._scalarProperties || []).forEach(function (name) {
      if (this._loaded[name]) {
        data[name] = name === "id" ? this._idValue : this["_" + name];
      }
    }, this);
    return data;
  }
  PivotHierarchy.prototype.toJSON = toJSON;
  RowColumnPivotHierarchy.prototype.toJSON = toJSON;
  FilterPivotHierarchy.prototype.toJSON = toJSON;
  DataPivotHierarchy.prototype.toJSON = toJSON;

  var PivotHierarchyCollection = defineCollectionCtor("all", PivotHierarchyCollectionBase);
  var RowColumnPivotHierarchyCollection = defineCollectionCtor("row", PivotHierarchyCollectionBase);
  var DataPivotHierarchyCollection = defineCollectionCtor("data", PivotHierarchyCollectionBase);
  var FilterPivotHierarchyCollection = defineCollectionCtor("filter", PivotHierarchyCollectionBase);

  [
    [RowColumnPivotHierarchyCollection, "row"],
    [RowColumnPivotHierarchyCollection, "column"],
    [DataPivotHierarchyCollection, "data"],
    [FilterPivotHierarchyCollection, "filter"],
  ].forEach(function (entry) {
    entry[0].prototype.add = function (pivotHierarchy) {
      return addHierarchy(this, pivotHierarchy);
    };
    entry[0].prototype.remove = function (hierarchy) {
      removeHierarchy(this, hierarchy);
    };
  });

  function installPivotTableProperties() {
    if (!Excel.PivotTable || !Excel.PivotTable.prototype) return;
    var properties = [
      ["hierarchies", PivotHierarchyCollection],
      ["rowHierarchies", RowColumnPivotHierarchyCollection],
      ["columnHierarchies", RowColumnPivotHierarchyCollection],
      ["dataHierarchies", DataPivotHierarchyCollection],
      ["filterHierarchies", FilterPivotHierarchyCollection],
    ];
    properties.forEach(function (entry) {
      var name = entry[0];
      var Constructor = entry[1];
      var descriptor = Object.getOwnPropertyDescriptor(Excel.PivotTable.prototype, name);
      if (descriptor && descriptor.configurable === false) return;
      Object.defineProperty(Excel.PivotTable.prototype, name, {
        get: function () {
          if (!this._hierarchyCollections) {
            Object.defineProperty(this, "_hierarchyCollections", {
              value: Object.create(null),
              writable: true,
              configurable: true,
            });
          }
          if (!this._hierarchyCollections[name]) {
            var kind = name === "columnHierarchies" ? "column" : undefined;
            this._hierarchyCollections[name] = new Constructor(this.context, this, kind);
          }
          return this._hierarchyCollections[name];
        },
        configurable: true,
      });
    });
  }

  // Pivot core is loaded immediately before this module in production. Keep a
  // hook for a host that loads modules in the opposite order.
  if (global.__mogOfficeJs) {
    global.__mogOfficeJs.installPivotHierarchyProperties = installPivotTableProperties;
  }
  installPivotTableProperties();

  Excel.PivotHierarchyCollection = PivotHierarchyCollection;
  Excel.PivotHierarchy = PivotHierarchy;
  Excel.RowColumnPivotHierarchyCollection = RowColumnPivotHierarchyCollection;
  Excel.RowColumnPivotHierarchy = RowColumnPivotHierarchy;
  Excel.FilterPivotHierarchyCollection = FilterPivotHierarchyCollection;
  Excel.FilterPivotHierarchy = FilterPivotHierarchy;
  Excel.DataPivotHierarchyCollection = DataPivotHierarchyCollection;
  Excel.DataPivotHierarchy = DataPivotHierarchy;
})(globalThis);
