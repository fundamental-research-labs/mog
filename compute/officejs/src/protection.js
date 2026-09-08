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

  function unsupported(message) {
    return richApiError("ApiNotFound", message);
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isPlainObject(value) {
    if (!isObject(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  var optionNames = [
    "allowAutoFilter",
    "allowDeleteColumns",
    "allowDeleteRows",
    "allowEditObjects",
    "allowEditScenarios",
    "allowFormatCells",
    "allowFormatColumns",
    "allowFormatRows",
    "allowInsertColumns",
    "allowInsertHyperlinks",
    "allowInsertRows",
    "allowPivotTables",
    "allowSort",
    "selectionMode",
  ];

  function normalizeOptions(value) {
    if (value === undefined) return null;
    if (!isPlainObject(value)) {
      throw invalidArgument("WorksheetProtection.protect options must be an object");
    }
    var result = {};
    Object.keys(value).forEach(function (name) {
      if (optionNames.indexOf(name) < 0) {
        throw invalidArgument(
          "Unsupported WorksheetProtectionOptions property '" + name + "'"
        );
      }
      if (value[name] === undefined) return;
      if (name === "selectionMode") {
        if (["Normal", "Unlocked", "None"].indexOf(value[name]) < 0) {
          throw invalidArgument(
            "WorksheetProtectionOptions.selectionMode must be Normal, Unlocked, or None"
          );
        }
      } else if (typeof value[name] !== "boolean") {
        throw invalidArgument(
          "WorksheetProtectionOptions." + name + " must be a boolean"
        );
      }
      result[name] = value[name];
    });
    return result;
  }

  function normalizePassword(value, member) {
    // Office's optional string arguments are commonly passed as null by
    // JavaScript callers. Treat null like an omitted password; the host only
    // receives the transient value and hashes it before invoking the engine.
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw invalidArgument(member + " password must be a string");
    }
    return value;
  }

  function newClientResult(context) {
    if (officeJs && typeof officeJs.createClientResult === "function") {
      return officeJs.createClientResult(context);
    }
    return new OfficeExtension.ClientResult(context);
  }

  var worksheetProtectionScalars = [
    "protected",
    "isPasswordProtected",
    "options",
    "savedOptions",
  ];

  function WorksheetProtection(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._scalarProperties = worksheetProtectionScalars.slice();
    this.context._queue.push({
      op: "getWorksheetProtection",
      id: this._id,
      worksheetId: worksheet._id,
    });
  }
  WorksheetProtection.prototype = Object.create(ClientObject.prototype);
  WorksheetProtection.prototype.constructor = WorksheetProtection;

  worksheetProtectionScalars.forEach(function (name) {
    Object.defineProperty(WorksheetProtection.prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  });

  ["canPauseProtection", "isPaused"].forEach(function (name) {
    Object.defineProperty(WorksheetProtection.prototype, name, {
      configurable: true,
      get: function () {
        throw unsupported(
          "WorksheetProtection." + name + " is unavailable because protection pause is not implemented"
        );
      },
    });
  });

  Object.defineProperty(WorksheetProtection.prototype, "allowEditRanges", {
    configurable: true,
    get: function () {
      throw unsupported(
        "WorksheetProtection.allowEditRanges is unavailable because allow-edit ranges are not implemented"
      );
    },
  });

  WorksheetProtection.prototype.protect = function (options, password) {
    if (typeof options === "string") {
      throw invalidArgument(
        "WorksheetProtection.protect expects options as its first argument and password as its second argument"
      );
    }
    var normalizedOptions = normalizeOptions(options);
    var normalizedPassword = normalizePassword(
      password,
      "WorksheetProtection.protect"
    );
    this.context._queue.push({
      op: "worksheetProtectionProtect",
      id: this._id,
      options: normalizedOptions,
      password: normalizedPassword,
    });
  };

  WorksheetProtection.prototype.unprotect = function (password) {
    var normalizedPassword = normalizePassword(
      password,
      "WorksheetProtection.unprotect"
    );
    this.context._queue.push({
      op: "worksheetProtectionUnprotect",
      id: this._id,
      password: normalizedPassword,
    });
  };

  WorksheetProtection.prototype.checkPassword = function (password) {
    var normalizedPassword = normalizePassword(
      password,
      "WorksheetProtection.checkPassword"
    );
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "worksheetProtectionCheckPassword",
      id: this._id,
      resultId: result._id,
      password: normalizedPassword,
    });
    return result;
  };

  WorksheetProtection.prototype.updateOptions = function (options) {
    if (options === undefined) {
      throw invalidArgument("WorksheetProtection.updateOptions requires options");
    }
    this.context._queue.push({
      op: "worksheetProtectionUpdateOptions",
      id: this._id,
      options: normalizeOptions(options),
    });
  };

  WorksheetProtection.prototype.pauseProtection = function () {
    throw unsupported(
      "WorksheetProtection.pauseProtection is unavailable because protection pause is not implemented"
    );
  };

  WorksheetProtection.prototype.resumeProtection = function () {
    throw unsupported(
      "WorksheetProtection.resumeProtection is unavailable because protection pause is not implemented"
    );
  };

  WorksheetProtection.prototype.setPassword = function () {
    throw unsupported(
      "WorksheetProtection.setPassword is unavailable because session-scoped protection pause is not implemented"
    );
  };

  WorksheetProtection.prototype.toJSON = function () {
    var result = {};
    worksheetProtectionScalars.forEach(function (name) {
      if (this._loaded[name]) result[name] = this["_" + name];
    }, this);
    return result;
  };

  function WorkbookProtection(context, workbook) {
    ClientObject.call(this, context);
    this._workbook = workbook;
    this._scalarProperties = ["protected"];
    this.context._queue.push({
      op: "getWorkbookProtection",
      id: this._id,
    });
  }
  WorkbookProtection.prototype = Object.create(ClientObject.prototype);
  WorkbookProtection.prototype.constructor = WorkbookProtection;

  Object.defineProperty(WorkbookProtection.prototype, "protected", {
    configurable: true,
    get: function () {
      if (!this._loaded.protected) throw propertyNotLoaded("protected");
      return this._protected;
    },
  });

  WorkbookProtection.prototype.protect = function (password) {
    var normalizedPassword = normalizePassword(
      password,
      "WorkbookProtection.protect"
    );
    this.context._queue.push({
      op: "workbookProtectionProtect",
      id: this._id,
      password: normalizedPassword,
    });
  };

  WorkbookProtection.prototype.unprotect = function (password) {
    var normalizedPassword = normalizePassword(
      password,
      "WorkbookProtection.unprotect"
    );
    this.context._queue.push({
      op: "workbookProtectionUnprotect",
      id: this._id,
      password: normalizedPassword,
    });
  };

  WorkbookProtection.prototype.toJSON = function () {
    return this._loaded.protected ? { protected: this._protected } : {};
  };

  function worksheetProtection(worksheet) {
    if (!worksheet._protection) {
      worksheet._protection = new WorksheetProtection(worksheet.context, worksheet);
    }
    return worksheet._protection;
  }

  function workbookProtection(workbook) {
    if (!workbook._protection) {
      workbook._protection = new WorkbookProtection(workbook.context, workbook);
    }
    return workbook._protection;
  }

  Object.defineProperty(Excel.Worksheet.prototype, "protection", {
    configurable: true,
    get: function () {
      return worksheetProtection(this);
    },
  });

  Object.defineProperty(Excel.Workbook.prototype, "protection", {
    configurable: true,
    get: function () {
      return workbookProtection(this);
    },
  });

  if (officeJs && officeJs.addNavigationProperties) {
    officeJs.addNavigationProperties(Excel.Worksheet.prototype, ["protection"]);
    officeJs.addNavigationProperties(Excel.Workbook.prototype, ["protection"]);
  }

  Excel.WorksheetProtection = WorksheetProtection;
  Excel.WorkbookProtection = WorkbookProtection;
})(globalThis);
