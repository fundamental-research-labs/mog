(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

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
    return new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function invalidRequestContext() {
    return new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  function integerArgument(value, property) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalidArgument(property + " must be an integer");
    }
    return value;
  }

  function newClientResult(context) {
    if (officeJs && typeof officeJs.createClientResult === "function") {
      return officeJs.createClientResult(context);
    }
    return new OfficeExtension.ClientResult(context);
  }

  function queueTableItem(table, collection, key, orNullObject, byIndex) {
    table._collection = collection;
    table._tableCollectionId = collection ? collection._id : null;
    var operation = {
      op: "tableGetItem",
      id: table._id,
      key: String(key),
    };
    if (collection && collection._worksheet) {
      operation.worksheetId = collection._worksheet._id;
    } else if (collection) {
      // Workbook-scoped lookup is resolved by the collection on the host.
      operation.collectionId = collection._id;
    }
    if (orNullObject === true) operation.orNullObject = true;
    if (byIndex === true) operation.byIndex = true;
    table.context._queue.push(operation);
    return table;
  }

  function TableCollection(context, worksheet, workbook) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._workbook = workbook || null;
    this._scalarProperties = ["items", "count"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);
    this._bindingQueued = false;

    if (officeJs && typeof officeJs.configureCollection === "function") {
      officeJs.configureCollection(this, function (key) {
        return this.getItem(key);
      });
    } else {
      // Production uses the shared bootstrap collection hook. This fallback
      // keeps the module usable with a compatible older bootstrap.
      this._hydrateItems = function (descriptors) {
        if (!Array.isArray(descriptors)) {
          throw new OfficeExtension.Error({
            code: "GeneralException",
            message: "The host returned an invalid collection result.",
          });
        }
        return descriptors.map(function (descriptor) {
          var item = this.getItem(descriptor && descriptor.key);
          var properties = descriptor && descriptor.properties;
          if (properties && typeof properties === "object") {
            Object.keys(properties).forEach(function (name) {
              item._loaded[name] = true;
              item[name === "id" ? "_idValue" : "_" + name] = properties[name];
            });
          }
          return item;
        }, this);
      };
    }
  }
  TableCollection.prototype = Object.create(ClientObject.prototype);
  TableCollection.prototype.constructor = TableCollection;

  Object.defineProperty(TableCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  Object.defineProperty(TableCollection.prototype, "count", {
    get: function () {
      if (!this._loaded.count) throw propertyNotLoaded("count");
      return this._count;
    },
    configurable: true,
  });

  TableCollection.prototype._ensureBinding = function () {
    if (this._bindingQueued) return;
    var binding = {
      op: "getTableCollection",
      id: this._id,
    };
    if (this._worksheet) binding.worksheetId = this._worksheet._id;
    this.context._queue.push(binding);
    this._bindingQueued = true;
  };

  TableCollection.prototype._newTable = function (key) {
    var table = new Table(this.context, this._worksheet, this);
    table._key = key;
    return table;
  };

  TableCollection.prototype.add = function (address, hasHeaders) {
    if (typeof hasHeaders !== "boolean") {
      throw invalidArgument("TableCollection.add hasHeaders must be a boolean");
    }
    if (address instanceof Excel.Range && address.context !== this.context) {
      throw invalidRequestContext();
    }
    if (!(address instanceof Excel.Range) && typeof address !== "string") {
      throw invalidArgument("TableCollection.add requires a Range or range address");
    }
    var table = this._newTable(null);
    var op = {
      op: "tableAdd",
      id: table._id,
      hasHeaders: hasHeaders,
    };
    if (this._worksheet) op.worksheetId = this._worksheet._id;
    if (address instanceof Excel.Range) {
      op.rangeId = address._id;
    } else {
      op.address = address;
    }
    this.context._queue.push(op);
    return table;
  };

  TableCollection.prototype.getItem = function (key) {
    if (typeof key !== "string") {
      throw invalidArgument("TableCollection.getItem requires a table name or ID");
    }
    this._ensureBinding();
    var cacheKey = "key:" + key.toLowerCase();
    var table = this._itemCache[cacheKey];
    if (!table) {
      table = this._newTable(key);
      this._itemCache[cacheKey] = table;
      queueTableItem(table, this, key, false, false);
    }
    return table;
  };

  TableCollection.prototype.getItemAt = function (index) {
    integerArgument(index, "TableCollection.getItemAt index");
    this._ensureBinding();
    var cacheKey = "index:" + index;
    var table = this._itemCache[cacheKey];
    if (!table) {
      table = this._newTable(index);
      this._itemCache[cacheKey] = table;
      queueTableItem(table, this, index, false, true);
    }
    return table;
  };

  TableCollection.prototype.getItemOrNullObject = function (key) {
    if (typeof key !== "string") {
      throw invalidArgument("TableCollection.getItemOrNullObject requires a table name or ID");
    }
    this._ensureBinding();
    var cacheKey = "null:" + key.toLowerCase();
    var table = this._itemCache[cacheKey];
    if (!table) {
      table = this._newTable(key);
      this._itemCache[cacheKey] = table;
      queueTableItem(table, this, key, true, false);
    }
    return table;
  };

  TableCollection.prototype.getCount = function () {
    this._ensureBinding();
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "tableCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  TableCollection.prototype.load = function (props) {
    this._ensureBinding();
    return ClientObject.prototype.load.call(this, props);
  };

  TableCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function Table(context, worksheet, collection) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._collection = collection || null;
    this._scalarProperties = [
      "id",
      "name",
      "style",
      "showHeaders",
      "showTotals",
      "highlightFirstColumn",
      "highlightLastColumn",
      "showBandedRows",
      "showBandedColumns",
      "showFilterButton",
    ];
  }
  Table.prototype = Object.create(ClientObject.prototype);
  Table.prototype.constructor = Table;

  Object.defineProperty(Table.prototype, "id", {
    get: function () {
      if (!this._loaded.id) throw propertyNotLoaded("id");
      return this._idValue;
    },
  });

  [
    "name",
    "style",
    "showHeaders",
    "showTotals",
    "highlightFirstColumn",
    "highlightLastColumn",
    "showBandedRows",
    "showBandedColumns",
    "showFilterButton",
  ].forEach(function (name) {
    Object.defineProperty(Table.prototype, name, {
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

  Table.prototype.set = function (source) {
    requirePropertyObject(source);
    var names = [
      "name",
      "style",
      "showHeaders",
      "showTotals",
      "highlightFirstColumn",
      "highlightLastColumn",
      "showBandedRows",
      "showBandedColumns",
      "showFilterButton",
    ];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (source instanceof ClientObject) {
        if (source._loaded[name]) this[name] = source[name];
      } else if (Object.prototype.hasOwnProperty.call(source, name)) {
        this[name] = source[name];
      }
    }
  };

  Table.prototype.toJSON = function () {
    var data = {};
    for (var i = 0; i < this._scalarProperties.length; i++) {
      var name = this._scalarProperties[i];
      if (!this._loaded[name]) continue;
      data[name] = name === "id" ? this._idValue : this["_" + name];
    }
    return data;
  };

  function tableRange(table, kind) {
    var range = new Excel.Range(table.context, table._worksheet, null);
    table.context._queue.push({
      op: "tableGetRange",
      id: range._id,
      tableId: table._id,
      kind: kind,
    });
    return range;
  }

  Table.prototype.getRange = function () {
    return tableRange(this, "full");
  };

  Table.prototype.getHeaderRowRange = function () {
    return tableRange(this, "header");
  };

  Table.prototype.getDataBodyRange = function () {
    return tableRange(this, "dataBody");
  };

  Table.prototype.getTotalRowRange = function () {
    return tableRange(this, "total");
  };

  Object.defineProperty(Table.prototype, "sort", {
    configurable: true,
    get: function () {
      if (!this._sort) {
        this._sort = this.getDataBodyRange().sort;
      }
      return this._sort;
    },
  });

  Table.prototype.delete = function () {
    this.context._queue.push({ op: "tableDelete", id: this._id });
  };

  Table.prototype.convertToRange = function () {
    var range = new Excel.Range(this.context, this._worksheet, null);
    this.context._queue.push({
      op: "tableConvertToRange",
      id: range._id,
      tableId: this._id,
    });
    return range;
  };

  Table.prototype.resize = function (newRange) {
    if (newRange instanceof Excel.Range) {
      if (newRange.context !== this.context) throw invalidRequestContext();
      this.context._queue.push({
        op: "tableResize",
        tableId: this._id,
        rangeId: newRange._id,
      });
      return;
    }
    if (typeof newRange !== "string") {
      throw invalidArgument("Table.resize requires a Range or range address");
    }
    this.context._queue.push({
      op: "tableResize",
      tableId: this._id,
      address: newRange,
    });
  };

  function worksheetTables(worksheet) {
    if (!worksheet._tables) {
      worksheet._tables = new TableCollection(worksheet.context, worksheet, null);
    }
    return worksheet._tables;
  }

  function workbookTables(workbook) {
    if (!workbook._tables) {
      workbook._tables = new TableCollection(workbook.context, null, workbook);
    }
    return workbook._tables;
  }

  Object.defineProperty(Excel.Worksheet.prototype, "tables", {
    get: function () {
      return worksheetTables(this);
    },
    configurable: true,
  });

  Object.defineProperty(Excel.Workbook.prototype, "tables", {
    get: function () {
      return workbookTables(this);
    },
    configurable: true,
  });

  Excel.TableCollection = TableCollection;
  Excel.Table = Table;
})(globalThis);
