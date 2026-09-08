(function (global) {
  "use strict";

  function RichApiError(info) {
    info = typeof info === "string" ? { message: info } : (info || {});
    this.name = "RichApi.Error";
    this.message = info.message || "Office.js error";
    this.code = info.code || "GeneralException";
    this.debugInfo = Object.assign({ code: this.code, message: this.message }, info.debugInfo || {});
    this.traceMessages = info.traceMessages || [];
    this.innerError = info.innerError;
    this.stack = new Error(this.message).stack;
  }
  RichApiError.prototype = Object.create(Error.prototype);
  RichApiError.prototype.constructor = RichApiError;

  function propertyNotLoaded(name) {
    var err = new RichApiError(
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
    err.name = "RichApi.Error";
    err.code = "PropertyNotLoaded";
    err.debugInfo.code = err.code;
    return err;
  }

  function normalizeLoad(props, defaults) {
    if (props == null || props === undefined) {
      return defaults.slice();
    }
    if (typeof props === "string") {
      return props
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    if (Array.isArray(props)) {
      return props.reduce(function (result, entry) {
        return result.concat(normalizeLoad(entry, defaults));
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
          normalizeLoad(value, []).forEach(function (path) { result.push(key + "/" + path); });
        }
      });
      return result;
    }
    return [String(props)];
  }

  function invalidContextArgument(message, location) {
    return new RichApiError({
      code: "InvalidArgument",
      message: message,
      debugInfo: { errorLocation: location || "ClientRequestContext" },
    });
  }

  function parseSelectExpand(value, argumentName) {
    var propertyNames = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    if (!Array.isArray(value) && typeof value !== "string") {
      throw invalidContextArgument(
        "The " + argumentName + " load option must be a string or an array of strings.",
        "ClientRequestContext.loadRecursive"
      );
    }
    return propertyNames.map(function (propertyName) {
      if (typeof propertyName !== "string") {
        throw invalidContextArgument(
          "The " + argumentName + " load option must contain only strings.",
          "ClientRequestContext.loadRecursive"
        );
      }
      propertyName = propertyName.trim();
      var lower = propertyName.toLowerCase();
      if (lower === "items" || lower === "items/") return "*";
      if (lower.indexOf("items/") === 0 || lower.indexOf("items.") === 0) {
        propertyName = propertyName.slice(6);
      }
      return propertyName.replace(/[/.]items[/.]/gi, "/");
    }).filter(function (propertyName) {
      return propertyName.length > 0;
    });
  }

  function isLoadOption(value) {
    if (!isPlainObject(value)) return false;
    if (value.select !== undefined &&
        (typeof value.select === "string" || Array.isArray(value.select))) return true;
    if (value.expand !== undefined &&
        (typeof value.expand === "string" || Array.isArray(value.expand))) return true;
    if (value.top !== undefined && typeof value.top === "number") return true;
    if (value.skip !== undefined && typeof value.skip === "number") return true;
    return Object.keys(value).length === 0;
  }

  function parseStrictLoadOption(value, path, argumentName) {
    var query = { Select: [] };
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      var childArgument = argumentName + "." + key;
      if (key === "$all") {
        if (typeof child !== "boolean") {
          throw invalidContextArgument(
            "The " + childArgument + " load option must be a boolean.",
            "ClientRequestContext.loadRecursive"
          );
        }
        if (child) query.Select.push(path + "*");
      } else if (key === "$top" || key === "$skip") {
        if (typeof child !== "number" || path.length > 0) {
          throw invalidContextArgument(
            "The " + childArgument + " load option must be a number at the root.",
            "ClientRequestContext.loadRecursive"
          );
        }
        query[key === "$top" ? "Top" : "Skip"] = child;
      } else if (typeof child === "boolean") {
        if (child) query.Select.push(path + key);
      } else if (isPlainObject(child)) {
        var nested = parseStrictLoadOption(child, path + key + "/", childArgument);
        nested.Select.forEach(function (name) { query.Select.push(name); });
        if (nested.Top !== undefined) query.Top = nested.Top;
        if (nested.Skip !== undefined) query.Skip = nested.Skip;
      } else {
        throw invalidContextArgument(
          "The " + childArgument + " load option is invalid.",
          "ClientRequestContext.loadRecursive"
        );
      }
    });
    return query;
  }

  function parseQueryOption(value, argumentName) {
    argumentName = argumentName || "option";
    if (value === null || value === undefined) return {};
    if (typeof value === "string" || Array.isArray(value)) {
      return { Select: parseSelectExpand(value, argumentName) };
    }
    if (!isPlainObject(value)) {
      throw invalidContextArgument(
        "The " + argumentName + " load option is invalid.",
        "ClientRequestContext.loadRecursive"
      );
    }
    if (isLoadOption(value)) {
      var query = {};
      if (value.select !== undefined) query.Select = parseSelectExpand(value.select, argumentName + ".select");
      if (value.expand !== undefined) query.Expand = parseSelectExpand(value.expand, argumentName + ".expand");
      if (value.top !== undefined) query.Top = value.top;
      if (value.skip !== undefined) query.Skip = value.skip;
      return query;
    }
    return parseStrictLoadOption(value, "", argumentName);
  }

  var nextId = 1;
  function newId() {
    return "obj_" + nextId++;
  }

  function ClientObject(context) {
    this.context = context;
    this._id = newId();
    this._loaded = Object.create(null);
    this._createdAtSync = context._syncCount;
    this._bindingPending = false;
    this._bindingFailed = false;
    context._objects[this._id] = this;
  }

  function trackedObjectsArgumentError(message) {
    return new RichApiError({
      code: "InvalidArgument",
      message: message,
      debugInfo: { errorLocation: "ClientRequestContext.trackedObjects" },
    });
  }

  function trackedObjectsContextError() {
    return new RichApiError({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
      debugInfo: { errorLocation: "ClientRequestContext.trackedObjects" },
    });
  }

  function normalizeTrackedObjects(objects) {
    return Array.isArray(objects) ? objects.slice() : [objects];
  }

  function validateTrackedObjects(objects, context) {
    objects.forEach(function (object) {
      if (!(object instanceof ClientObject)) {
        throw trackedObjectsArgumentError(
          "Tracked objects must be OfficeExtension.ClientObject instances."
        );
      }
      if (object.context !== context) {
        throw trackedObjectsContextError();
      }
    });
  }

  function TrackedObjects(context) {
    this._context = context;
  }

  function unsupportedTrackingError() {
    return new RichApiError({
      code: "ApiNotFound",
      message:
        "Tracked Range objects are unavailable because this runtime does not provide Office.js reference IDs and restorable object paths.",
      debugInfo: { errorLocation: "ClientRequestContext.trackedObjects" },
    });
  }

  function requiresReferenceTracking(object) {
    return object._requiresReferenceTracking === true;
  }

  TrackedObjects.prototype.add = function (objects) {
    objects = normalizeTrackedObjects(objects);
    validateTrackedObjects(objects, this._context);
    if (objects.some(requiresReferenceTracking)) throw unsupportedTrackingError();
  };

  TrackedObjects.prototype.remove = function (objects) {
    objects = normalizeTrackedObjects(objects);
    validateTrackedObjects(objects, this._context);
    if (objects.some(requiresReferenceTracking)) throw unsupportedTrackingError();
  };

  function trackClientObject(object) {
    object.context.trackedObjects.add(object);
    return object;
  }

  function untrackClientObject(object) {
    object.context.trackedObjects.remove(object);
    return object;
  }

  var objectPathParents = ["_worksheet", "_table", "_range", "_collection", "_autoFilter", "_dataValidation", "_sort"];

  function hasFailedObjectPathParent(object, seen) {
    seen = seen || Object.create(null);
    if (!object || !(object instanceof ClientObject) || seen[object._id]) return false;
    seen[object._id] = true;
    if (object._bindingPending || object._bindingFailed) return true;
    if (object._loaded.isNullObject && object._isNullObject) return true;
    for (var i = 0; i < objectPathParents.length; i++) {
      var parent = object[objectPathParents[i]];
      if (parent instanceof ClientObject && hasFailedObjectPathParent(parent, seen)) return true;
    }
    return false;
  }

  Object.defineProperty(ClientObject.prototype, "isNullObject", {
    get: function () {
      if (!this._loaded.isNullObject) {
        // Workbook and a few collection proxies are materialized locally and
        // have no host binding operation.  Once a successful sync has passed,
        // those ordinary (non-OrNullObject) proxies are known to be present.
        // A proxy involved in a failed/pending object path remains unloaded.
        if (
          this.context._syncCount > this._createdAtSync &&
          !hasFailedObjectPathParent(this)
        ) {
          return false;
        }
        throw propertyNotLoaded("isNullObject");
      }
      return this._isNullObject;
    },
    configurable: true,
  });

  function combinedProperties(object, primary, additional) {
    var result = (object[primary] || []).slice();
    (object[additional] || []).forEach(function (name) {
      if (result.indexOf(name) < 0) result.push(name);
    });
    return result;
  }

  ClientObject.prototype.load = function (props) {
    var object = this;
    var scalar = [];
    var scalarProperties = combinedProperties(
      this,
      "_scalarProperties",
      "_additionalScalarProperties"
    );
    var navigationProperties = combinedProperties(
      this,
      "_navigationProperties",
      "_additionalNavigationProperties"
    );
    normalizeLoad(props, scalarProperties).forEach(function (path) {
      var slash = path.indexOf("/");
      var name = slash < 0 ? path : path.slice(0, slash);
      if (name === "items" && typeof object._hydrateItems === "function") {
        scalar.push(path);
      } else if (slash >= 0 || navigationProperties.indexOf(name) >= 0) {
        var child = object[name];
        if (!(child instanceof ClientObject)) {
          throw new RichApiError({ code: "InvalidArgument", message: "Unknown navigation property: " + name });
        }
        child.load(slash < 0 ? undefined : path.slice(slash + 1));
      } else scalar.push(path);
    });
    if (scalar.length) this.context._queue.push({ op: "load", id: this._id, properties: scalar });
    return this;
  };

  function ClientRequestContext() {
    this._queue = [];
    this._objects = Object.create(null);
    this._results = Object.create(null);
    this._syncCount = 0;
    this.trackedObjects = new TrackedObjects(this);
  }

  function RequestContext() {
    ClientRequestContext.call(this);
    this.workbook = new Workbook(this);
  }
  RequestContext.prototype = Object.create(ClientRequestContext.prototype);
  RequestContext.prototype.constructor = RequestContext;

  ClientRequestContext.prototype.load = function (object, props) {
    if (!(object instanceof ClientObject) || object.context !== this) {
      throw new RichApiError({ code: "InvalidRequestContext", message: "Object belongs to a different request context." });
    }
    object.load(props);
  };

  ClientRequestContext.prototype.loadRecursive = function (object, options, maxDepth) {
    // Office.js validates the recursive query map before creating its action.
    // Keep the same order so malformed options fail synchronously and do not
    // leave a partially queued request behind.
    if (!isPlainObject(options)) {
      throw invalidContextArgument(
        "The options argument to loadRecursive must be a plain object.",
        "ClientRequestContext.loadRecursive"
      );
    }
    var queries = {};
    Object.keys(options).forEach(function (typeName) {
      queries[typeName] = parseQueryOption(
        options[typeName],
        "options." + typeName
      );
    });
    if (!(object instanceof ClientObject) || object.context !== this) {
      throw new RichApiError({
        code: "InvalidRequestContext",
        message: "The object belongs to a different request context.",
        debugInfo: { errorLocation: "ClientRequestContext.loadRecursive" },
      });
    }
    var operation = {
      op: "loadRecursive",
      id: object._id,
      queries: queries,
    };
    // The embedded host keeps proxy IDs separate from its object paths.  Give
    // the host the already-materialized navigation proxies it can hydrate;
    // this is a bounded hint, not a client-side recursive walk.  The host
    // still owns graph discovery and maxDepth for paths that are not cached.
    var targets = {};
    function addTarget(target) {
      if (!(target instanceof ClientObject)) return;
      var typeName = target._officeType ||
        (target.constructor && target.constructor.name);
      if (!typeName) return;
      if (!targets[typeName]) targets[typeName] = [];
      if (!targets[typeName].some(function (entry) { return entry.id === target._id; })) {
        targets[typeName].push({ id: target._id, depth: target === object ? 0 : 1 });
      }
    }
    addTarget(object);
    Object.keys(object).forEach(function (key) {
      if (key.charAt(0) !== "_") return;
      addTarget(object[key]);
    });
    if (Object.keys(targets).length) operation.targets = targets;
    // `queries` mirrors the source action's RecursiveQueryInfo.Queries using
    // normalized Select/Expand/Top/Skip keys.  The host must apply this
    // action against the object graph and enforce maxDepth; the client must
    // not eagerly walk navigation properties and accidentally recurse forever.
    // An omitted maxDepth is distinct from a supplied value.
    if (maxDepth !== undefined) operation.maxDepth = maxDepth;
    this._queue.push(operation);
  };

  ClientRequestContext.prototype.trace = function (message) {
    // Trace is an ordered request action.  The host must process this entry
    // in sequence and return only messages before a failed later action as
    // result.error.traceMessages; logging here would lose that timing.
    this._queue.push({ op: "trace", message: message });
  };

  function debugStatement(operation) {
    if (!operation || !operation.op) return "";
    switch (operation.op) {
      case "trace":
        return "context.trace();";
      case "loadRecursive":
        return "object.loadRecursive(...);";
      case "load":
        return "object.load(...);";
      case "set":
        return "object." + String(operation.property || "property") + " = ...;";
      default:
        return "context." + String(operation.op) + "(...);";
    }
  }

  Object.defineProperty(ClientRequestContext.prototype, "debugInfo", {
    get: function () {
      return {
        pendingStatements: this._queue.map(debugStatement).filter(Boolean),
      };
    },
    enumerable: true,
    configurable: true,
  });

  ClientRequestContext.prototype.sync = async function (passThroughValue) {
    var ops = this._queue.splice(0, this._queue.length);
    ops.forEach(function (op) {
      if (!op || !op.id) return;
      var object = this._objects[op.id];
      if (object && !object._loaded.isNullObject) object._bindingPending = true;
    }, this);
    var raw = __mogApply(JSON.stringify(ops));
    var result = JSON.parse(raw);
    if (result.error) {
      ops.forEach(function (op) {
        if (!op || !op.id) return;
        var object = this._objects[op.id];
        if (object && object._bindingPending) object._bindingFailed = true;
      }, this);
      var error = Object.assign({}, result.error);
      // The extension host may return response diagnostics at the batch
      // level, while the Office.js error surface exposes them on Error.
      // Preserve either wire shape without synthesizing trace timing locally.
      if (error.traceMessages === undefined && result.traceMessages !== undefined) {
        error.traceMessages = result.traceMessages;
      }
      if (error.debugInfo === undefined && result.debugInfo !== undefined) {
        error.debugInfo = result.debugInfo;
      }
      throw new RichApiError(error);
    }
    var loaded = result.loaded || {};
    var id;
    for (id in loaded) {
      if (!Object.prototype.hasOwnProperty.call(loaded, id)) continue;
      var obj = this._objects[id];
      if (!obj) continue;
      obj._bindingPending = false;
      obj._bindingFailed = false;
      var props = loaded[id];
      var key;
      for (key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        hydrateProperty(obj, key, props[key]);
      }
    }
    var results = result.results || {};
    for (id in results) {
      if (!Object.prototype.hasOwnProperty.call(results, id)) continue;
      var clientResult = this._results[id];
      if (clientResult) clientResult._handleResult(results[id]);
    }
    this._syncCount += 1;
    return passThroughValue;
  };

  function ClientResult(context) {
    this.context = context;
    this._isLoaded = false;
    if (context) {
      this._id = newId();
      context._results[this._id] = this;
    }
  }

  Object.defineProperty(ClientResult.prototype, "value", {
    get: function () {
      if (!this._isLoaded) {
        throw new RichApiError({
          code: "ValueNotLoaded",
          message:
            "The value of the result object has not been loaded yet. Before reading the value property, call \"context.sync()\" on the associated request context.",
          debugInfo: { errorLocation: "clientResult.value" },
        });
      }
      return this._value;
    },
    configurable: true,
  });

  ClientResult.prototype._handleResult = function (value) {
    this._isLoaded = true;
    this._value = value;
  };

  function hydrateProperty(object, name, value) {
    if (name === "items" && typeof object._hydrateItems === "function") {
      value = object._hydrateItems(value);
    }
    object._loaded[name] = true;
    object[name === "id" ? "_idValue" : "_" + name] = value;
  }

  function addProperties(prototype, field, names) {
    var current = Object.prototype.hasOwnProperty.call(prototype, field)
      ? prototype[field].slice()
      : [];
    names.forEach(function (name) {
      if (current.indexOf(name) < 0) current.push(name);
    });
    prototype[field] = current;
  }

  function configureCollection(collection, itemFactory) {
    if (!(collection instanceof ClientObject) || typeof itemFactory !== "function") {
      throw new TypeError("configureCollection requires a client object and item factory");
    }
    if ((collection._scalarProperties || []).indexOf("items") < 0) {
      collection._scalarProperties = (collection._scalarProperties || []).concat(["items"]);
    }
    collection._hydrateItems = function (descriptors) {
      if (!Array.isArray(descriptors)) {
        throw new RichApiError({
          code: "GeneralException",
          message: "The host returned an invalid collection result.",
        });
      }
      return descriptors.map(function (descriptor) {
        if (!descriptor || typeof descriptor !== "object" || !("key" in descriptor)) {
          throw new RichApiError({
            code: "GeneralException",
            message: "The host returned an invalid collection item descriptor.",
          });
        }
        var item = itemFactory.call(collection, descriptor.key, descriptor);
        if (!(item instanceof ClientObject) || item.context !== collection.context) {
          throw new RichApiError({
            code: "InvalidRequestContext",
            message: "A collection item factory returned an object from a different request context.",
          });
        }
        var properties = descriptor.properties || {};
        Object.keys(properties).forEach(function (name) {
          hydrateProperty(item, name, properties[name]);
        });
        return item;
      });
    };
    if (!("items" in collection)) {
      Object.defineProperty(collection, "items", {
        get: function () {
          if (!this._loaded.items) throw propertyNotLoaded("items");
          return this._items;
        },
        configurable: true,
      });
    }
    return collection;
  }

  function Workbook(context) {
    ClientObject.call(this, context);
    this.worksheets = new WorksheetCollection(context);
  }
  Workbook.prototype = Object.create(ClientObject.prototype);
  Workbook.prototype.constructor = Workbook;

  function WorksheetCollection(context) {
    ClientObject.call(this, context);
  }
  WorksheetCollection.prototype = Object.create(ClientObject.prototype);
  WorksheetCollection.prototype.constructor = WorksheetCollection;

  WorksheetCollection.prototype.getItem = function (name) {
    var ws = new Worksheet(this.context, String(name));
    this.context._queue.push({
      op: "getItem",
      id: ws._id,
      name: String(name),
    });
    return ws;
  };

  WorksheetCollection.prototype.getActiveWorksheet = function () {
    var ws = new Worksheet(this.context, null);
    this.context._queue.push({ op: "getActiveWorksheet", id: ws._id });
    return ws;
  };

  WorksheetCollection.prototype.add = function (name) {
    var ws = new Worksheet(this.context, name == null ? null : String(name));
    this.context._queue.push({
      op: "addWorksheet",
      id: ws._id,
      name: name == null ? null : String(name),
    });
    return ws;
  };

  function Worksheet(context, name) {
    ClientObject.call(this, context);
    this._nameHint = name;
    this._scalarProperties = ["name", "id"];
  }
  Worksheet.prototype = Object.create(ClientObject.prototype);
  Worksheet.prototype.constructor = Worksheet;

  Object.defineProperty(Worksheet.prototype, "name", {
    get: function () {
      if (!this._loaded.name) {
        throw propertyNotLoaded("name");
      }
      return this._name;
    },
    configurable: true,
  });

  Object.defineProperty(Worksheet.prototype, "id", {
    get: function () {
      if (!this._loaded.id) throw propertyNotLoaded("id");
      return this._idValue;
    },
  });

  Worksheet.prototype.getRange = function (address) {
    var range = new Range(this.context, this, address === undefined ? null : String(address));
    this.context._queue.push({
      op: "getRange",
      id: range._id,
      worksheetId: this._id,
      address: address === undefined ? null : String(address),
    });
    return range;
  };

  function Range(context, worksheet, address) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._address = address;
    this._requiresReferenceTracking = true;
    this._scalarProperties = ["values", "formulas", "address", "rowIndex", "columnIndex", "rowCount", "columnCount", "cellCount"];
    this._navigationProperties = ["format"];
  }
  Range.prototype = Object.create(ClientObject.prototype);
  Range.prototype.constructor = Range;

  // The pinned Excel declarations expose these shorthands on Range (and
  // range-area types), while the OfficeExtension.ClientObject declaration
  // does not.  The method shape is present, but this runtime rejects it until
  // reference IDs and restorable object paths are implemented.
  Range.prototype.track = function () {
    return trackClientObject(this);
  };

  Range.prototype.untrack = function () {
    return untrackClientObject(this);
  };

  ["address", "rowIndex", "columnIndex", "rowCount", "columnCount", "cellCount"].forEach(function (name) {
    Object.defineProperty(Range.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  });

  Object.defineProperty(Range.prototype, "values", {
    get: function () {
      if (!this._loaded.values) {
        throw propertyNotLoaded("values");
      }
      return this._values;
    },
    set: function (value) {
      this._values = value;
      this._loaded.values = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "values",
        value: value,
      });
    },
  });

  Object.defineProperty(Range.prototype, "formulas", {
    get: function () {
      if (!this._loaded.formulas) {
        throw propertyNotLoaded("formulas");
      }
      return this._formulas;
    },
    set: function (value) {
      this._formulas = value;
      this._loaded.formulas = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "formulas",
        value: value,
      });
    },
  });

  function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function runArgumentError(code, message) {
    return new RichApiError({
      code: code,
      message: message,
      debugInfo: { errorLocation: "Excel.run" },
    });
  }

  function contextFromPrevious(previous) {
    if (previous instanceof ClientRequestContext) return previous;
    if (previous instanceof ClientObject) return previous.context;
    if (!Array.isArray(previous) || previous.length === 0) {
      throw runArgumentError(
        "InvalidArgument",
        "The argument passed to Excel.run is missing or isn't in the right format."
      );
    }

    var context;
    previous.forEach(function (object, index) {
      if (!(object instanceof ClientObject)) {
        throw runArgumentError(
          "InvalidArgument",
          "The objects passed to Excel.run must be OfficeExtension.ClientObject instances."
        );
      }
      if (index === 0) context = object.context;
      else if (object.context !== context) {
        throw runArgumentError(
          "InvalidRequestContext",
          "Cannot use objects from different request contexts in the same Excel.run batch."
        );
      }
    });
    return context;
  }

  function parseRunArguments(args) {
    if (args.length === 1 && typeof args[0] === "function") {
      return { context: new RequestContext(), callback: args[0] };
    }
    if (args.length !== 2 || typeof args[1] !== "function") {
      throw runArgumentError(
        "InvalidArgument",
        "The arguments passed to Excel.run are missing or aren't in the right format."
      );
    }

    var previousOrOptions = args[0];
    if (
      previousOrOptions instanceof ClientRequestContext ||
      previousOrOptions instanceof ClientObject ||
      Array.isArray(previousOrOptions)
    ) {
      return {
        context: contextFromPrevious(previousOrOptions),
        callback: args[1],
      };
    }
    if (!isPlainObject(previousOrOptions)) {
      throw runArgumentError(
        "InvalidArgument",
        "The first argument passed to Excel.run isn't a context, client object, object array, or options object."
      );
    }
    if (previousOrOptions.session != null) {
      throw runArgumentError(
        "ApiNotFound",
        "Remote workbook sessions aren't supported by this host."
      );
    }
    return {
      context:
        previousOrOptions.previousObjects == null
          ? new RequestContext()
          : contextFromPrevious(previousOrOptions.previousObjects),
      callback: args[1],
    };
  }

  function run() {
    var args = Array.prototype.slice.call(arguments);
    return (async function () {
      var parsed = parseRunArguments(args);
      var callbackResult = parsed.callback(parsed.context);
      if (!callbackResult || typeof callbackResult.then !== "function") {
        throw runArgumentError(
          "RunMustReturnPromise",
          "The batch function passed to the \".run\" method didn't return a promise."
        );
      }
      var result = await callbackResult;
      await parsed.context.sync();
      return result;
    })();
  }

  global.Excel = { run: run, RequestContext: RequestContext, Workbook: Workbook,
    WorksheetCollection: WorksheetCollection, Worksheet: Worksheet, Range: Range };
  global.OfficeExtension = {
    ClientObject: ClientObject,
    ClientRequestContext: ClientRequestContext,
    ClientResult: ClientResult,
    TrackedObjects: TrackedObjects,
    Error: RichApiError,
  };
  global.__mogOfficeJs = {
    addScalarProperties: function (prototype, names) {
      addProperties(prototype, "_additionalScalarProperties", names);
    },
    addNavigationProperties: function (prototype, names) {
      addProperties(prototype, "_additionalNavigationProperties", names);
    },
    configureCollection: configureCollection,
    createClientResult: function (context) {
      return new ClientResult(context);
    },
    hydrateProperty: hydrateProperty,
  };
})(globalThis);
