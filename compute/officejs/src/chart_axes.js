(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function propertyNotLoaded(name) {
    return new OfficeExtension.Error({
      code: "PropertyNotLoaded",
      message:
        "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context.",
    });
  }

  function invalidArgument(message) {
    return new OfficeExtension.Error({ code: "InvalidArgument", message: message });
  }

  function invalidRequestContext() {
    return new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function navigationProperties(object) {
    var names = (object._navigationProperties || []).slice();
    (object._additionalNavigationProperties || []).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function chartId(chart) {
    return chart._chartKey || chart._chartId || chart._idValue || null;
  }

  function chartNameHint(chart) {
    if (typeof chart._name === "string" && chart._name.length) return chart._name;
    var cache = chart._collection && chart._collection._itemCache;
    if (!cache) return null;
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      if (cache[keys[i]] !== chart) continue;
      var separator = keys[i].indexOf(":");
      if (separator >= 0 && ["name", "null"].indexOf(keys[i].slice(0, separator)) >= 0) {
        return keys[i].slice(separator + 1);
      }
    }
    return null;
  }

  function chartIndexHint(chart) {
    var cache = chart._collection && chart._collection._itemCache;
    if (!cache) return null;
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      if (cache[keys[i]] !== chart || keys[i].slice(0, 6) !== "index:") continue;
      var index = Number(keys[i].slice(6));
      if (isFinite(index)) return index;
    }
    return null;
  }

  function chartWorksheetId(chart) {
    return chart._worksheet ? chart._worksheet._id : chart._worksheetId || null;
  }

  function axisOperation(object, op) {
    var operation = {
      op: op,
      id: object._id,
      chartId: object._chartId,
      chartName: object._chartName,
      chartIndex: object._chartIndex,
      chartProxyId: object._chart ? object._chart._id : null,
      parentId: object._chart ? object._chart._id : null,
      worksheetId: object._worksheetId,
    };
    if (object._axisType) operation.axisType = object._axisType;
    if (object._axisGroup) operation.axisGroup = object._axisGroup;
    return operation;
  }

  function queueAxisBinding(object) {
    object.context._queue.push(axisOperation(object, "chartAxisGet"));
  }

  function queueTitleBinding(object) {
    object.context._queue.push(axisOperation(object, "chartAxisTitleGet"));
  }

  function defineLoadedScalar(prototype, name) {
    Object.defineProperty(prototype, name, {
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
  }

  function ClientSet(source, object, names) {
    requirePropertyObject(source);
    if (source instanceof ClientObject) {
      if (Object.getPrototypeOf(source) !== Object.getPrototypeOf(object)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      names.forEach(function (name) {
        if (source._loaded[name]) object[name] = source[name];
      });
      return;
    }
    names.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined) {
        object[name] = source[name];
      }
    });
  }

  function ChartAxes(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._chartId = chartId(chart);
    this._chartName = chartNameHint(chart);
    this._chartIndex = chartIndexHint(chart);
    this._worksheetId = chartWorksheetId(chart);
    this._navigationProperties = ["categoryAxis", "seriesAxis", "valueAxis"];
    this._axisCache = Object.create(null);
    context._queue.push({
      op: "chartAxesGet",
      id: this._id,
      chartId: this._chartId,
      chartName: this._chartName,
      chartIndex: this._chartIndex,
      chartProxyId: chart._id,
      parentId: chart._id,
      worksheetId: this._worksheetId,
    });
  }
  ChartAxes.prototype = Object.create(ClientObject.prototype);
  ChartAxes.prototype.constructor = ChartAxes;

  function axisCacheKey(type, group) {
    return String(group || "Primary") + ":" + type;
  }

  ChartAxes.prototype._getAxis = function (type, group) {
    var key = axisCacheKey(type, group);
    var axis = this._axisCache[key];
    if (!axis) {
      axis = new ChartAxis(this.context, this, type, group);
      this._axisCache[key] = axis;
    }
    return axis;
  };

  [
    ["categoryAxis", "Category"],
    ["seriesAxis", "Series"],
    ["valueAxis", "Value"],
  ].forEach(function (entry) {
    Object.defineProperty(ChartAxes.prototype, entry[0], {
      get: function () {
        return this._getAxis(entry[1], "Primary");
      },
      configurable: true,
    });
  });

  ChartAxes.prototype.getItem = function (type, group) {
    type = type == null ? type : String(type);
    group = group == null ? "Primary" : String(group);
    if (["Category", "Value", "Series"].indexOf(type) < 0) {
      throw invalidArgument("ChartAxes.getItem type must be Category, Value, or Series");
    }
    if (["Primary", "Secondary"].indexOf(group) < 0) {
      throw invalidArgument("ChartAxes.getItem group must be Primary or Secondary");
    }
    if (type === "Series" && group === "Secondary") {
      throw invalidArgument("ChartAxes.getItem does not support a secondary series axis");
    }
    return this._getAxis(type, group);
  };

  ChartAxes.prototype.set = function (source) {
    requirePropertyObject(source);
    if (source instanceof ClientObject) {
      if (Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      source = source.toJSON();
    }
    ["categoryAxis", "seriesAxis", "valueAxis"].forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(source, name) || source[name] === undefined) {
        return;
      }
      this[name].set(source[name]);
    }, this);
  };

  ChartAxes.prototype.toJSON = function () {
    var data = {};
    ["categoryAxis", "seriesAxis", "valueAxis"].forEach(function (name) {
      var type = name === "categoryAxis" ? "Category" : name === "valueAxis" ? "Value" : "Series";
      var axis = this._axisCache[axisCacheKey(type, "Primary")];
      if (axis && typeof axis.toJSON === "function") data[name] = axis.toJSON();
    }, this);
    return data;
  };

  function ChartAxis(context, axes, type, group) {
    ClientObject.call(this, context);
    this._axes = axes;
    this._chart = axes._chart;
    this._chartId = axes._chartId;
    this._chartName = axes._chartName;
    this._chartIndex = axes._chartIndex;
    this._worksheetId = axes._worksheetId;
    this._axisType = type;
    this._axisGroup = group || "Primary";
    this._navigationProperties = ["title"];
    this._scalarProperties = [
      "alignment",
      "axisGroup",
      "baseTimeUnit",
      "categoryType",
      "customDisplayUnit",
      "displayUnit",
      "isBetweenCategories",
      "linkNumberFormat",
      "logBase",
      "majorTickMark",
      "majorTimeUnitScale",
      "majorUnit",
      "maximum",
      "minimum",
      "minorTickMark",
      "minorTimeUnitScale",
      "minorUnit",
      "multiLevel",
      "numberFormat",
      "offset",
      "position",
      "positionAt",
      "reversePlotOrder",
      "scaleType",
      "showDisplayUnitLabel",
      "textOrientation",
      "tickLabelPosition",
      "tickLabelSpacing",
      "tickMarkSpacing",
      "type",
      "visible",
    ];
    queueAxisBinding(this);
  }
  ChartAxis.prototype = Object.create(ClientObject.prototype);
  ChartAxis.prototype.constructor = ChartAxis;

  ChartAxis.prototype._queueAxisOperation = function (op) {
    this.context._queue.push(axisOperation(this, op));
  };

  Object.defineProperty(ChartAxis.prototype, "title", {
    get: function () {
      if (!this._title) {
        this._title = new ChartAxisTitle(this.context, this);
      }
      return this._title;
    },
    configurable: true,
  });

  [
    "alignment",
    "baseTimeUnit",
    "categoryType",
    "displayUnit",
    "isBetweenCategories",
    "linkNumberFormat",
    "logBase",
    "majorTickMark",
    "majorTimeUnitScale",
    "majorUnit",
    "maximum",
    "minimum",
    "minorTickMark",
    "minorTimeUnitScale",
    "minorUnit",
    "multiLevel",
    "numberFormat",
    "offset",
    "position",
    "reversePlotOrder",
    "scaleType",
    "showDisplayUnitLabel",
    "textOrientation",
    "tickLabelPosition",
    "tickLabelSpacing",
    "tickMarkSpacing",
    "visible",
  ].forEach(function (name) {
    defineLoadedScalar(ChartAxis.prototype, name);
  });

  ["axisGroup", "customDisplayUnit", "positionAt", "type"].forEach(function (name) {
    Object.defineProperty(ChartAxis.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  });

  ChartAxis.prototype.set = function (source) {
    requirePropertyObject(source);
    var names = [
      "alignment",
      "baseTimeUnit",
      "categoryType",
      "displayUnit",
      "isBetweenCategories",
      "linkNumberFormat",
      "logBase",
      "majorTickMark",
      "majorTimeUnitScale",
      "majorUnit",
      "maximum",
      "minimum",
      "minorTickMark",
      "minorTimeUnitScale",
      "minorUnit",
      "multiLevel",
      "numberFormat",
      "offset",
      "position",
      "reversePlotOrder",
      "scaleType",
      "showDisplayUnitLabel",
      "textOrientation",
      "tickLabelPosition",
      "tickLabelSpacing",
      "tickMarkSpacing",
      "visible",
    ];
    ClientSet(source, this, names);
    if (source instanceof ClientObject) {
      if (source._title) this.title.set(source._title);
    } else if (Object.prototype.hasOwnProperty.call(source, "title") && source.title !== undefined) {
      this.title.set(source.title);
    }
  };

  ChartAxis.prototype.setCategoryNames = function (sourceData) {
    if (!(sourceData instanceof Excel.Range)) {
      throw invalidArgument("ChartAxis.setCategoryNames requires a Range");
    }
    if (sourceData.context !== this.context) throw invalidRequestContext();
    var operation = axisOperation(this, "chartAxisSetCategoryNames");
    operation.rangeId = sourceData._id;
    this.context._queue.push(operation);
  };

  ChartAxis.prototype.setCustomDisplayUnit = function (value) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw invalidArgument("ChartAxis.setCustomDisplayUnit value must be a number");
    }
    var operation = axisOperation(this, "chartAxisSetCustomDisplayUnit");
    operation.value = value;
    this.context._queue.push(operation);
  };

  ChartAxis.prototype.setPositionAt = function (value) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw invalidArgument("ChartAxis.setPositionAt value must be a number");
    }
    var operation = axisOperation(this, "chartAxisSetPositionAt");
    operation.value = value;
    this.context._queue.push(operation);
  };

  ChartAxis.prototype.toJSON = function () {
    var data = {};
    (this._scalarProperties || []).forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    if (this._title) data.title = this._title.toJSON();
    return data;
  };

  function ChartAxisTitle(context, axis) {
    ClientObject.call(this, context);
    this._axis = axis;
    this._chart = axis._chart;
    this._chartId = axis._chartId;
    this._chartName = axis._chartName;
    this._chartIndex = axis._chartIndex;
    this._worksheetId = axis._worksheetId;
    this._axisType = axis._axisType;
    this._axisGroup = axis._axisGroup;
    this._scalarProperties = ["text", "textOrientation", "visible"];
    queueTitleBinding(this);
  }
  ChartAxisTitle.prototype = Object.create(ClientObject.prototype);
  ChartAxisTitle.prototype.constructor = ChartAxisTitle;

  ["text", "textOrientation", "visible"].forEach(function (name) {
    defineLoadedScalar(ChartAxisTitle.prototype, name);
  });

  ChartAxisTitle.prototype.set = function (source) {
    ClientSet(source, this, ["text", "textOrientation", "visible"]);
  };

  ChartAxisTitle.prototype.setFormula = function () {
    throw new OfficeExtension.Error({
      code: "ApiNotFound",
      message: "ChartAxisTitle.setFormula is not supported by this host.",
    });
  };

  ChartAxisTitle.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  if (Excel.Chart && Object.prototype.hasOwnProperty.call(Excel.Chart.prototype, "axes") === false) {
    Object.defineProperty(Excel.Chart.prototype, "axes", {
      get: function () {
        if (!this._axes) this._axes = new ChartAxes(this.context, this);
        return this._axes;
      },
      configurable: true,
    });
    if (officeJs && typeof officeJs.addNavigationProperties === "function") {
      officeJs.addNavigationProperties(Excel.Chart.prototype, ["axes"]);
    }
  }

  Excel.ChartAxes = ChartAxes;
  Excel.ChartAxis = ChartAxis;
  Excel.ChartAxisTitle = ChartAxisTitle;
})(globalThis);
