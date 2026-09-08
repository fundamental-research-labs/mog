(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function richApiError(code, message) {
    var error = new OfficeExtension.Error({ code: code, message: message });
    error.name = "RichApi.Error";
    error.code = code;
    return error;
  }

  function propertyNotLoaded(name) {
    return richApiError(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function invalidArgument(message) {
    return richApiError("InvalidArgument", message);
  }

  function invalidRequestContext() {
    return richApiError(
      "InvalidRequestContext",
      "The object belongs to a different request context."
    );
  }

  function requireContext(source, context, property) {
    if (source.context !== context) throw invalidRequestContext();
    return property;
  }

  function integerArgument(value, property) {
    if (
      typeof value !== "number" ||
      !isFinite(value) ||
      Math.floor(value) !== value
    ) {
      throw invalidArgument(property + " must be an integer");
    }
    return value;
  }

  function clearMode(value) {
    if (value === undefined || value === null) return "All";
    if (
      value === "All" ||
      value === "Formats" ||
      value === "Contents" ||
      value === "Hyperlinks" ||
      value === "RemoveHyperlinks" ||
      value === "ResetContents"
    ) {
      return value;
    }
    // Keep invalid values deferred until context.sync(), matching Range.clear.
    return value;
  }

  function scalarProperties(object) {
    var result = (object._scalarProperties || []).slice();
    (object._additionalScalarProperties || []).forEach(function (name) {
      if (result.indexOf(name) < 0) result.push(name);
    });
    return result;
  }

  function navigationProperties(object) {
    var result = (object._navigationProperties || []).slice();
    (object._additionalNavigationProperties || []).forEach(function (name) {
      if (result.indexOf(name) < 0) result.push(name);
    });
    return result;
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function setProperties(source, options) {
    requirePropertyObject(source);
    var isClientObject = source instanceof ClientObject;
    var properties = source;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      properties = source.toJSON();
    }

    var throwOnReadOnly = !options || options.throwOnReadOnly !== false;
    var names = scalarProperties(this);
    var writable = { style: true };
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!Object.prototype.hasOwnProperty.call(properties, name)) continue;
      if (properties[name] === undefined) continue;
      if (!writable[name]) {
        if (!isClientObject && throwOnReadOnly) {
          throw invalidArgument("The property '" + name + "' is read-only.");
        }
        continue;
      }
      this[name] = properties[name];
    }

    // RangeAreas format and dataValidation are separate object paths. They
    // are intentionally not synthesized here; unsupported members remain
    // explicit until their production adapters exist.
    var navigation = navigationProperties(this);
    for (i = 0; i < navigation.length; i++) {
      name = navigation[i];
      if (!Object.prototype.hasOwnProperty.call(properties, name)) continue;
      if (properties[name] === undefined) continue;
      throw invalidArgument(
        "RangeAreas." + name + " set is not supported by this host"
      );
    }
  }

  function toJSON() {
    var data = {};
    var names = scalarProperties(this);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (this._loaded[name]) data[name] = this["_" + name];
    }
    var navigation = navigationProperties(this);
    for (i = 0; i < navigation.length; i++) {
      var child = this["_" + navigation[i]];
      if (
        child &&
        (this._loaded[navigation[i]] ||
          (navigation[i] === "areas" && child._loaded.items))
      ) {
        data[navigation[i]] =
          typeof child.toJSON === "function" ? child.toJSON() : child;
      }
    }
    return data;
  }

  function defineReadOnlyScalar(prototype, name) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  }

  function RangeAreas(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    this._scalarProperties = [
      "address",
      "addressLocal",
      "areaCount",
      "cellCount",
      "isEntireColumn",
      "isEntireRow",
      "style",
    ];
    this._navigationProperties = ["areas"];
  }
  RangeAreas.prototype = Object.create(ClientObject.prototype);
  RangeAreas.prototype.constructor = RangeAreas;

  RangeAreas.prototype.track = function () {
    this.context.trackedObjects.add(this);
    return this;
  };

  RangeAreas.prototype.untrack = function () {
    this.context.trackedObjects.remove(this);
    return this;
  };

  [
    "address",
    "addressLocal",
    "areaCount",
    "cellCount",
    "isEntireColumn",
    "isEntireRow",
  ].forEach(function (name) {
    defineReadOnlyScalar(RangeAreas.prototype, name);
  });

  Object.defineProperty(RangeAreas.prototype, "style", {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!this._loaded.style) throw propertyNotLoaded("style");
      return this._style;
    },
    set: function (value) {
      if (value !== null && typeof value !== "string") {
        throw invalidArgument("RangeAreas.style must be a string");
      }
      this._style = value;
      this._loaded.style = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "style",
        value: value,
      });
    },
  });

  Object.defineProperty(RangeAreas.prototype, "areas", {
    configurable: true,
    get: function () {
      if (!this._areas) this._areas = new RangeCollection(this.context, this);
      return this._areas;
    },
  });

  RangeAreas.prototype.set = setProperties;
  RangeAreas.prototype.toJSON = toJSON;

  RangeAreas.prototype.clear = function (applyTo) {
    this.context._queue.push({
      op: "rangeAreasClear",
      id: this._id,
      applyTo: clearMode(applyTo),
    });
  };

  RangeAreas.prototype.getIntersectionOrNullObject = function (anotherRange) {
    var argument;
    if (anotherRange instanceof RangeAreas) {
      requireContext(anotherRange, this.context);
      argument = { rangeAreasId: anotherRange._id };
    } else if (anotherRange instanceof Excel.Range) {
      requireContext(anotherRange, this.context);
      argument = { rangeId: anotherRange._id };
    } else if (typeof anotherRange === "string") {
      argument = anotherRange;
    } else {
      throw invalidArgument(
        "RangeAreas.getIntersectionOrNullObject requires a Range, RangeAreas, or range address"
      );
    }

    var result = new RangeAreas(this.context, this._worksheet);
    this.context._queue.push({
      op: "rangeAreasNavigation",
      id: result._id,
      rangeAreasId: this._id,
      method: "getIntersectionOrNullObject",
      args: [argument],
    });
    return result;
  };

  function RangeCollection(context, rangeAreas) {
    ClientObject.call(this, context);
    this._rangeAreas = rangeAreas;
    this._worksheet = rangeAreas._worksheet;
    this._scalarProperties = ["items"];
    this._navigationProperties = [];
    this._rangeCollectionConfigured = true;
    context._queue.push({
      op: "getRangeAreasCollection",
      id: this._id,
      rangeAreasId: rangeAreas._id,
    });

    officeJs.configureCollection(this, function (key) {
      if (!this._worksheet) {
        throw invalidArgument("RangeCollection items require a worksheet");
      }
      var range = this._worksheet.getRange(String(key));
      range._collection = this;
      range._rangeAreas = this._rangeAreas;
      return range;
    });
  }
  RangeCollection.prototype = Object.create(ClientObject.prototype);
  RangeCollection.prototype.constructor = RangeCollection;

  Object.defineProperty(RangeCollection.prototype, "items", {
    configurable: true,
    get: function () {
      if (!this._loaded.items) throw propertyNotLoaded("items");
      return this._items || [];
    },
  });

  RangeCollection.prototype.getCount = function () {
    var result = officeJs.createClientResult(this.context);
    this.context._queue.push({
      op: "rangeCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };

  RangeCollection.prototype.getItemAt = function (index) {
    integerArgument(index, "RangeCollection.getItemAt index");
    if (index < 0) throw invalidArgument("RangeCollection.getItemAt index must be non-negative");
    var range = new Excel.Range(this.context, this._worksheet, null);
    range._collection = this;
    range._rangeAreas = this._rangeAreas;
    this.context._queue.push({
      op: "rangeCollectionGetItemAt",
      id: range._id,
      collectionId: this._id,
      index: index,
    });
    return range;
  };

  RangeCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return {
      items: (this.items || []).map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  // Worksheet.getRanges is additive to the bootstrap Worksheet constructor.
  Excel.Worksheet.prototype.getRanges = function (address) {
    if (address !== undefined && typeof address !== "string") {
      throw invalidArgument("Worksheet.getRanges address must be a string");
    }
    var result = new RangeAreas(this.context, this);
    this.context._queue.push({
      op: "getRangeAreas",
      id: result._id,
      worksheetId: this._id,
      address: address === undefined ? null : address,
    });
    return result;
  };

  // Result-producing families can allocate a normal RangeAreas proxy and
  // then queue their own typed host operation without depending on this
  // module's private constructor.
  officeJs.createRangeAreas = function (context, worksheet) {
    return new RangeAreas(context, worksheet || null);
  };

  officeJs.queueRangeAreasOperation = function (rangeAreas, operation) {
    if (!(rangeAreas instanceof RangeAreas)) {
      throw invalidArgument("queueRangeAreasOperation requires a RangeAreas object");
    }
    if (!operation || typeof operation !== "object") {
      throw invalidArgument("queueRangeAreasOperation requires an operation object");
    }
    var queued = {};
    Object.keys(operation).forEach(function (name) {
      queued[name] = operation[name];
    });
    queued.id = rangeAreas._id;
    rangeAreas.context._queue.push(queued);
    return rangeAreas;
  };

  Excel.RangeAreas = RangeAreas;
  Excel.RangeCollection = RangeCollection;
})(globalThis);
