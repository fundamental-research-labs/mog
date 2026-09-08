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

  function invalidRequestContext() {
    return new OfficeExtension.Error({
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

  function newClientResult(context) {
    if (officeJs && typeof officeJs.createClientResult === "function") {
      return officeJs.createClientResult(context);
    }
    return new OfficeExtension.ClientResult(context);
  }

  function queueSeriesBinding(series, collection, index) {
    series._collection = collection;
    series._collectionId = collection._id;
    series._index = index;
    series.context._queue.push({
      op: "chartSeriesCollectionGetItem",
      id: series._id,
      collectionId: collection._id,
      chartId: collection._chart._id,
      index: index,
    });
  }

  function requireRange(source, context, property) {
    if (!(source instanceof Excel.Range)) {
      throw invalidArgument(property + " requires a Range");
    }
    if (source.context !== context) throw invalidRequestContext();
    return source;
  }

  function ChartSeriesCollection(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._worksheet = chart._worksheet || chart._sheet || null;
    this._scalarProperties = ["items", "count"];
    this._navigationProperties = ["items"];
    this._itemCache = Object.create(null);
    this._bindingQueued = false;

    context._queue.push({
      op: "getChartSeriesCollection",
      id: this._id,
      chartId: chart._id,
      worksheetId: this._worksheet ? this._worksheet._id : undefined,
    });

    var hooks = global.__mogOfficeJs;
    if (hooks && typeof hooks.configureCollection === "function") {
      hooks.configureCollection(this, function (key) {
        return this.getItemAt(Number(key));
      });
    } else {
      this._hydrateItems = function (descriptors) {
        if (!Array.isArray(descriptors)) {
          throw new OfficeExtension.Error({
            code: "GeneralException",
            message: "The host returned an invalid chart series collection result.",
          });
        }
        return descriptors.map(function (descriptor, index) {
          var key = descriptor && descriptor.key !== undefined ? descriptor.key : index;
          var item = this.getItemAt(Number(key));
          seedLoaded(item, descriptor && descriptor.properties);
          return item;
        }, this);
      };
    }
  }
  ChartSeriesCollection.prototype = Object.create(ClientObject.prototype);
  ChartSeriesCollection.prototype.constructor = ChartSeriesCollection;

  Object.defineProperty(ChartSeriesCollection.prototype, "items", {
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
    configurable: true,
  });

  Object.defineProperty(ChartSeriesCollection.prototype, "count", {
    get: function () {
      if (!this._loaded.count) throw propertyNotLoaded("count");
      return this._count;
    },
    configurable: true,
  });

  ChartSeriesCollection.prototype._getItem = function (index) {
    integerArgument(index, "ChartSeriesCollection.getItemAt index", false);
    var key = String(index);
    var item = this._itemCache[key];
    if (!item) {
      item = new ChartSeries(this.context, this, index, false);
      queueSeriesBinding(item, this, index);
      this._itemCache[key] = item;
    }
    return item;
  };

  ChartSeriesCollection.prototype.getItemAt = function (index) {
    return this._getItem(index);
  };

  ChartSeriesCollection.prototype.add = function (name, index) {
    if (name !== undefined && name !== null && typeof name !== "string") {
      throw invalidArgument("ChartSeriesCollection.add name must be a string");
    }
    integerArgument(index, "ChartSeriesCollection.add index", true);
    var series = new ChartSeries(this.context, this, index, false);
    var operation = {
      op: "chartSeriesCollectionAdd",
      id: series._id,
      collectionId: this._id,
      chartId: this._chart._id,
    };
    if (name !== undefined && name !== null) operation.name = name;
    if (index !== undefined && index !== null) operation.index = index;
    this.context._queue.push(operation);
    return series;
  };

  ChartSeriesCollection.prototype.getCount = function () {
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "chartSeriesCollectionGetCount",
      collectionId: this._id,
      chartId: this._chart._id,
      resultId: result._id,
    });
    return result;
  };

  ChartSeriesCollection.prototype.load = function (props) {
    var defaults = ["items", "count"];
    var itemProperties = [
      "name", "axisGroup", "chartType", "filtered", "smooth", "plotOrder",
    ];
    var paths = normalizeLoad(props, defaults).map(function (path) {
      if (path === "items" || path === "count" || path.indexOf("items/") === 0) return path;
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

  ChartSeriesCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: this.items.map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  function ChartSeries(context, collection, index, bind) {
    ClientObject.call(this, context);
    this._collection = collection;
    this._collectionId = collection._id;
    this._chart = collection._chart;
    this._worksheet = collection._worksheet;
    this._index = index === undefined || index === null ? null : index;
    this._scalarProperties = [
      "axisGroup", "chartType", "filtered", "name", "plotOrder", "smooth",
    ];
    if (bind) queueSeriesBinding(this, collection, index);
  }
  ChartSeries.prototype = Object.create(ClientObject.prototype);
  ChartSeries.prototype.constructor = ChartSeries;

  ["axisGroup", "chartType", "filtered", "name", "plotOrder", "smooth"].forEach(function (name) {
    Object.defineProperty(ChartSeries.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        if (name === "axisGroup" && value !== "Primary" && value !== "Secondary") {
          throw invalidArgument("ChartSeries.axisGroup must be Primary or Secondary");
        }
        if (name === "chartType" && typeof value !== "string") {
          throw invalidArgument("ChartSeries.chartType must be a string");
        }
        if (name === "filtered" || name === "smooth") {
          if (typeof value !== "boolean") throw invalidArgument("ChartSeries." + name + " must be a boolean");
        }
        if (name === "name") {
          if (typeof value !== "string") throw invalidArgument("ChartSeries.name must be a string");
          if (value.length > 255) throw invalidArgument("ChartSeries.name cannot exceed 255 characters");
        }
        if (name === "plotOrder") integerArgument(value, "ChartSeries.plotOrder", false);
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

  ChartSeries.prototype.set = function (source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var readOnly = ["context", "isNullObject"];
    var names = ["axisGroup", "chartType", "filtered", "name", "plotOrder", "smooth"];
    var isClientObject = source instanceof ClientObject;
    if (isClientObject && Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
      throw invalidArgument("The object passed to set must have the same type.");
    }
    if (!isClientObject && (!options || options.throwOnReadOnly !== false)) {
      for (var i = 0; i < readOnly.length; i++) {
        if (Object.prototype.hasOwnProperty.call(source, readOnly[i])) {
          throw invalidArgument("The property '" + readOnly[i] + "' is read-only.");
        }
      }
    }
    for (var j = 0; j < names.length; j++) {
      var name = names[j];
      if (isClientObject) {
        if (source._loaded[name]) this[name] = source[name];
      } else if (Object.prototype.hasOwnProperty.call(source, name)) {
        this[name] = source[name];
      }
    }
  };

  ChartSeries.prototype.delete = function () {
    this.context._queue.push({
      op: "chartSeriesDelete",
      id: this._id,
      chartId: this._chart._id,
    });
  };

  function queueDimensionResult(series, operation, dimension) {
    if (typeof dimension !== "string") {
      throw invalidArgument(operation + " dimension must be a ChartSeriesDimension");
    }
    var result = newClientResult(series.context);
    series.context._queue.push({
      op: operation,
      id: series._id,
      chartId: series._chart._id,
      dimension: dimension,
      resultId: result._id,
    });
    return result;
  }

  ChartSeries.prototype.getDimensionDataSourceString = function (dimension) {
    return queueDimensionResult(this, "chartSeriesGetDimensionDataSourceString", dimension);
  };

  ChartSeries.prototype.getDimensionDataSourceType = function (dimension) {
    return queueDimensionResult(this, "chartSeriesGetDimensionDataSourceType", dimension);
  };

  ChartSeries.prototype.getDimensionValues = function (dimension) {
    return queueDimensionResult(this, "chartSeriesGetDimensionValues", dimension);
  };

  function setDimensionSource(series, dimension, sourceData, method) {
    var range = requireRange(sourceData, series.context, method);
    series.context._queue.push({
      op: "chartSeriesSetDimensionSource",
      id: series._id,
      chartId: series._chart._id,
      dimension: dimension,
      rangeId: range._id,
    });
  }

  ChartSeries.prototype.setBubbleSizes = function (sourceData) {
    setDimensionSource(this, "BubbleSizes", sourceData, "ChartSeries.setBubbleSizes");
  };

  ChartSeries.prototype.setValues = function (sourceData) {
    setDimensionSource(this, "Values", sourceData, "ChartSeries.setValues");
  };

  ChartSeries.prototype.setXAxisValues = function (sourceData) {
    setDimensionSource(this, "XValues", sourceData, "ChartSeries.setXAxisValues");
  };

  ChartSeries.prototype.toJSON = function () {
    return toJSONScalars(this);
  };

  function chartSeriesForChart(chart) {
    chart._navigationProperties = chart._navigationProperties || [];
    if (chart._navigationProperties.indexOf("series") < 0) {
      chart._navigationProperties.push("series");
    }
    if (!chart._series) {
      chart._series = new ChartSeriesCollection(chart.context, chart);
    }
    return chart._series;
  }

  function installChartSeries() {
    if (!Excel || !Excel.Chart || !Excel.Chart.prototype) return false;
    Object.defineProperty(Excel.Chart.prototype, "series", {
      get: function () {
        return chartSeriesForChart(this);
      },
      configurable: true,
    });
    // A caller may load `chart.load("series")` before ever reading the
    // navigation property.  The core Chart constructor starts with an empty
    // navigation list, so make the base ClientObject loader see this child in
    // that order as well as when `chart.series` is read first.
    var chartLoad = Excel.Chart.prototype.load;
    if (typeof chartLoad === "function" && !chartLoad._chartSeriesNavigation) {
      var wrappedLoad = function (props) {
        this._navigationProperties = this._navigationProperties || [];
        if (this._navigationProperties.indexOf("series") < 0) {
          this._navigationProperties.push("series");
        }
        return chartLoad.apply(this, arguments);
      };
      wrappedLoad._chartSeriesNavigation = true;
      Excel.Chart.prototype.load = wrappedLoad;
    }
    Excel.ChartSeriesCollection = ChartSeriesCollection;
    Excel.ChartSeries = ChartSeries;
    return true;
  }

  // The chart core module is loaded before this module in production. Keep an
  // install hook as well so a host that evaluates modules in a different order
  // can attach the navigation after defining Excel.Chart.
  if (global.__mogOfficeJs) global.__mogOfficeJs.installChartSeries = installChartSeries;
  installChartSeries();
})(globalThis);
