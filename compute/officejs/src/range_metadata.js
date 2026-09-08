(function (global) {
  "use strict";

  // Range metadata is installed after range_content.js.  The bootstrap owns
  // load normalization and hydration; this file only adds the Range members
  // whose wire values are scalar (or rectangular scalar) projections.
  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;

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

  var scalarProperties = [
    "formulasR1C1",
    "formulasLocal",
    "numberFormatLocal",
    "numberFormatCategories",
    "hasSpill",
    "hidden",
    "rowHidden",
    "columnHidden",
    "isEntireRow",
    "isEntireColumn",
    // The compute layout facade exposes pixels while Office.js pins these
    // values in points. Keep descriptors installed so an unsupported read is
    // reported by context.sync instead of becoming an undefined JS member.
    "height",
    "width",
    "left",
    "top",
  ];

  // Keep locale, point-based dimensions, and hasSpill out of the default load
  // set: the host deliberately reports those capabilities as unavailable for
  // some ranges, and a default Range.load() must continue to work. Explicit
  // load("...") calls still reach the host because ClientObject.load accepts
  // named scalar paths and hydration uses these descriptors below.
  var registeredScalarProperties = [
    "formulasR1C1",
    "numberFormatCategories",
    "hidden",
    "rowHidden",
    "columnHidden",
    "isEntireRow",
    "isEntireColumn",
  ];

  global.__mogOfficeJs.addScalarProperties(Excel.Range.prototype, registeredScalarProperties);

  var writable = {
    formulasR1C1: true,
    formulasLocal: true,
    numberFormatLocal: true,
    rowHidden: true,
    columnHidden: true,
  };

  function defineLoadedScalar(name) {
    Object.defineProperty(Excel.Range.prototype, name, {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  }

  scalarProperties.forEach(function (name) {
    if (writable[name]) {
      Object.defineProperty(Excel.Range.prototype, name, {
        configurable: true,
        enumerable: true,
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
    } else {
      defineLoadedScalar(name);
    }
  });

  // range_content.js predates these members and keeps its own writable list.
  // Wrap its generic set implementation so a property object can use the
  // newly registered setters while retaining its read-only and navigation
  // behavior.  The wrapper delegates all pre-existing members back to the
  // production implementation and only removes these five names from the
  // object passed to it.
  var previousSet = Excel.Range.prototype.set;
  var previousToJSON = Excel.Range.prototype.toJSON;

  Excel.Range.prototype.toJSON = function () {
    var data = typeof previousToJSON === "function" ? previousToJSON.call(this) : {};
    scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  Excel.Range.prototype.set = function (source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }

    var isClientObject = source instanceof ClientObject;
    if (isClientObject && Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
      throw invalidArgument("The object passed to set must have the same type.");
    }

    var properties = isClientObject && typeof source.toJSON === "function" ? source.toJSON() : source;
    var metadata = {};
    var delegated = {};
    var allScalars = (this._scalarProperties || []).concat(this._additionalScalarProperties || []);
    var throwOnReadOnly = !options || options.throwOnReadOnly !== false;
    Object.keys(properties).forEach(function (name) {
      if (writable[name]) metadata[name] = properties[name];
      else if (isClientObject && allScalars.indexOf(name) >= 0) {
        // Range.set(sourceRange) ignores read-only scalar members from the
        // source object's JSON. Keep that behavior while handling the new
        // writable metadata members above.
      }
      else if (scalarProperties.indexOf(name) >= 0) {
        if (!isClientObject && throwOnReadOnly) {
          throw invalidArgument("The property '" + name + "' is read-only.");
        }
      }
      else delegated[name] = properties[name];
    });

    // This preserves the original Range.set behavior for values, formulas,
    // numberFormat, format, and all read-only members.
    previousSet.call(this, delegated, options);
    Object.keys(metadata).forEach(function (name) {
      if (metadata[name] !== undefined) this[name] = metadata[name];
    }, this);
  };
})(globalThis);
