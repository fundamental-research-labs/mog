(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

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

  function invalidRequestContext() {
    return new global.OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  function integerArgument(value, property, allowNull) {
    if (allowNull && (value === null || value === undefined)) return value;
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalidArgument(property + " must be an integer");
    }
    return value;
  }

  function normalizeLoad(props, defaults) {
    if (props === undefined || props === null) return defaults.slice();
    if (typeof props === "string") {
      return props
        .split(",")
        .map(function (entry) { return entry.trim(); })
        .filter(Boolean);
    }
    if (Array.isArray(props)) {
      return props.reduce(function (all, entry) {
        return all.concat(normalizeLoad(entry, defaults));
      }, []);
    }
    if (typeof props === "object") {
      var result = props.$all === true ? defaults.slice() : [];
      if (props.select != null) result = result.concat(normalizeLoad(props.select, []));
      if (props.expand != null) result = result.concat(normalizeLoad(props.expand, []));
      Object.keys(props).forEach(function (key) {
        if (key === "$all" || key === "select" || key === "expand" || key === "top" || key === "skip") return;
        var value = props[key];
        if (value === true) result.push(key);
        else if (value && typeof value === "object") {
          if (value.$all === true) result.push(key);
          normalizeLoad(value, []).forEach(function (path) {
            result.push(key + "/" + path);
          });
        }
      });
      return result;
    }
    return [String(props)];
  }

  function seedLoaded(object, properties) {
    if (!properties || typeof properties !== "object") return;
    Object.keys(properties).forEach(function (name) {
      object._loaded[name] = true;
      object[name === "id" ? "_idValue" : "_" + name] = properties[name];
    });
  }

  function toJSONScalars(object) {
    var result = {};
    (object._scalarProperties || []).forEach(function (name) {
      if (object._loaded[name]) {
        result[name] = name === "id" ? object._idValue : object["_" + name];
      }
    });
    return result;
  }

  function queueRange(object, kind) {
    var range = new Excel.Range(object.context, object._table._worksheet, null);
    object.context._queue.push({
      op: "tableColumnGetRange",
      id: range._id,
      columnId: object._id,
      kind: kind,
    });
    return range;
  }

  function queueRowRange(object) {
    var range = new Excel.Range(object.context, object._table._worksheet, null);
    object.context._queue.push({
      op: "tableRowGetRange",
      id: range._id,
      rowId: object._id,
    });
    return range;
  }

  function queueChildBinding(object, table, kind, key, orNullObject, byIndex) {
    object._table = table;
    object._tableId = table._id;
    object._key = key;
    if (kind === "column") {
      var columnOperation = {
        op: "tableColumnGetItem",
        id: object._id,
        tableId: table._id,
        key: key,
      };
      if (byIndex === true) columnOperation.byIndex = true;
      if (orNullObject === true) columnOperation.orNullObject = true;
      object.context._queue.push(columnOperation);
    } else {
      var rowOperation = {
        op: "tableRowGetItem",
        id: object._id,
        tableId: table._id,
        index: Number(key),
      };
      if (orNullObject === true) rowOperation.orNullObject = true;
      object.context._queue.push(rowOperation);
    }
  }

  function cacheKey(key) {
    return typeof key + ":" + String(key);
  }

  function childCollection(context, table, kind) {
    ClientObject.call(this, context);
    this._table = table;
    this._tableId = table._id;
    this._kind = kind;
    this._scalarProperties = ["items", "count"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);

    // Register the collection's table reference with the host. The shared
    // collection hook only owns descriptor hydration; it does not carry the
    // table selector or collection kind, so the host needs this one binding
    // operation before generic `load` can resolve the collection ID.
    context._queue.push({
      op: "tableCollectionGet",
      id: this._id,
      tableId: table._id,
      kind: kind,
    });

    // The shared runtime hook registers the descriptor factory used when a
    // collection load returns [{key, properties}]. The factory enters the
    // same binding path as an explicit lookup so every hydrated child is a
    // normal request-context object. Rows have only the declared getItemAt
    // API, so their private helper is used for hydration.
    var hooks = global.__mogOfficeJs;
    if (hooks && typeof hooks.configureCollection === "function") {
      hooks.configureCollection(this, function (key) {
        return this._kind === "columns"
          ? this.getItem(key)
          : this._getItem(Number(key));
      });
    } else {
      // Keep the extension loadable with an older bootstrap. Production uses
      // the shared hook above; this fallback mirrors its descriptor contract.
      this._hydrateItems = function (descriptors) {
        if (!Array.isArray(descriptors)) {
          throw new global.OfficeExtension.Error({
            code: "GeneralException",
            message: "The host returned an invalid collection result.",
          });
        }
        return descriptors.map(function (descriptor, index) {
          var key = descriptor && descriptor.key !== undefined
            ? descriptor.key
            : index;
          var item = this._kind === "columns"
            ? this.getItem(key)
            : this._getItem(Number(key));
          seedLoaded(item, descriptor && descriptor.properties);
          return item;
        }, this);
      };
    }
  }
  childCollection.prototype = Object.create(ClientObject.prototype);
  childCollection.prototype.constructor = childCollection;

  childCollection.prototype._newItem = function (key, bind, orNullObject, byIndex) {
    var item;
    if (this._kind === "columns") {
      item = new Excel.TableColumn(this.context, this._table, key, false);
      if (bind) queueChildBinding(item, this._table, "column", key, orNullObject, byIndex);
    } else {
      item = new Excel.TableRow(this.context, this._table, Number(key), false);
      if (bind) queueChildBinding(item, this._table, "row", Number(key), orNullObject);
    }
    return item;
  };

  childCollection.prototype._getItem = function (key, orNullObject, byIndex) {
    var normalized = this._kind === "rows" ? Number(key) : key;
    // A normal lookup and getItemOrNullObject must never share a proxy.  The
    // host binding carries the nullable lookup flag, so reusing a cached
    // normal proxy would turn a later OrNullObject call into ItemNotFound
    // (and reusing a nullable proxy would make a normal lookup look null).
    var lookup = cacheKey(normalized) + (byIndex === true ? ":index" : ":key") +
      (orNullObject === true ? ":null" : ":normal");
    var item = this._itemCache[lookup];
    if (!item) {
      item = this._newItem(normalized, true, orNullObject, byIndex);
      this._itemCache[lookup] = item;
    }
    return item;
  };

  Object.defineProperty(childCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
  });

  Object.defineProperty(childCollection.prototype, "count", {
    get: function () {
      if (!this._loaded.count) throw propertyNotLoaded("count");
      return this._count;
    },
  });

  childCollection.prototype.load = function (props) {
    // Office's generated collection load options name child scalar fields
    // directly (`columns.load({ select: "name" })`), while the host wire
    // contract represents the same projection as `items/name`. Preserve
    // already-qualified paths for callers that use the explicit form.
    var itemProperties = this._kind === "columns"
      ? ["id", "index", "name", "values"]
      : ["index", "values"];
    var paths = normalizeLoad(props, this._scalarProperties).map(function (path) {
      if (path === "items" || path === "count" || path.indexOf("items/") === 0) {
        return path;
      }
      return itemProperties.indexOf(path) >= 0 ? "items/" + path : path;
    });
    if (paths.length) {
      this.context._queue.push({
        op: "load",
        id: this._id,
        properties: paths,
      });
    }
    return this;
  };

  childCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) { return item.toJSON(); }),
    };
  };

  childCollection.prototype.getCount = function () {
    var hooks = global.__mogOfficeJs;
    var result = hooks && typeof hooks.createClientResult === "function"
      ? hooks.createClientResult(this.context)
      : new (global.OfficeExtension.ClientResult || ClientResult)(this.context);
    this.context._queue.push({
      op: "tableCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  childCollection.prototype._getItemAt = function (index) {
    return this._getItem(index);
  };

  function ClientResult(context) {
    this.context = context;
    this._id = "result_" + Math.random().toString(36).slice(2);
    this._loaded = false;
    this._value = undefined;
    if (context && context._results) context._results[this._id] = this;
  }
  Object.defineProperty(ClientResult.prototype, "value", {
    get: function () {
      if (!this._loaded) throw propertyNotLoaded("value");
      return this._value;
    },
  });

  function TableColumnCollection(context, table) {
    childCollection.call(this, context, table, "columns");
  }
  TableColumnCollection.prototype = Object.create(childCollection.prototype);
  TableColumnCollection.prototype.constructor = TableColumnCollection;

  TableColumnCollection.prototype.getItem = function (key) {
    if (typeof key !== "string" && typeof key !== "number") {
      throw invalidArgument("TableColumnCollection.getItem requires a column name or ID");
    }
    if (typeof key === "number") {
      integerArgument(key, "TableColumnCollection.getItem key", false);
    }
    return this._getItem(key);
  };

  TableColumnCollection.prototype.getItemAt = function (index) {
    integerArgument(index, "TableColumnCollection.getItemAt index", false);
    return this._getItem(index, false, true);
  };

  TableColumnCollection.prototype.getItemOrNullObject = function (key) {
    if (typeof key !== "string" && typeof key !== "number") {
      throw invalidArgument("TableColumnCollection.getItemOrNullObject requires a column name or ID");
    }
    if (typeof key === "number") {
      integerArgument(key, "TableColumnCollection.getItemOrNullObject key", false);
    }
    return this._getItem(key, true);
  };

  TableColumnCollection.prototype.add = function (index, values, name) {
    integerArgument(index, "TableColumnCollection.add index", true);
    var column = new Excel.TableColumn(this.context, this._table, null, false);
    var operation = {
      op: "tableColumnAdd",
      id: column._id,
      tableId: this._table._id,
    };
    if (arguments.length >= 1) operation.index = index;
    if (arguments.length >= 2) operation.values = values;
    if (arguments.length >= 3) operation.name = name;
    this.context._queue.push(operation);
    return column;
  };

  function TableColumn(context, table, key, bind) {
    ClientObject.call(this, context);
    this._table = table;
    this._tableId = table._id;
    this._key = key;
    this._scalarProperties = ["id", "index", "name", "values"];
    if (bind) queueChildBinding(this, table, "column", key);
  }
  TableColumn.prototype = Object.create(ClientObject.prototype);
  TableColumn.prototype.constructor = TableColumn;

  Object.defineProperty(TableColumn.prototype, "id", {
    get: function () {
      if (!this._loaded.id) throw propertyNotLoaded("id");
      return this._idValue;
    },
  });

  Object.defineProperty(TableColumn.prototype, "index", {
    get: function () {
      if (!this._loaded.index) throw propertyNotLoaded("index");
      return this._index;
    },
  });

  ["name", "values"].forEach(function (name) {
    Object.defineProperty(TableColumn.prototype, name, {
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
    });
  });

  TableColumn.prototype.set = function (source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var isClientObject = source instanceof ClientObject;
    if (isClientObject && source.context !== this.context) {
      throw invalidRequestContext();
    }
    if (isClientObject && Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
      throw invalidArgument("The object passed to set must have the same type.");
    }
    if (!isClientObject && (Object.prototype.hasOwnProperty.call(source, "id") ||
        Object.prototype.hasOwnProperty.call(source, "index")) &&
        (!options || options.throwOnReadOnly !== false)) {
      throw invalidArgument("The properties 'id' and 'index' are read-only.");
    }
    ["name", "values"].forEach(function (name) {
      if (isClientObject) {
        if (source._loaded[name]) this[name] = source[name];
      } else if (Object.prototype.hasOwnProperty.call(source, name)) {
        this[name] = source[name];
      }
    }, this);
  };

  TableColumn.prototype.delete = function () {
    this.context._queue.push({ op: "tableColumnDelete", id: this._id });
  };

  ["full", "header", "dataBody", "total"].forEach(function (kind) {
    var method = kind === "full" ? "getRange" :
      kind === "header" ? "getHeaderRowRange" :
      kind === "dataBody" ? "getDataBodyRange" : "getTotalRowRange";
    TableColumn.prototype[method] = function () {
      return queueRange(this, kind);
    };
  });

  TableColumn.prototype.toJSON = function () {
    return toJSONScalars(this);
  };

  function TableRowCollection(context, table) {
    childCollection.call(this, context, table, "rows");
  }
  TableRowCollection.prototype = Object.create(childCollection.prototype);
  TableRowCollection.prototype.constructor = TableRowCollection;

  TableRowCollection.prototype.getItemAt = function (index) {
    integerArgument(index, "TableRowCollection.getItemAt index", false);
    return this._getItem(index, false, true);
  };

  TableRowCollection.prototype.add = function (index, values, alwaysInsert) {
    integerArgument(index, "TableRowCollection.add index", true);
    if (alwaysInsert !== undefined && alwaysInsert !== null && typeof alwaysInsert !== "boolean") {
      throw invalidArgument("TableRowCollection.add alwaysInsert must be a boolean");
    }
    var row = new Excel.TableRow(this.context, this._table, null, false);
    // An explicit insertion index is already the returned row's positional
    // selector. For append, use a loaded count when available; the host also
    // hydrates `index` for an unknown append position before later operations.
    if (alwaysInsert !== false && typeof index === "number" && index >= 0) {
      row._key = index;
    } else if (alwaysInsert !== false && this._loaded.count) {
      row._key = this._count;
    }
    var operation = {
      op: "tableRowAdd",
      id: row._id,
      tableId: this._table._id,
    };
    if (arguments.length >= 1) operation.index = index;
    if (arguments.length >= 2) operation.values = values;
    if (arguments.length >= 3) operation.alwaysInsert = alwaysInsert;
    this.context._queue.push(operation);
    return row;
  };

  TableRowCollection.prototype.deleteRows = function (rows) {
    if (!Array.isArray(rows)) throw invalidArgument("deleteRows requires an array");
    var encoded = rows.map(function (row) {
      if (row instanceof Excel.TableRow) {
        if (row.context !== this.context) throw invalidArgument("Object belongs to a different request context");
        var key = row._key;
        if ((key === null || key === undefined) && row._loaded.index) key = row._index;
        integerArgument(key, "TableRowCollection.deleteRows row", false);
        return key;
      }
      integerArgument(row, "TableRowCollection.deleteRows row", false);
      return row;
    }, this);
    this.context._queue.push({
      op: "tableRowDeleteMany",
      tableId: this._table._id,
      rows: encoded,
    });
  };

  TableRowCollection.prototype.deleteRowsAt = function (index, count) {
    integerArgument(index, "TableRowCollection.deleteRowsAt index", false);
    if (count !== undefined && count !== null) {
      integerArgument(count, "TableRowCollection.deleteRowsAt count", false);
    }
    this.context._queue.push({
      op: "tableRowDeleteAt",
      tableId: this._table._id,
      index: index,
      count: count === undefined || count === null ? 1 : count,
    });
  };

  function TableRow(context, table, index, bind) {
    ClientObject.call(this, context);
    this._table = table;
    this._tableId = table._id;
    this._key = index;
    this._scalarProperties = ["index", "values"];
    if (bind) queueChildBinding(this, table, "row", index);
  }
  TableRow.prototype = Object.create(ClientObject.prototype);
  TableRow.prototype.constructor = TableRow;

  Object.defineProperty(TableRow.prototype, "index", {
    get: function () {
      if (!this._loaded.index) throw propertyNotLoaded("index");
      return this._index;
    },
  });

  ["values"].forEach(function (name) {
    Object.defineProperty(TableRow.prototype, name, {
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
    });
  });

  TableRow.prototype.set = function (source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var isClientObject = source instanceof ClientObject;
    if (isClientObject && source.context !== this.context) {
      throw invalidRequestContext();
    }
    if (isClientObject && Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
      throw invalidArgument("The object passed to set must have the same type.");
    }
    if (!isClientObject && Object.prototype.hasOwnProperty.call(source, "index") &&
        (!options || options.throwOnReadOnly !== false)) {
      throw invalidArgument("The property 'index' is read-only.");
    }
    if (isClientObject) {
      if (source._loaded.values) this.values = source.values;
    } else if (Object.prototype.hasOwnProperty.call(source, "values")) {
      this.values = source.values;
    }
  };

  TableRow.prototype.delete = function () {
    this.context._queue.push({ op: "tableRowDelete", id: this._id });
  };

  TableRow.prototype.getRange = function () {
    return queueRowRange(this);
  };

  TableRow.prototype.toJSON = function () {
    return toJSONScalars(this);
  };

  function installTableNavigation() {
    if (!Excel.Table) return;
    Excel.Table.prototype._navigationProperties = ["rows", "columns"];
    Object.defineProperty(Excel.Table.prototype, "columns", {
      configurable: true,
      get: function () {
        if (!this._columns) this._columns = new TableColumnCollection(this.context, this);
        return this._columns;
      },
    });
    Object.defineProperty(Excel.Table.prototype, "rows", {
      configurable: true,
      get: function () {
        if (!this._rows) this._rows = new TableRowCollection(this.context, this);
        return this._rows;
      },
    });

    var oldToJSON = Excel.Table.prototype.toJSON;
    Excel.Table.prototype.toJSON = function () {
      var result = oldToJSON.call(this);
      if (this._columns && this._columns._loaded.items) {
        result.columns = this._columns.items.map(function (item) { return item.toJSON(); });
      }
      if (this._rows && this._rows._loaded.items) {
        result.rows = this._rows.items.map(function (item) { return item.toJSON(); });
      }
      return result;
    };
  }

  installTableNavigation();

  Excel.TableColumnCollection = TableColumnCollection;
  Excel.TableColumn = TableColumn;
  Excel.TableRowCollection = TableRowCollection;
  Excel.TableRow = TableRow;
})(globalThis);
