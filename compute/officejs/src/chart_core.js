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

  function apiNotFound(message) {
    var error = new OfficeExtension.Error({
      code: "ApiNotFound",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "ApiNotFound";
    return error;
  }

  function integerArgument(value, property) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalidArgument(property + " must be an integer");
    }
    return value;
  }

  function stringArgument(value, property) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidArgument(property + " must be a non-empty string");
    }
    return value;
  }

  function enumArgument(value, property) {
    if (value !== undefined && value !== "Auto" && value !== "Rows" && value !== "Columns") {
      throw invalidArgument(property + " must be Auto, Rows, or Columns");
    }
    return value;
  }

  function newClientResult(context) {
    return officeJs.createClientResult(context);
  }

  function collectionItemsToJSON(collection) {
    return (collection._items || []).map(function (item) {
      return item && typeof item.toJSON === "function" ? item.toJSON() : item;
    });
  }

  function navigationProperties(object) {
    var names = (object._navigationProperties || []).slice();
    (object._additionalNavigationProperties || []).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function rangeArgument(value, context, property, optional) {
    if (value === undefined || value === null) {
      if (optional) return null;
      throw invalidArgument(property + " requires a Range or range address");
    }
    if (value instanceof Excel.Range) {
      if (value.context !== context) throw invalidRequestContext();
      return { rangeId: value._id };
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return { address: value };
    }
    throw invalidArgument(property + " requires a Range or range address");
  }

  function ChartCollection(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._scalarProperties = ["items", "count"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);

    context._queue.push({
      op: "getChartCollection",
      id: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    });

    officeJs.configureCollection(this, function (key) {
      return this.getItem(String(key));
    });
  }
  ChartCollection.prototype = Object.create(ClientObject.prototype);
  ChartCollection.prototype.constructor = ChartCollection;

  Object.defineProperty(ChartCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  Object.defineProperty(ChartCollection.prototype, "count", {
    get: function () {
      if (!this._loaded.count) throw propertyNotLoaded("count");
      return this._count;
    },
    configurable: true,
  });

  ChartCollection.prototype.add = function (type, sourceData, seriesBy) {
    type = stringArgument(type, "ChartCollection.add type");
    if (!(sourceData instanceof Excel.Range)) {
      throw invalidArgument("ChartCollection.add sourceData must be a Range");
    }
    if (sourceData.context !== this.context) throw invalidRequestContext();
    enumArgument(seriesBy, "ChartCollection.add seriesBy");

    var chart = new Chart(this.context, this._worksheet, this);
    this.context._queue.push({
      op: "chartAdd",
      id: chart._id,
      collectionId: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
      type: type,
      rangeId: sourceData._id,
      seriesBy: seriesBy === undefined ? null : seriesBy,
    });
    return chart;
  };

  ChartCollection.prototype.getItem = function (name) {
    name = stringArgument(name, "ChartCollection.getItem name");
    var cacheKey = "name:" + name.toLowerCase();
    var chart = this._itemCache[cacheKey];
    if (!chart) {
      chart = new Chart(this.context, this._worksheet, this);
      this._itemCache[cacheKey] = chart;
      this.context._queue.push({
        op: "chartGetItem",
        id: chart._id,
        collectionId: this._id,
        worksheetId: this._worksheet ? this._worksheet._id : null,
        name: name,
        orNullObject: false,
      });
    }
    return chart;
  };

  ChartCollection.prototype.getItemAt = function (index) {
    index = integerArgument(index, "ChartCollection.getItemAt index");
    var cacheKey = "index:" + index;
    var chart = this._itemCache[cacheKey];
    if (!chart) {
      chart = new Chart(this.context, this._worksheet, this);
      this._itemCache[cacheKey] = chart;
      this.context._queue.push({
        op: "chartGetItemAt",
        id: chart._id,
        collectionId: this._id,
        worksheetId: this._worksheet ? this._worksheet._id : null,
        index: index,
      });
    }
    return chart;
  };

  ChartCollection.prototype.getItemOrNullObject = function (name) {
    name = stringArgument(name, "ChartCollection.getItemOrNullObject name");
    var cacheKey = "null:" + name.toLowerCase();
    var chart = this._itemCache[cacheKey];
    if (!chart) {
      chart = new Chart(this.context, this._worksheet, this);
      this._itemCache[cacheKey] = chart;
      this.context._queue.push({
        op: "chartGetItem",
        id: chart._id,
        collectionId: this._id,
        worksheetId: this._worksheet ? this._worksheet._id : null,
        name: name,
        orNullObject: true,
      });
    }
    return chart;
  };

  ChartCollection.prototype.getCount = function () {
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "chartCollectionGetCount",
      collectionId: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
      resultId: result._id,
    });
    return result;
  };

  ChartCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return { items: collectionItemsToJSON(this) };
  };

  function Chart(context, worksheet, collection) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._collection = collection || null;
    this._scalarProperties = ["id", "name", "chartType", "height", "left", "top", "width"];
    this._navigationProperties = [];
  }
  Chart.prototype = Object.create(ClientObject.prototype);
  Chart.prototype.constructor = Chart;

  // Child chart adapters use this internal value when constructing their
  // operation payloads.  Before the first sync the proxy ID is the only
  // available identity; after an id load, the persisted engine ID is used.
  // Keeping the proxy fallback lets child navigation be requested in the
  // same batch as chart creation without conflating the two IDs in the host.
  Object.defineProperty(Chart.prototype, "_chartId", {
    get: function () {
      return this._idValue || this._id;
    },
    configurable: true,
  });

  Object.defineProperty(Chart.prototype, "id", {
    get: function () {
      if (!this._loaded.id) throw propertyNotLoaded("id");
      return this._idValue;
    },
    configurable: true,
  });

  ["name", "chartType", "height", "left", "top", "width"].forEach(function (name) {
    Object.defineProperty(Chart.prototype, name, {
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

  Chart.prototype.set = function (source, options) {
    requirePropertyObject(source);
    var isClientObject = source instanceof ClientObject;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      source = source.toJSON();
    }

    ["name", "chartType", "height", "left", "top", "width"].forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined) {
        this[name] = source[name];
      }
    }, this);

    var navigation = navigationProperties(this);
    navigation.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(source, name) || source[name] === undefined) {
        return;
      }
      var child = isClientObject ? source[name] : source[name];
      this[name].set(child, options);
    }, this);
  };

  Chart.prototype.activate = function () {
    throw apiNotFound("Chart.activate is not supported by this host.");
  };

  Chart.prototype.delete = function () {
    this.context._queue.push({
      op: "chartDelete",
      id: this._id,
      chartId: this._chartId,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    });
  };

  Chart.prototype.setData = function (sourceData, seriesBy) {
    if (!(sourceData instanceof Excel.Range)) {
      throw invalidArgument("Chart.setData sourceData must be a Range");
    }
    if (sourceData.context !== this.context) throw invalidRequestContext();
    enumArgument(seriesBy, "Chart.setData seriesBy");
    this.context._queue.push({
      op: "chartSetData",
      id: this._id,
      chartId: this._chartId,
      worksheetId: this._worksheet ? this._worksheet._id : null,
      rangeId: sourceData._id,
      seriesBy: seriesBy === undefined ? null : seriesBy,
    });
  };

  Chart.prototype.setPosition = function (startCell, endCell) {
    var start = rangeArgument(startCell, this.context, "Chart.setPosition startCell", false);
    var end = rangeArgument(endCell, this.context, "Chart.setPosition endCell", true);
    var operation = {
      op: "chartSetPosition",
      id: this._id,
      chartId: this._chartId,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    };
    if (start.rangeId !== undefined) operation.startRangeId = start.rangeId;
    else operation.startAddress = start.address;
    if (end) {
      if (end.rangeId !== undefined) operation.endRangeId = end.rangeId;
      else operation.endAddress = end.address;
    }
    this.context._queue.push(operation);
  };

  Chart.prototype.toJSON = function () {
    var data = {};
    (this._scalarProperties || []).forEach(function (name) {
      if (!this._loaded[name]) return;
      data[name] = name === "id" ? this._idValue : this["_" + name];
    }, this);

    navigationProperties(this).forEach(function (name) {
      var child = this["_" + name];
      if (child && typeof child.toJSON === "function") data[name] = child.toJSON();
    }, this);
    return data;
  };

  Object.defineProperty(Excel.Worksheet.prototype, "charts", {
    get: function () {
      if (!this._charts) this._charts = new ChartCollection(this.context, this);
      return this._charts;
    },
    configurable: true,
  });

  Excel.ChartCollection = ChartCollection;
  Excel.Chart = Chart;
})(globalThis);
