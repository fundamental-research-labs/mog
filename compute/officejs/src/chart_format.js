(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

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

  function unsupported(message) {
    return error("ApiNotFound", message);
  }

  function invalidRequestContext() {
    return error(
      "InvalidRequestContext",
      "The object belongs to a different request context."
    );
  }

  function requireObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function bool(value, property) {
    if (typeof value !== "boolean") {
      throw invalidArgument(property + " must be a boolean");
    }
    return value;
  }

  function string(value, property) {
    if (typeof value !== "string") {
      throw invalidArgument(property + " must be a string");
    }
    return value;
  }

  function nonEmptyString(value, property) {
    value = string(value, property);
    if (value.trim().length === 0) {
      throw invalidArgument(property + " must be a non-empty string");
    }
    return value;
  }

  function finiteNumber(value, property) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw invalidArgument(property + " must be a finite number");
    }
    return value;
  }

  function orientation(value, property) {
    value = finiteNumber(value, property);
    if (!((-90 <= value && value <= 90) || value === 180)) {
      throw invalidArgument(property + " must be -90 through 90, or 180");
    }
    return value;
  }

  function enumValue(value, property, values) {
    if (typeof value !== "string" || values.indexOf(value) < 0) {
      throw invalidArgument(
        property + " must be one of: " + values.join(", ")
      );
    }
    return value;
  }

  function color(value, property) {
    value = string(value, property);
    var hex = value.charAt(0) === "#" ? value.slice(1) : value;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      throw invalidArgument(
        property +
          " must be an HTML #RRGGBB color; named and theme colors are not persisted by the chart model"
      );
    }
    return "#" + hex.toUpperCase();
  }

  function navigationProperties(object) {
    var names = (object._navigationProperties || []).slice();
    (object._additionalNavigationProperties || []).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function setProperties(source, options) {
    requireObject(source);
    var isClientObject = source instanceof ClientObject;
    var properties = source;
    if (isClientObject) {
      if (
        Object.getPrototypeOf(this) !== Object.getPrototypeOf(source) ||
        source.context !== this.context
      ) {
        throw invalidArgument("The object passed to set must have the same type and request context.");
      }
      properties = source.toJSON();
    }

    var scalar = this._scalarProperties || [];
    for (var i = 0; i < scalar.length; i++) {
      var name = scalar[i];
      if (
        Object.prototype.hasOwnProperty.call(properties, name) &&
        properties[name] !== undefined
      ) {
        this[name] = properties[name];
      }
    }

    var nav = navigationProperties(this);
    for (i = 0; i < nav.length; i++) {
      name = nav[i];
      if (
        !Object.prototype.hasOwnProperty.call(properties, name) ||
        properties[name] === undefined
      ) {
        continue;
      }
      var child = isClientObject ? source[name] : properties[name];
      this[name].set(child, options);
    }
  }

  function toJSON() {
    var data = {};
    var scalar = this._scalarProperties || [];
    for (var i = 0; i < scalar.length; i++) {
      var name = scalar[i];
      if (this._loaded[name]) data[name] = this["_" + name];
    }
    var nav = navigationProperties(this);
    for (i = 0; i < nav.length; i++) {
      var child = this["_" + nav[i]];
      if (child && typeof child.toJSON === "function") {
        data[nav[i]] = child.toJSON();
      }
    }
    return data;
  }

  function defineScalar(ctor, name, writable, validator) {
    Object.defineProperty(ctor.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        if (!writable) {
          throw unsupported(ctor._officeType + "." + name + " is read-only");
        }
        if (validator) value = validator(value, name);
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

  function defineScalars(ctor, names, validators, readOnly) {
    ctor._officeType = ctor._officeType || ctor.name || "ChartObject";
    names.forEach(function (name) {
      var writable = !readOnly || readOnly.indexOf(name) < 0;
      defineScalar(ctor, name, writable, validators && validators[name]);
    });
  }

  function commonPrototype(ctor, typeName, scalar, validators, readOnly) {
    ctor._officeType = typeName;
    // Keep the function's existing prototype object.  Format navigation
    // descriptors are installed once below; replacing the prototype from a
    // constructor would discard those descriptors on the first object.
    if (!(ctor.prototype instanceof ClientObject)) {
      Object.setPrototypeOf(ctor.prototype, ClientObject.prototype);
    }
    ctor.prototype.constructor = ctor;
    ctor.prototype.set = setProperties;
    ctor.prototype.toJSON = toJSON;
    ctor.prototype._scalarProperties = scalar.slice();
    defineScalars(ctor, scalar, validators, readOnly || []);
  }

  function chartFor(object) {
    return object._chart || object;
  }

  function queueIdentity(object, operation) {
    var chart = chartFor(object);
    operation.parentId = chart._id;
    if (chart._chartId !== undefined && chart._chartId !== null) {
      operation.chartId = String(chart._chartId);
    } else if (chart._idValue !== undefined && chart._idValue !== null) {
      operation.chartId = String(chart._idValue);
    }
    if (chart._worksheet && chart._worksheet._id) {
      operation.worksheetId = chart._worksheet._id;
    }
  }

  function queueObject(object, kind) {
    var operation = {
      op: "chartFormatGetObject",
      id: object._id,
      kind: kind,
    };
    queueIdentity(object, operation);
    object.context._queue.push(operation);
  }

  function queueCollection(object) {
    var operation = {
      op: "chartFormatGetLegendEntries",
      id: object._id,
    };
    queueIdentity(object, operation);
    object.context._queue.push(operation);
  }

  function createResult(context) {
    return officeJs && officeJs.createClientResult
      ? officeJs.createClientResult(context)
      : new OfficeExtension.ClientResult(context);
  }

  var horizontalAlignmentValues = [
    "Center",
    "Left",
    "Right",
    "Justify",
    "Distributed",
  ];
  var verticalAlignmentValues = [
    "Center",
    "Bottom",
    "Top",
    "Justify",
    "Distributed",
  ];
  var titlePositionValues = [
    "Automatic",
    "Top",
    "Bottom",
    "Left",
    "Right",
  ];
  var legendPositionValues = [
    "Invalid",
    "Top",
    "Bottom",
    "Left",
    "Right",
    "Corner",
    "Custom",
  ];
  var labelPositionValues = [
    "Invalid",
    "None",
    "Center",
    "InsideEnd",
    "InsideBase",
    "OutsideEnd",
    "Left",
    "Right",
    "Top",
    "Bottom",
    "BestFit",
    "Callout",
  ];
  var lineStyleValues = [
    "None",
    "Continuous",
    "Dash",
    "DashDot",
    "DashDotDot",
    "Dot",
    "Grey25",
    "Grey50",
    "Grey75",
    "Automatic",
    "RoundDot",
  ];
  var colorSchemeValues = [
    "ColorfulPalette1",
    "ColorfulPalette2",
    "ColorfulPalette3",
    "ColorfulPalette4",
    "MonochromaticPalette1",
    "MonochromaticPalette2",
    "MonochromaticPalette3",
    "MonochromaticPalette4",
    "MonochromaticPalette5",
    "MonochromaticPalette6",
    "MonochromaticPalette7",
    "MonochromaticPalette8",
    "MonochromaticPalette9",
    "MonochromaticPalette10",
    "MonochromaticPalette11",
    "MonochromaticPalette12",
    "MonochromaticPalette13",
  ];

  function titleHorizontal(value, property) {
    return enumValue(value, property, horizontalAlignmentValues);
  }

  function titleVertical(value, property) {
    return enumValue(value, property, verticalAlignmentValues);
  }

  function legendPosition(value, property) {
    return enumValue(value, property, legendPositionValues);
  }

  function labelPosition(value, property) {
    return enumValue(value, property, labelPositionValues);
  }

  function geometricShape(value, property) {
    value = string(value, property);
    var values = Excel.GeometricShapeType || {};
    var found = false;
    for (var key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key) && values[key] === value) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw invalidArgument(property + " must be an Excel.GeometricShapeType value");
    }
    return value;
  }

  function dataLabelHorizontal(value, property) {
    return enumValue(value, property, horizontalAlignmentValues);
  }

  function dataLabelVertical(value, property) {
    return enumValue(value, property, verticalAlignmentValues);
  }

  var fontValidators = {
    bold: bool,
    color: color,
    italic: bool,
    name: function (value, property) {
      value = nonEmptyString(value, property);
      if (value.length > 31) {
        throw invalidArgument(property + " must contain 1 through 31 characters");
      }
      return value;
    },
    size: function (value, property) {
      value = finiteNumber(value, property);
      if (value < 1 || value > 409) {
        throw invalidArgument(property + " must be between 1 and 409 points");
      }
      return value;
    },
    underline: function (value, property) {
      return enumValue(value, property, ["None", "Single"]);
    },
  };

  function queueFillMethod(object, property, value) {
    object.context._queue.push({
      op: "set",
      id: object._id,
      property: property,
      value: value,
    });
  }

  function ChartTitle(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["format"];
    commonPrototype(
      ChartTitle,
      "ChartTitle",
      [
        "height",
        "horizontalAlignment",
        "left",
        "overlay",
        "position",
        "showShadow",
        "text",
        "textOrientation",
        "top",
        "verticalAlignment",
        "visible",
        "width",
      ],
      {
        horizontalAlignment: titleHorizontal,
        overlay: bool,
        position: function (value, property) {
          return enumValue(value, property, titlePositionValues);
        },
        showShadow: bool,
        text: string,
        textOrientation: orientation,
        verticalAlignment: titleVertical,
        visible: bool,
      },
      ["height", "left", "top", "width"]
    );
    queueObject(this, "title");
  }

  Object.defineProperty(ChartTitle.prototype, "format", {
    get: function () {
      if (!this._format) this._format = new ChartTitleFormat(this.context, this._chart);
      return this._format;
    },
    configurable: true,
  });

  function ChartLegend(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["format", "legendEntries"];
    commonPrototype(
      ChartLegend,
      "ChartLegend",
      ["height", "left", "overlay", "position", "showShadow", "top", "visible", "width"],
      {
        overlay: bool,
        position: legendPosition,
        showShadow: bool,
        visible: bool,
      },
      ["height", "left", "top", "width"]
    );
    queueObject(this, "legend");
  }

  Object.defineProperty(ChartLegend.prototype, "format", {
    get: function () {
      if (!this._format) this._format = new ChartLegendFormat(this.context, this._chart);
      return this._format;
    },
    configurable: true,
  });

  Object.defineProperty(ChartLegend.prototype, "legendEntries", {
    get: function () {
      if (!this._legendEntries) {
        this._legendEntries = new ChartLegendEntryCollection(
          this.context,
          this._chart
        );
      }
      return this._legendEntries;
    },
    configurable: true,
  });

  function ChartDataLabels(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["format", "leaderLines"];
    commonPrototype(
      ChartDataLabels,
      "ChartDataLabels",
      [
        "autoText",
        "geometricShapeType",
        "horizontalAlignment",
        "linkNumberFormat",
        "numberFormat",
        "position",
        "separator",
        "showAsStickyCallout",
        "showBubbleSize",
        "showCategoryName",
        "showLeaderLines",
        "showLegendKey",
        "showPercentage",
        "showSeriesName",
        "showValue",
        "textOrientation",
        "verticalAlignment",
      ],
      {
        autoText: bool,
        geometricShapeType: geometricShape,
        horizontalAlignment: dataLabelHorizontal,
        linkNumberFormat: bool,
        numberFormat: string,
        position: labelPosition,
        separator: string,
        showBubbleSize: bool,
        showCategoryName: bool,
        showLeaderLines: bool,
        showLegendKey: bool,
        showPercentage: bool,
        showSeriesName: bool,
        showValue: bool,
        textOrientation: orientation,
        verticalAlignment: dataLabelVertical,
      },
      ["showAsStickyCallout"]
    );
    queueObject(this, "dataLabels");
  }

  Object.defineProperty(ChartDataLabels.prototype, "format", {
    get: function () {
      if (!this._format) {
        this._format = new ChartDataLabelFormat(this.context, this._chart);
      }
      return this._format;
    },
    configurable: true,
  });

  Object.defineProperty(ChartDataLabels.prototype, "leaderLines", {
    get: function () {
      if (!this._leaderLines) {
        this._leaderLines = new ChartLeaderLines(this.context, this._chart);
      }
      return this._leaderLines;
    },
    configurable: true,
  });

  function ChartAreaFormat(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["border", "fill", "font"];
    commonPrototype(
      ChartAreaFormat,
      "ChartAreaFormat",
      ["colorScheme", "roundedCorners"],
      {
        colorScheme: function (value, property) {
          return enumValue(value, property, colorSchemeValues);
        },
        roundedCorners: bool,
      }
    );
    queueObject(this, "areaFormat");
  }

  function ChartTitleFormat(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["border", "fill", "font"];
    commonPrototype(ChartTitleFormat, "ChartTitleFormat", []);
    queueObject(this, "titleFormat");
  }

  function ChartLegendFormat(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["border", "fill", "font"];
    commonPrototype(ChartLegendFormat, "ChartLegendFormat", []);
    queueObject(this, "legendFormat");
  }

  function ChartDataLabelFormat(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["border", "fill", "font"];
    commonPrototype(ChartDataLabelFormat, "ChartDataLabelFormat", []);
    queueObject(this, "dataLabelFormat");
  }

  function ChartFill(context, chart, kind) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._kind = kind;
    commonPrototype(ChartFill, "ChartFill", []);
    queueObject(this, kind);
  }

  ChartFill.prototype.clear = function () {
    queueFillMethod(this, "clear", null);
  };

  ChartFill.prototype.getSolidColor = function () {
    var result = createResult(this.context);
    var operation = {
      op: "chartFormatFillGetSolidColor",
      resultId: result._id,
      kind: this._kind,
    };
    queueIdentity(this, operation);
    this.context._queue.push(operation);
    return result;
  };

  ChartFill.prototype.setSolidColor = function (value) {
    queueFillMethod(this, "solidColor", color(value, "ChartFill.setSolidColor color"));
  };

  function ChartBorder(context, chart, kind) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._kind = kind;
    commonPrototype(
      ChartBorder,
      "ChartBorder",
      ["color", "lineStyle", "weight"],
      {
        color: color,
        lineStyle: function (value, property) {
          return enumValue(value, property, lineStyleValues);
        },
        weight: function (value, property) {
          value = finiteNumber(value, property);
          if (value < 0) throw invalidArgument(property + " must be non-negative");
          return value;
        },
      }
    );
    queueObject(this, kind);
  }

  ChartBorder.prototype.clear = function () {
    queueFillMethod(this, "clear", null);
  };

  function ChartLineFormat(context, chart, kind) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._kind = kind;
    commonPrototype(
      ChartLineFormat,
      "ChartLineFormat",
      ["color", "lineStyle", "weight"],
      {
        color: color,
        lineStyle: function (value, property) {
          return enumValue(value, property, lineStyleValues);
        },
        weight: function (value, property) {
          value = finiteNumber(value, property);
          if (value < 0) throw invalidArgument(property + " must be non-negative");
          return value;
        },
      }
    );
    queueObject(this, kind);
  }

  ChartLineFormat.prototype.clear = function () {
    queueFillMethod(this, "clear", null);
  };

  function ChartFont(context, chart, kind) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._kind = kind;
    commonPrototype(
      ChartFont,
      "ChartFont",
      ["bold", "color", "italic", "name", "size", "underline"],
      fontValidators
    );
    queueObject(this, kind);
  }

  function ChartLeaderLines(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["format"];
    commonPrototype(ChartLeaderLines, "ChartLeaderLines", []);
    queueObject(this, "leaderLines");
  }

  Object.defineProperty(ChartLeaderLines.prototype, "format", {
    get: function () {
      if (!this._format) {
        this._format = new ChartLeaderLinesFormat(this.context, this._chart);
      }
      return this._format;
    },
    configurable: true,
  });

  function ChartLeaderLinesFormat(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["line"];
    commonPrototype(ChartLeaderLinesFormat, "ChartLeaderLinesFormat", []);
    queueObject(this, "leaderLinesFormat");
  }

  Object.defineProperty(ChartLeaderLinesFormat.prototype, "line", {
    get: function () {
      if (!this._line) {
        this._line = new ChartLineFormat(
          this.context,
          this._chart,
          "leaderLinesLine"
        );
      }
      return this._line;
    },
    configurable: true,
  });

  function ChartLegendEntry(context, chart, collection, index, queue) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._collection = collection || null;
    this._entryIndex = index;
    commonPrototype(
      ChartLegendEntry,
      "ChartLegendEntry",
      ["height", "index", "left", "top", "visible", "width"],
      {
        visible: bool,
      },
      ["height", "index", "left", "top", "width"]
    );
    if (queue) queueLegendEntry(this);
  }

  function queueLegendEntry(object) {
    var operation = {
      op: "chartFormatLegendEntriesGetItemAt",
      id: object._id,
      index: object._entryIndex,
      collectionId: object._collection ? object._collection._id : null,
    };
    queueIdentity(object, operation);
    object.context._queue.push(operation);
  }

  function ChartLegendEntryCollection(context, chart) {
    ClientObject.call(this, context);
    this._chart = chart;
    this._navigationProperties = ["items"];
    this._scalarProperties = ["items"];
    this._itemCache = Object.create(null);
    this._bindingQueued = true;
    commonPrototype(ChartLegendEntryCollection, "ChartLegendEntryCollection", ["items"]);
    if (officeJs && officeJs.configureCollection) {
      officeJs.configureCollection(this, function (key, descriptor) {
        var index = Number(key);
        var entry = new ChartLegendEntry(
          this.context,
          this._chart,
          this,
          index,
          true
        );
        return entry;
      });
    }
    queueCollection(this);
  }

  ChartLegendEntryCollection.prototype.getCount = function () {
    var result = createResult(this.context);
    this.context._queue.push({
      op: "chartFormatLegendEntriesGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  ChartLegendEntryCollection.prototype.getItemAt = function (index) {
    index = finiteNumber(index, "ChartLegendEntryCollection.getItemAt index");
    if (Math.floor(index) !== index || index < 0) {
      throw invalidArgument(
        "ChartLegendEntryCollection.getItemAt index must be a non-negative integer"
      );
    }
    var cacheKey = String(index);
    var entry = this._itemCache[cacheKey];
    if (!entry) {
      entry = new ChartLegendEntry(this.context, this._chart, this, index, true);
      this._itemCache[cacheKey] = entry;
    }
    return entry;
  };

  ChartLegendEntryCollection.prototype.load = function (properties) {
    return ClientObject.prototype.load.call(this, properties);
  };

  ChartLegendEntryCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: (this._items || []).map(function (item) {
        return item.toJSON();
      }),
    };
  };

  function defineFormatNavigation(ctor, fillKind, fontKind, borderKind) {
    Object.defineProperty(ctor.prototype, "fill", {
      get: function () {
        if (!this._fill) {
          this._fill = new ChartFill(this.context, this._chart, fillKind);
        }
        return this._fill;
      },
      configurable: true,
    });
    Object.defineProperty(ctor.prototype, "font", {
      get: function () {
        if (!this._font) {
          this._font = new ChartFont(this.context, this._chart, fontKind);
        }
        return this._font;
      },
      configurable: true,
    });
    Object.defineProperty(ctor.prototype, "border", {
      get: function () {
        if (!this._border) {
          this._border = new ChartBorder(this.context, this._chart, borderKind);
        }
        return this._border;
      },
      configurable: true,
    });
  }

  defineFormatNavigation(
    ChartAreaFormat,
    "areaFill",
    "areaFont",
    "areaBorder"
  );
  defineFormatNavigation(
    ChartTitleFormat,
    "titleFill",
    "titleFont",
    "titleBorder"
  );
  defineFormatNavigation(
    ChartLegendFormat,
    "legendFill",
    "legendFont",
    "legendBorder"
  );
  defineFormatNavigation(
    ChartDataLabelFormat,
    "dataLabelFill",
    "dataLabelFont",
    "dataLabelBorder"
  );

  function attachChartNavigation() {
    if (!Excel.Chart) return false;
    if (officeJs && officeJs.addNavigationProperties) {
      officeJs.addNavigationProperties(Excel.Chart.prototype, [
        "title",
        "legend",
        "format",
        "dataLabels",
      ]);
    }
    Object.defineProperty(Excel.Chart.prototype, "title", {
      get: function () {
        if (!this._title) this._title = new ChartTitle(this.context, this);
        return this._title;
      },
      configurable: true,
    });
    Object.defineProperty(Excel.Chart.prototype, "legend", {
      get: function () {
        if (!this._legend) this._legend = new ChartLegend(this.context, this);
        return this._legend;
      },
      configurable: true,
    });
    Object.defineProperty(Excel.Chart.prototype, "format", {
      get: function () {
        if (!this._format) this._format = new ChartAreaFormat(this.context, this);
        return this._format;
      },
      configurable: true,
    });
    Object.defineProperty(Excel.Chart.prototype, "dataLabels", {
      get: function () {
        if (!this._dataLabels) {
          this._dataLabels = new ChartDataLabels(this.context, this);
        }
        return this._dataLabels;
      },
      configurable: true,
    });
    return true;
  }

  // chart_core.js is loaded before this file in the production runtime. The
  // exported hook also lets an integrator attach these properties after a
  // dynamically loaded Chart constructor is installed.
  attachChartNavigation();

  global.__mogChartFormat = {
    attachChartNavigation: attachChartNavigation,
    ChartFormatKind: {
      title: "title",
      legend: "legend",
      dataLabels: "dataLabels",
      areaFormat: "areaFormat",
      titleFormat: "titleFormat",
      legendFormat: "legendFormat",
      dataLabelFormat: "dataLabelFormat",
      leaderLines: "leaderLines",
      leaderLinesFormat: "leaderLinesFormat",
      leaderLinesLine: "leaderLinesLine",
    },
  };

  Excel.ChartTitle = ChartTitle;
  Excel.ChartLegend = ChartLegend;
  Excel.ChartDataLabels = ChartDataLabels;
  Excel.ChartAreaFormat = ChartAreaFormat;
  Excel.ChartTitleFormat = ChartTitleFormat;
  Excel.ChartLegendFormat = ChartLegendFormat;
  Excel.ChartDataLabelFormat = ChartDataLabelFormat;
  Excel.ChartFill = ChartFill;
  Excel.ChartBorder = ChartBorder;
  Excel.ChartLineFormat = ChartLineFormat;
  Excel.ChartFont = ChartFont;
  Excel.ChartLeaderLines = ChartLeaderLines;
  Excel.ChartLeaderLinesFormat = ChartLeaderLinesFormat;
  Excel.ChartLegendEntry = ChartLegendEntry;
  Excel.ChartLegendEntryCollection = ChartLegendEntryCollection;
})(globalThis);
