(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function error(code, message) {
    return new OfficeExtension.Error({ code: code, message: message });
  }

  function propertyNotLoaded(name) {
    return error(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function requirePropertyObject(source, typeName) {
    if (source == null || typeof source !== "object") {
      throw error("InvalidArgument", typeName + ".set requires a property object");
    }
  }

  function assertSameContext(source, target) {
    if (source.context !== target.context) {
      throw error(
        "InvalidRequestContext",
        "The object belongs to a different request context."
      );
    }
  }

  function loadedValue(object, name) {
    if (!object._loaded[name]) throw propertyNotLoaded(name);
    return object["_" + name];
  }

  function isClientObject(value) {
    return value instanceof ClientObject;
  }

  function queueSet(object, property, value, ensureBinding) {
    if (ensureBinding) ensureBinding.call(object);
    object["_" + property] = value;
    object._loaded[property] = true;
    object.context._queue.push({
      op: "set",
      id: object._id,
      property: property,
      value: value,
    });
  }

  function enumValue(value, property, allowed) {
    if (allowed.indexOf(value) < 0) {
      throw error(
        "InvalidArgument",
        property + " must be one of: " + allowed.join(", ")
      );
    }
    return value;
  }

  function readOnlyProperties(typeName) {
    return function (name, properties, throwOnReadOnly) {
      if (properties[name] === undefined) return true;
      if (throwOnReadOnly) {
        throw error("InvalidArgument", typeName + "." + name + " is read-only");
      }
      return true;
    };
  }

  function sourceObject(target, source, typeName) {
    requirePropertyObject(source, typeName);
    if (!isClientObject(source)) {
      return { properties: source };
    }
    assertSameContext(source, target);
    if (Object.getPrototypeOf(source) !== Object.getPrototypeOf(target)) {
      throw error(
        "InvalidArgument",
        "The object passed to " + typeName + ".set must have the same type."
      );
    }
    return { properties: source.toJSON() };
  }

  function setProperties(target, source, typeName, writable, readOnly, options) {
    var normalized = sourceObject(target, source, typeName);
    var properties = normalized.properties;
    var throwOnReadOnly = !(options && options.throwOnReadOnly === false);

    Object.keys(properties).forEach(function (name) {
      if (writable.indexOf(name) >= 0) return;
      if (readOnly.indexOf(name) >= 0) {
        readOnlyProperties(typeName)(
          name,
          properties,
          throwOnReadOnly
        );
        return;
      }
      throw error("InvalidArgument", "Unknown " + typeName + " property: " + name);
    });

    writable.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(properties, name)) {
        if (properties[name] !== undefined) target[name] = properties[name];
      }
    });
    return properties;
  }

  function Application(context, workbook) {
    ClientObject.call(this, context);
    this._workbook = workbook || null;
    // These are the scalar members that this headless host can answer from
    // the compute engine. Unsupported desktop/locale members remain explicit
    // descriptors below and are never silently fabricated by load().
    this._scalarProperties = ["calculationMode", "calculationState"];
    this._navigationProperties = ["iterativeCalculation"];
    this._bindingQueued = false;
  }
  Application.prototype = Object.create(ClientObject.prototype);
  Application.prototype.constructor = Application;

  Application.prototype._ensureBinding = function () {
    if (this._bindingQueued) return;
    this.context._queue.push({ op: "applicationBind", id: this._id });
    this._bindingQueued = true;
  };

  Application.prototype.load = function (props) {
    this._ensureBinding();
    return ClientObject.prototype.load.call(this, props);
  };

  function applicationScalar(name, setter) {
    Object.defineProperty(Application.prototype, name, {
      configurable: true,
      get: function () {
        return loadedValue(this, name);
      },
      set: setter,
    });
  }

  applicationScalar("calculationMode", function (value) {
    value = enumValue(value, "Application.calculationMode", [
      "Automatic",
      "AutomaticExceptTables",
      "Manual",
    ]);
    queueSet(this, "calculationMode", value, this._ensureBinding);
  });
  applicationScalar("calculationState");

  // These members exist in the pinned declarations, but require host
  // capabilities that this compute-backed runtime does not provide. Keeping
  // a normal unloaded getter makes an explicit load fail at sync and avoids a
  // misleading local value.
  [
    "calculationEngineVersion",
    "decimalSeparator",
    "thousandsSeparator",
    "useSystemSeparators",
  ].forEach(function (name) {
    applicationScalar(name);
  });

  function IterativeCalculation(context, application) {
    ClientObject.call(this, context);
    this._application = application;
    this._scalarProperties = ["enabled", "maxChange", "maxIteration"];
    this._bindingQueued = false;
  }
  IterativeCalculation.prototype = Object.create(ClientObject.prototype);
  IterativeCalculation.prototype.constructor = IterativeCalculation;

  IterativeCalculation.prototype._ensureBinding = function () {
    if (this._bindingQueued) return;
    this._application._ensureBinding();
    this.context._queue.push({
      op: "iterativeCalculationBind",
      id: this._id,
      applicationId: this._application._id,
    });
    this._bindingQueued = true;
  };

  IterativeCalculation.prototype.load = function (props) {
    this._ensureBinding();
    return ClientObject.prototype.load.call(this, props);
  };

  ["enabled", "maxChange", "maxIteration"].forEach(function (name) {
    Object.defineProperty(IterativeCalculation.prototype, name, {
      configurable: true,
      get: function () {
        return loadedValue(this, name);
      },
      set: function (value) {
        if (name === "enabled" && typeof value !== "boolean") {
          throw error("InvalidArgument", "IterativeCalculation.enabled must be a boolean");
        }
        if (
          name === "maxChange" &&
          (typeof value !== "number" || !isFinite(value) || value < 0)
        ) {
          throw error(
            "InvalidArgument",
            "IterativeCalculation.maxChange must be a finite non-negative number"
          );
        }
        if (
          name === "maxIteration" &&
          (typeof value !== "number" ||
            !isFinite(value) ||
            Math.floor(value) !== value ||
            value < 0)
        ) {
          throw error(
            "InvalidArgument",
            "IterativeCalculation.maxIteration must be a non-negative integer"
          );
        }
        queueSet(this, name, value, this._ensureBinding);
      },
    });
  });

  IterativeCalculation.prototype.set = function (source) {
    setProperties(
      this,
      source,
      "IterativeCalculation",
      ["enabled", "maxChange", "maxIteration"],
      [],
      undefined
    );
  };

  IterativeCalculation.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  Object.defineProperty(Application.prototype, "iterativeCalculation", {
    configurable: true,
    get: function () {
      this._ensureBinding();
      if (!this._iterativeCalculation) {
        this._iterativeCalculation = new IterativeCalculation(this.context, this);
      }
      return this._iterativeCalculation;
    },
  });

  Application.prototype.set = function (source, options) {
    var normalized = sourceObject(this, source, "Application");
    var properties = normalized.properties;
    var throwOnReadOnly = !(options && options.throwOnReadOnly === false);
    Object.keys(properties).forEach(function (name) {
      if (name === "calculationMode" || name === "iterativeCalculation") return;
      if (
        [
          "activeWindow",
          "cultureInfo",
          "calculationEngineVersion",
          "calculationState",
          "decimalSeparator",
          "thousandsSeparator",
          "useSystemSeparators",
          "windows",
        ].indexOf(name) >= 0
      ) {
        readOnlyProperties("Application")(name, properties, throwOnReadOnly);
        return;
      }
      throw error("InvalidArgument", "Unknown Application property: " + name);
    });
    if (
      Object.prototype.hasOwnProperty.call(properties, "calculationMode") &&
      properties.calculationMode !== undefined
    ) {
      this.calculationMode = properties.calculationMode;
    }
    if (Object.prototype.hasOwnProperty.call(properties, "iterativeCalculation")) {
      var child = this.iterativeCalculation;
      if (properties.iterativeCalculation && typeof properties.iterativeCalculation === "object") {
        child.set(properties.iterativeCalculation);
      }
    }
  };

  Application.prototype.calculate = function (calculationType) {
    calculationType = enumValue(calculationType, "Application.calculate calculationType", [
      "Recalculate",
      "Full",
      "FullRebuild",
    ]);
    this._ensureBinding();
    this.context._queue.push({
      op: "applicationCalculate",
      id: this._id,
      calculationType: calculationType,
    });
  };

  Application.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    if (this._iterativeCalculation) {
      data.iterativeCalculation = this._iterativeCalculation.toJSON();
    }
    return data;
  };

  function ensureWorkbookBinding() {
    if (this._workbookBindingQueued) return;
    this.context._queue.push({ op: "workbookBind", id: this._id });
    this._workbookBindingQueued = true;
  }

  // Workbook is created by bootstrap. The extension adds the one scalar
  // member owned by this family and a binding operation for generic load/set.
  officeJs.addScalarProperties(Excel.Workbook.prototype, [
    "usePrecisionAsDisplayed",
  ]);
  officeJs.addNavigationProperties(Excel.Workbook.prototype, ["application"]);

  Object.defineProperty(Excel.Workbook.prototype, "application", {
    configurable: true,
    get: function () {
      if (!this._application) this._application = new Application(this.context, this);
      return this._application;
    },
  });

  var workbookLoad = Excel.Workbook.prototype.load;
  Excel.Workbook.prototype.load = function (props) {
    ensureWorkbookBinding.call(this);
    return workbookLoad.call(this, props);
  };

  Object.defineProperty(Excel.Workbook.prototype, "usePrecisionAsDisplayed", {
    configurable: true,
    get: function () {
      return loadedValue(this, "usePrecisionAsDisplayed");
    },
    set: function (value) {
      if (typeof value !== "boolean") {
        throw error(
          "InvalidArgument",
          "Workbook.usePrecisionAsDisplayed must be a boolean"
        );
      }
      queueSet(this, "usePrecisionAsDisplayed", value, ensureWorkbookBinding);
    },
  });

  Excel.Workbook.prototype.set = function (source, options) {
    setProperties(
      this,
      source,
      "Workbook",
      ["usePrecisionAsDisplayed"],
      [],
      options
    );
  };

  Excel.Workbook.prototype.toJSON = function () {
    var data = {};
    if (this._loaded.usePrecisionAsDisplayed) {
      data.usePrecisionAsDisplayed = this._usePrecisionAsDisplayed;
    }
    return data;
  };

  // RequestContext owns the same Workbook proxy, so both navigation paths
  // produce one canonical Application object per context.
  Object.defineProperty(Excel.RequestContext.prototype, "application", {
    configurable: true,
    get: function () {
      return this.workbook.application;
    },
  });

  Excel.Application = Application;
  Excel.IterativeCalculation = IterativeCalculation;
})(globalThis);
