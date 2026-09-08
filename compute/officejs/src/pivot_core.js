(function (global) {
  "use strict";

  // PivotTable is deliberately a thin Office.js proxy.  The persisted ID and
  // configuration live in compute-api; this file only creates request-context
  // objects and queues operations for the host dispatcher.  In particular,
  // refresh and delete are host operations so they use the engine's real
  // pivot materializer and never maintain a second JavaScript result cache.

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs || {};

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

  function newClientResult(context) {
    if (typeof officeJs.createClientResult === "function") {
      return officeJs.createClientResult(context);
    }
    return new OfficeExtension.ClientResult(context);
  }

  function nonEmptyString(value, property) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidArgument(property + " must be a non-empty string");
    }
    return value;
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function assertSameContext(object, context, property) {
    if (object instanceof ClientObject) {
      if (object.context !== context) throw invalidRequestContext();
      return object;
    }
    throw invalidArgument(property + " must be a Range, string, or Table");
  }

  function isRange(value) {
    return typeof Excel.Range === "function" && value instanceof Excel.Range;
  }

  function isTable(value) {
    return typeof Excel.Table === "function" && value instanceof Excel.Table;
  }

  function sourceArgument(value, context) {
    if (isRange(value)) {
      assertSameContext(value, context, "PivotTableCollection.add source");
      return { rangeId: value._id };
    }
    if (isTable(value)) {
      assertSameContext(value, context, "PivotTableCollection.add source");
      return { tableId: value._id };
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return { address: value };
    }
    throw invalidArgument(
      "PivotTableCollection.add source must be a Range, string, or Table"
    );
  }

  function destinationArgument(value, context) {
    if (isRange(value)) {
      assertSameContext(value, context, "PivotTableCollection.add destination");
      return { rangeId: value._id };
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return { address: value };
    }
    throw invalidArgument(
      "PivotTableCollection.add destination must be a Range or range address"
    );
  }

  function scopeFields(collection, operation) {
    operation.collectionId = collection._id;
    if (collection._worksheet) operation.worksheetId = collection._worksheet._id;
    return operation;
  }

  function persistedPivotKey(pivot) {
    if (!pivot) return null;
    // `_idValue` is populated from a loaded persisted id.  `_key` is retained
    // for a getItem proxy before the host binding has completed.  The host
    // receives `pivotObjectId` as well, so newly-created proxies remain valid
    // even while their persisted ID is not known to JavaScript.
    if (typeof pivot._idValue === "string" && pivot._idValue.length > 0) {
      return pivot._idValue;
    }
    if (typeof pivot._pivotId === "string" && pivot._pivotId.length > 0) {
      return pivot._pivotId;
    }
    if (typeof pivot._key === "string" && pivot._key.length > 0) {
      return pivot._key;
    }
    return null;
  }

  function queuePivotBinding(pivot, collection, key, orNullObject) {
    var operation = {
      op: "pivotTableGetItem",
      id: pivot._id,
      key: String(key),
      orNullObject: orNullObject === true,
    };
    scopeFields(collection, operation);
    pivot.context._queue.push(operation);
    return pivot;
  }

  function PivotTableCollection(context, worksheet, workbook) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._workbook = workbook || null;
    this._scalarProperties = ["items"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);

    // Binding is queued at construction time.  This preserves operation order
    // when a worksheet itself was obtained in the same Excel.run batch.
    context._queue.push({
      op: "getPivotTableCollection",
      id: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    });

    if (typeof officeJs.configureCollection === "function") {
      officeJs.configureCollection(this, function (key) {
        return this.getItem(String(key));
      });
    } else {
      // Kept for conformance harnesses that evaluate this family without the
      // shared bootstrap.  Production uses configureCollection above.
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
          var item = collection.getItem(String(descriptor.key));
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
    }
  }
  PivotTableCollection.prototype = Object.create(ClientObject.prototype);
  PivotTableCollection.prototype.constructor = PivotTableCollection;

  Object.defineProperty(PivotTableCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  PivotTableCollection.prototype._newPivot = function (key) {
    var pivot = new PivotTable(this.context, this._worksheet, this, key);
    pivot._key = key == null ? null : String(key);
    pivot._pivotId = pivot._key;
    return pivot;
  };

  PivotTableCollection.prototype.add = function (name, source, destination) {
    name = nonEmptyString(name, "PivotTableCollection.add name");
    var sourceFields = sourceArgument(source, this.context);
    var destinationFields = destinationArgument(destination, this.context);
    var pivot = this._newPivot(null);
    var operation = {
      op: "pivotTableAdd",
      id: pivot._id,
      name: name,
    };
    scopeFields(this, operation);
    if (Object.prototype.hasOwnProperty.call(sourceFields, "rangeId")) {
      operation.sourceRangeId = sourceFields.rangeId;
    } else if (Object.prototype.hasOwnProperty.call(sourceFields, "tableId")) {
      operation.sourceTableId = sourceFields.tableId;
    } else {
      operation.sourceAddress = sourceFields.address;
    }
    if (Object.prototype.hasOwnProperty.call(destinationFields, "rangeId")) {
      operation.destinationRangeId = destinationFields.rangeId;
    } else {
      operation.destinationAddress = destinationFields.address;
    }
    this.context._queue.push(operation);
    return pivot;
  };

  PivotTableCollection.prototype.getItem = function (key) {
    key = nonEmptyString(key, "PivotTableCollection.getItem name");
    var cacheKey = "item:" + key.toLowerCase();
    var pivot = this._itemCache[cacheKey];
    if (!pivot) {
      pivot = this._newPivot(key);
      this._itemCache[cacheKey] = pivot;
      queuePivotBinding(pivot, this, key, false);
    }
    return pivot;
  };

  PivotTableCollection.prototype.getItemOrNullObject = function (key) {
    key = nonEmptyString(key, "PivotTableCollection.getItemOrNullObject name");
    var cacheKey = "null:" + key.toLowerCase();
    var pivot = this._itemCache[cacheKey];
    if (!pivot) {
      pivot = this._newPivot(key);
      this._itemCache[cacheKey] = pivot;
      queuePivotBinding(pivot, this, key, true);
    }
    return pivot;
  };

  PivotTableCollection.prototype.getCount = function () {
    var result = newClientResult(this.context);
    var operation = {
      op: "pivotTableCollectionGetCount",
      resultId: result._id,
    };
    scopeFields(this, operation);
    this.context._queue.push(operation);
    return result;
  };

  PivotTableCollection.prototype.refreshAll = function () {
    var operation = { op: "pivotTableCollectionRefreshAll" };
    scopeFields(this, operation);
    this.context._queue.push(operation);
  };

  PivotTableCollection.prototype.load = function (props) {
    // The constructor binds the collection.  Keeping load as a thin wrapper
    // ensures collection loads use the shared path's item descriptor handling.
    return ClientObject.prototype.load.call(this, props);
  };

  PivotTableCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function PivotTable(context, worksheet, collection, key) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._collection = collection || null;
    this._key = key == null ? null : String(key);
    this._pivotId = this._key;
    this._scalarProperties = [
      "allowMultipleFiltersPerField",
      "enableDataValueEditing",
      "id",
      "name",
      "refreshOnOpen",
      "useCustomSortLists",
    ];
    this._navigationProperties = [
      "columnHierarchies",
      "dataHierarchies",
      "filterHierarchies",
      "hierarchies",
      "layout",
      "rowHierarchies",
      "worksheet",
    ];
  }
  PivotTable.prototype = Object.create(ClientObject.prototype);
  PivotTable.prototype.constructor = PivotTable;

  Object.defineProperty(PivotTable.prototype, "id", {
    get: function () {
      if (!this._loaded.id) throw propertyNotLoaded("id");
      return this._idValue;
    },
    configurable: true,
  });

  [
    "allowMultipleFiltersPerField",
    "enableDataValueEditing",
    "name",
    "refreshOnOpen",
    "useCustomSortLists",
  ].forEach(function (name) {
    Object.defineProperty(PivotTable.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        if (name === "name") {
          value = nonEmptyString(value, "PivotTable.name");
        } else if (typeof value !== "boolean") {
          throw invalidArgument("PivotTable." + name + " must be a boolean");
        }
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

  PivotTable.prototype.set = function (source, options) {
    requirePropertyObject(source);
    var properties = source;
    if (source instanceof ClientObject) {
      if (!(source instanceof PivotTable)) {
        throw invalidArgument("The object passed to set must be a PivotTable");
      }
      properties = source.toJSON();
    }
    var names = [
      "allowMultipleFiltersPerField",
      "enableDataValueEditing",
      "name",
      "refreshOnOpen",
      "useCustomSortLists",
    ];
    names.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(properties, name) && properties[name] !== undefined) {
        this[name] = properties[name];
      }
    }, this);

    // `id` is the only read-only scalar in this core update shape.  Match the
    // Office.js update option while still making accidental writes visible.
    if (
      Object.prototype.hasOwnProperty.call(properties, "id") &&
      properties.id !== undefined &&
      !(options && options.throwOnReadOnly === false)
    ) {
      throw invalidArgument("PivotTable.id is read-only");
    }
  };

  PivotTable.prototype.delete = function () {
    this.context._queue.push({ op: "pivotTableDelete", id: this._id });
  };

  PivotTable.prototype.refresh = function () {
    this.context._queue.push({ op: "pivotTableRefresh", id: this._id });
  };

  PivotTable.prototype.getDataSourceString = function () {
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "pivotTableGetDataSourceString",
      id: this._id,
      resultId: result._id,
    });
    return result;
  };

  PivotTable.prototype.getDataSourceType = function () {
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "pivotTableGetDataSourceType",
      id: this._id,
      resultId: result._id,
    });
    return result;
  };

  Object.defineProperty(PivotTable.prototype, "layout", {
    get: function () {
      if (!this._layout) this._layout = new PivotLayout(this.context, this);
      return this._layout;
    },
    configurable: true,
  });

  Object.defineProperty(PivotTable.prototype, "worksheet", {
    get: function () {
      if (this._worksheet) return this._worksheet;
      if (!this._worksheetResult) {
        this._worksheetResult = new Excel.Worksheet(this.context, null);
        this.context._queue.push({
          op: "pivotTableGetWorksheet",
          id: this._worksheetResult._id,
          pivotId: this._id,
          pivotObjectId: this._id,
        });
      }
      return this._worksheetResult;
    },
    configurable: true,
  });

  PivotTable.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (!this._loaded[name]) return;
      data[name] = name === "id" ? this._idValue : this["_" + name];
    }, this);
    return data;
  };

  function PivotLayout(context, pivot) {
    ClientObject.call(this, context);
    this._pivot = pivot || null;
    this._scalarProperties = [
      "altTextDescription",
      "altTextTitle",
      "autoFormat",
      "emptyCellText",
      "enableFieldList",
      "fillEmptyCells",
      "layoutType",
      "preserveFormatting",
      "showColumnGrandTotals",
      "showFieldHeaders",
      "showRowGrandTotals",
      "subtotalLocation",
    ];
    // Layout is a separately bound ClientObject so generic load/set can use
    // the same extension binding table as PivotTable and hierarchy objects.
    context._queue.push({
      op: "pivotGetLayout",
      id: this._id,
      pivotId: pivot ? pivot._id : null,
      pivotObjectId: pivot ? pivot._id : null,
    });
  }
  PivotLayout.prototype = Object.create(ClientObject.prototype);
  PivotLayout.prototype.constructor = PivotLayout;

  [
    "altTextDescription",
    "altTextTitle",
    "autoFormat",
    "emptyCellText",
    "enableFieldList",
    "fillEmptyCells",
    "layoutType",
    "preserveFormatting",
    "showColumnGrandTotals",
    "showFieldHeaders",
    "showRowGrandTotals",
    "subtotalLocation",
  ].forEach(function (name) {
    Object.defineProperty(PivotLayout.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
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

  PivotLayout.prototype.set = function (source) {
    requirePropertyObject(source);
    var properties = source instanceof ClientObject ? source.toJSON() : source;
    [
      "altTextDescription",
      "altTextTitle",
      "autoFormat",
      "emptyCellText",
      "enableFieldList",
      "fillEmptyCells",
      "layoutType",
      "preserveFormatting",
      "showColumnGrandTotals",
      "showFieldHeaders",
      "showRowGrandTotals",
      "subtotalLocation",
    ].forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(properties, name) && properties[name] !== undefined) {
        this[name] = properties[name];
      }
    }, this);
  };

  PivotLayout.prototype._range = function (kind) {
    var worksheet = this._pivot && this._pivot._worksheet ? this._pivot._worksheet : null;
    var range = new Excel.Range(this.context, worksheet, null);
    this.context._queue.push({
      op: "pivotLayoutGetRange",
      id: range._id,
      layoutId: this._id,
      pivotId: this._pivot ? this._pivot._id : null,
      pivotObjectId: this._pivot ? this._pivot._id : null,
      kind: kind,
    });
    return range;
  };

  PivotLayout.prototype.getRange = function () {
    return this._range("full");
  };

  PivotLayout.prototype.getRowLabelRange = function () {
    return this._range("rowLabel");
  };

  PivotLayout.prototype.getColumnLabelRange = function () {
    return this._range("columnLabel");
  };

  PivotLayout.prototype.getDataBodyRange = function () {
    return this._range("dataBody");
  };

  PivotLayout.prototype.getFilterAxisRange = function () {
    return this._range("filterAxis");
  };

  PivotLayout.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  function worksheetPivotTables(worksheet) {
    if (!worksheet._pivotTables) {
      worksheet._pivotTables = new PivotTableCollection(worksheet.context, worksheet, null);
    }
    return worksheet._pivotTables;
  }

  function workbookPivotTables(workbook) {
    if (!workbook._pivotTables) {
      workbook._pivotTables = new PivotTableCollection(workbook.context, null, workbook);
    }
    return workbook._pivotTables;
  }

  Object.defineProperty(Excel.Worksheet.prototype, "pivotTables", {
    get: function () {
      return worksheetPivotTables(this);
    },
    configurable: true,
  });

  Object.defineProperty(Excel.Workbook.prototype, "pivotTables", {
    get: function () {
      return workbookPivotTables(this);
    },
    configurable: true,
  });

  Excel.PivotTableCollection = PivotTableCollection;
  Excel.PivotTable = PivotTable;
  Excel.PivotLayout = PivotLayout;

  // The hierarchy family is loaded after this module in the production
  // runtime.  Its installer is intentionally optional so either module order
  // remains valid for isolated conformance tests.
  if (officeJs && typeof officeJs.installPivotHierarchyProperties === "function") {
    officeJs.installPivotHierarchyProperties();
  }
})(globalThis);
