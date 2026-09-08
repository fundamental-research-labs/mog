(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var hooks = global.__mogOfficeJs || {};

  function error(code, message) {
    var value = new OfficeExtension.Error({
      code: code,
      message: message,
    });
    value.name = "RichApi.Error";
    value.code = code;
    return value;
  }

  function propertyNotLoaded(name) {
    return error(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function invalid(message) {
    return error("InvalidArgument", message);
  }

  function unsupported(message) {
    return error("ApiNotFound", message);
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isPlainObject(value) {
    if (!isObject(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function requirePlainObject(value, property) {
    if (!isPlainObject(value)) throw invalid(property + " must be an object");
    return value;
  }

  function requireString(value, property) {
    if (typeof value !== "string") throw invalid(property + " must be a string");
    return value;
  }

  function requireFiniteNumber(value, property) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw invalid(property + " must be a finite number");
    }
    return value;
  }

  function requireNonNegativeNumber(value, property) {
    value = requireFiniteNumber(value, property);
    if (value < 0) throw invalid(property + " must be non-negative");
    return value;
  }

  function requireInteger(value, property) {
    value = requireFiniteNumber(value, property);
    if (Math.floor(value) !== value) throw invalid(property + " must be an integer");
    return value;
  }

  function assertSameContext(object, context) {
    if (object && object.context !== context) {
      throw error(
        "InvalidRequestContext",
        "The object belongs to a different request context."
      );
    }
  }

  function addReadOnlyScalar(prototype, name) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  }

  function TableSort(context, table) {
    ClientObject.call(this, context);
    this._table = table;
    this._tableId = table._id;
    this._scalarProperties = ["fields", "matchCase", "method"];
    this._lastSort = null;
    this._bindingQueued = false;
  }
  TableSort.prototype = Object.create(ClientObject.prototype);
  TableSort.prototype.constructor = TableSort;

  ["fields", "matchCase", "method"].forEach(function (name) {
    addReadOnlyScalar(TableSort.prototype, name);
  });

  TableSort.prototype._ensureBinding = function () {
    if (this._bindingQueued) return;
    this.context._queue.push({
      op: "getTableSort",
      id: this._id,
      tableId: this._tableId,
    });
    this._bindingQueued = true;
  };

  TableSort.prototype.apply = function (fields, matchCase, method) {
    if (!Array.isArray(fields)) {
      throw invalid("Table.sort.apply requires an array of SortField objects");
    }
    if (matchCase !== undefined && typeof matchCase !== "boolean") {
      throw invalid("Table.sort.apply matchCase must be a boolean");
    }
    if (method !== undefined && typeof method !== "string") {
      throw invalid("Table.sort.apply method must be a string");
    }
    var descriptor = {
      fields: fields.slice(),
      matchCase: matchCase === undefined ? false : matchCase,
      method: method === undefined ? "PinYin" : method,
    };
    this._lastSort = descriptor;
    this.context._queue.push({
      op: "tableSortApply",
      id: this._id,
      tableId: this._tableId,
      fields: descriptor.fields,
      matchCase: matchCase,
      method: method,
    });
  };

  TableSort.prototype.clear = function () {
    this._lastSort = null;
    this.context._queue.push({
      op: "tableSortClear",
      id: this._id,
      tableId: this._tableId,
    });
  };

  TableSort.prototype.reapply = function () {
    var op = {
      op: "tableSortReapply",
      id: this._id,
      tableId: this._tableId,
    };
    // Including the request-context descriptor makes reapply deterministic
    // for a proxy whose first apply and reapply share a batch. The host's
    // bound descriptor wins when it has one, so fresh proxies still use the
    // durable/imported projection.
    if (this._lastSort) {
      op.fields = this._lastSort.fields;
      op.matchCase = this._lastSort.matchCase;
      op.method = this._lastSort.method;
    }
    this.context._queue.push(op);
  };

  TableSort.prototype.load = function (props) {
    this._ensureBinding();
    return ClientObject.prototype.load.call(this, props);
  };

  TableSort.prototype.toJSON = function () {
    var result = {};
    if (this._loaded.fields) result.fields = this._fields;
    if (this._loaded.matchCase) result.matchCase = this._matchCase;
    if (this._loaded.method) result.method = this._method;
    return result;
  };

  function Filter(context, column) {
    ClientObject.call(this, context);
    this._column = column;
    this._table = column._table;
    this._columnId = column._id;
    this._scalarProperties = ["criteria"];
    this._bindingQueued = false;
  }
  Filter.prototype = Object.create(ClientObject.prototype);
  Filter.prototype.constructor = Filter;

  addReadOnlyScalar(Filter.prototype, "criteria");

  Filter.prototype._ensureBinding = function () {
    if (this._bindingQueued) return;
    this.context._queue.push({
      op: "getTableColumnFilter",
      id: this._id,
      columnId: this._columnId,
    });
    this._bindingQueued = true;
  };

  Filter.prototype.apply = function (criteria) {
    requirePlainObject(criteria, "Filter.apply criteria");
    this.context._queue.push({
      op: "tableFilterApply",
      id: this._id,
      columnId: this._columnId,
      criteria: criteria,
    });
  };

  Filter.prototype.applyBottomItemsFilter = function (count) {
    count = requireInteger(count, "Filter.applyBottomItemsFilter count");
    if (count < 0) throw invalid("Filter.applyBottomItemsFilter count must be non-negative");
    this._queueTopBottom("BottomItems", count);
  };

  Filter.prototype.applyBottomPercentFilter = function (percent) {
    percent = requireNonNegativeNumber(percent, "Filter.applyBottomPercentFilter percent");
    if (percent > 100) throw invalid("Filter.applyBottomPercentFilter percent must be at most 100");
    this._queueTopBottom("BottomPercent", percent);
  };

  Filter.prototype.applyCellColorFilter = function (color) {
    this._queueColor("CellColor", color);
  };

  Filter.prototype.applyCustomFilter = function (criteria1, criteria2, oper) {
    requireString(criteria1, "Filter.applyCustomFilter criteria1");
    if (criteria2 !== undefined && typeof criteria2 !== "string") {
      throw invalid("Filter.applyCustomFilter criteria2 must be a string");
    }
    if (oper !== undefined && oper !== "And" && oper !== "Or") {
      throw invalid("Filter.applyCustomFilter oper must be 'And' or 'Or'");
    }
    var criteria = {
      filterOn: "Custom",
      criterion1: criteria1,
    };
    if (criteria2 !== undefined) criteria.criterion2 = criteria2;
    if (oper !== undefined) criteria.operator = oper;
    this._queueCriteria(criteria);
  };

  Filter.prototype.applyDynamicFilter = function (criteria) {
    requireString(criteria, "Filter.applyDynamicFilter criteria");
    this._queueCriteria({
      filterOn: "Dynamic",
      dynamicCriteria: criteria,
    });
  };

  Filter.prototype.applyFontColorFilter = function (color) {
    this._queueColor("FontColor", color);
  };

  Filter.prototype.applyIconFilter = function (icon) {
    requirePlainObject(icon, "Filter.applyIconFilter icon");
    if (typeof icon.set !== "string" || icon.set.length === 0) {
      throw invalid("Filter.applyIconFilter icon.set must be a non-empty string");
    }
    requireInteger(icon.index, "Filter.applyIconFilter icon.index");
    if (icon.index < 0) throw invalid("Filter.applyIconFilter icon.index must be non-negative");
    this._queueCriteria({
      filterOn: "Icon",
      icon: { set: icon.set, index: icon.index },
    });
  };

  Filter.prototype.applyTopItemsFilter = function (count) {
    count = requireInteger(count, "Filter.applyTopItemsFilter count");
    if (count < 0) throw invalid("Filter.applyTopItemsFilter count must be non-negative");
    this._queueTopBottom("TopItems", count);
  };

  Filter.prototype.applyTopPercentFilter = function (percent) {
    percent = requireNonNegativeNumber(percent, "Filter.applyTopPercentFilter percent");
    if (percent > 100) throw invalid("Filter.applyTopPercentFilter percent must be at most 100");
    this._queueTopBottom("TopPercent", percent);
  };

  Filter.prototype.applyValuesFilter = function (values) {
    if (!Array.isArray(values)) {
      throw invalid("Filter.applyValuesFilter values must be an array");
    }
    this._queueCriteria({
      filterOn: "Values",
      values: values.slice(),
    });
  };

  Filter.prototype.clear = function () {
    this.context._queue.push({
      op: "tableFilterClear",
      id: this._id,
      columnId: this._columnId,
    });
  };

  Filter.prototype._queueCriteria = function (criteria) {
    this.context._queue.push({
      op: "tableFilterApply",
      id: this._id,
      columnId: this._columnId,
      criteria: criteria,
    });
  };

  Filter.prototype._queueTopBottom = function (filterOn, count) {
    this._queueCriteria({
      filterOn: filterOn,
      criterion1: String(count),
    });
  };

  Filter.prototype._queueColor = function (filterOn, color) {
    requireString(color, "Filter color");
    if (color.length === 0) throw invalid("Filter color must not be empty");
    this._queueCriteria({
      filterOn: filterOn,
      color: color,
    });
  };

  Filter.prototype.load = function (props) {
    this._ensureBinding();
    return ClientObject.prototype.load.call(this, props);
  };

  Filter.prototype.toJSON = function () {
    return this._loaded.criteria ? { criteria: this._criteria } : {};
  };

  if (hooks.addNavigationProperties) {
    if (Excel.Table) {
      hooks.addNavigationProperties(Excel.Table.prototype, ["sort"]);
    }
    if (Excel.TableColumn) {
      hooks.addNavigationProperties(Excel.TableColumn.prototype, ["filter"]);
    }
  }

  if (Excel.Table) {
    Object.defineProperty(Excel.Table.prototype, "sort", {
      configurable: true,
      get: function () {
        if (!this._sort) this._sort = new TableSort(this.context, this);
        this._sort._ensureBinding();
        return this._sort;
      },
    });
  }

  if (Excel.TableColumn) {
    Object.defineProperty(Excel.TableColumn.prototype, "filter", {
      configurable: true,
      get: function () {
        if (!this._filter) this._filter = new Filter(this.context, this);
        this._filter._ensureBinding();
        return this._filter;
      },
    });
  }

  Excel.TableSort = TableSort;
  Excel.Filter = Filter;
})(globalThis);
