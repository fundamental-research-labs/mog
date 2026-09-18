(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;
  var RichApiError = global.OfficeExtension.Error;

  function FunctionResult(context) {
    ClientObject.call(this, context);
    this._scalarProperties = ["value", "error"];
  }
  FunctionResult.prototype = Object.create(ClientObject.prototype);
  FunctionResult.prototype.constructor = FunctionResult;
  ["value", "error"].forEach(function (name) {
    Object.defineProperty(FunctionResult.prototype, name, {
      get: function () {
        if (!this._loaded[name]) {
          throw new RichApiError({ code: "PropertyNotLoaded", message: "Load FunctionResult." + name + " and call context.sync() before reading it." });
        }
        return this["_" + name];
      },
    });
  });
  FunctionResult.prototype.toJSON = function () {
    var result = {};
    var object = this;
    this._scalarProperties.forEach(function (name) {
      if (object._loaded[name]) result[name] = object["_" + name];
    });
    return result;
  };

  function Functions(context) {
    ClientObject.call(this, context);
  }
  Functions.prototype = Object.create(ClientObject.prototype);
  Functions.prototype.constructor = Functions;

  // Serialize arguments at call time, while resolving live ranges in queue
  // order on the host. Strings are always literals, never formula fragments.
  function argument(value, context) {
    if (value instanceof Excel.Range || value instanceof FunctionResult) {
      if (value.context !== context) {
        throw new RichApiError({ code: "InvalidRequestContext", message: "Function arguments must belong to the same request context." });
      }
      return value instanceof Excel.Range ? { rangeId: value._id } : { resultId: value._id };
    }
    if (value == null) return null;
    if (Array.isArray(value)) return value.map(function (v) { return argument(v, context); });
    if (typeof value === "string" || typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value === "object" && typeof value.address === "string") return { address: value.address };
    throw new RichApiError({ code: "InvalidArgument", message: "Invalid Excel function argument." });
  }

  function invoke(functions, name, args) {
    var context = functions.context;
    var values = Array.prototype.map.call(args, function (value) { return argument(value, context); });
    // Omitted optional parameters use the evaluator's normal defaults.
    while (values.length && values[values.length - 1] === null) values.pop();
    var sheet = context.workbook.worksheets.getActiveWorksheet();
    var result = new FunctionResult(context);
    context._queue.push({ op: "functionEvaluate", id: result._id, worksheetId: sheet._id, name: name, args: values });
    return result;
  }

  // Thin Office.js entry points share argument translation and evaluation.
  // Keep the public spellings explicit for the API coverage scanner.
  Functions.prototype.abs = function () { return invoke(this, "ABS", arguments); };
  Functions.prototype.acos = function () { return invoke(this, "ACOS", arguments); };
  Functions.prototype.acosh = function () { return invoke(this, "ACOSH", arguments); };
  Functions.prototype.asin = function () { return invoke(this, "ASIN", arguments); };
  Functions.prototype.asinh = function () { return invoke(this, "ASINH", arguments); };
  Functions.prototype.atan = function () { return invoke(this, "ATAN", arguments); };
  Functions.prototype.atan2 = function () { return invoke(this, "ATAN2", arguments); };
  Functions.prototype.atanh = function () { return invoke(this, "ATANH", arguments); };
  Functions.prototype.cos = function () { return invoke(this, "COS", arguments); };
  Functions.prototype.cosh = function () { return invoke(this, "COSH", arguments); };
  Functions.prototype.sin = function () { return invoke(this, "SIN", arguments); };
  Functions.prototype.sinh = function () { return invoke(this, "SINH", arguments); };
  Functions.prototype.tan = function () { return invoke(this, "TAN", arguments); };
  Functions.prototype.tanh = function () { return invoke(this, "TANH", arguments); };
  Functions.prototype.degrees = function () { return invoke(this, "DEGREES", arguments); };
  Functions.prototype.radians = function () { return invoke(this, "RADIANS", arguments); };
  Functions.prototype.exp = function () { return invoke(this, "EXP", arguments); };
  Functions.prototype.ln = function () { return invoke(this, "LN", arguments); };
  Functions.prototype.log = function () { return invoke(this, "LOG", arguments); };
  Functions.prototype.log10 = function () { return invoke(this, "LOG10", arguments); };
  Functions.prototype.pi = function () { return invoke(this, "PI", arguments); };
  Functions.prototype.power = function () { return invoke(this, "POWER", arguments); };
  Functions.prototype.sqrt = function () { return invoke(this, "SQRT", arguments); };
  Functions.prototype.sqrtPi = function () { return invoke(this, "SQRTPI", arguments); };
  Functions.prototype.sign = function () { return invoke(this, "SIGN", arguments); };
  Functions.prototype.int = function () { return invoke(this, "INT", arguments); };
  Functions.prototype.trunc = function () { return invoke(this, "TRUNC", arguments); };
  Functions.prototype.round = function () { return invoke(this, "ROUND", arguments); };
  Functions.prototype.roundUp = function () { return invoke(this, "ROUNDUP", arguments); };
  Functions.prototype.roundDown = function () { return invoke(this, "ROUNDDOWN", arguments); };
  Functions.prototype.mod = function () { return invoke(this, "MOD", arguments); };
  Functions.prototype.quotient = function () { return invoke(this, "QUOTIENT", arguments); };
  Functions.prototype.product = function () { return invoke(this, "PRODUCT", arguments); };
  Functions.prototype.sum = function () { return invoke(this, "SUM", arguments); };
  Functions.prototype.sumSq = function () { return invoke(this, "SUMSQ", arguments); };
  Functions.prototype.average = function () { return invoke(this, "AVERAGE", arguments); };
  Functions.prototype.min = function () { return invoke(this, "MIN", arguments); };
  Functions.prototype.max = function () { return invoke(this, "MAX", arguments); };
  Functions.prototype.median = function () { return invoke(this, "MEDIAN", arguments); };
  Functions.prototype.count = function () { return invoke(this, "COUNT", arguments); };
  Functions.prototype.countA = function () { return invoke(this, "COUNTA", arguments); };
  Functions.prototype.len = function () { return invoke(this, "LEN", arguments); };
  Functions.prototype.left = function () { return invoke(this, "LEFT", arguments); };
  Functions.prototype.right = function () { return invoke(this, "RIGHT", arguments); };
  Functions.prototype.mid = function () { return invoke(this, "MID", arguments); };
  Functions.prototype.lower = function () { return invoke(this, "LOWER", arguments); };
  Functions.prototype.upper = function () { return invoke(this, "UPPER", arguments); };
  Functions.prototype.trim = function () { return invoke(this, "TRIM", arguments); };
  Functions.prototype.concatenate = function () { return invoke(this, "CONCATENATE", arguments); };
  Functions.prototype.exact = function () { return invoke(this, "EXACT", arguments); };

  Object.defineProperty(Excel.Workbook.prototype, "functions", {
    get: function () {
      if (!this._functions) this._functions = new Functions(this.context);
      return this._functions;
    },
  });
  global.__mogOfficeJs.addNavigationProperties(Excel.Workbook.prototype, ["functions"]);
  Excel.Functions = Functions;
  Excel.FunctionResult = FunctionResult;
})(globalThis);
