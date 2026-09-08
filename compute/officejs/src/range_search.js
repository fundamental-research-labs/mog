(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var officeJs = global.__mogOfficeJs || {};

  function invalidArgument(message) {
    var error = new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function requireString(value, name) {
    if (typeof value !== "string") {
      throw invalidArgument(name + " must be a string");
    }
    return value;
  }

  function requireOptionalBoolean(value, name) {
    if (value !== undefined && value !== null && typeof value !== "boolean") {
      throw invalidArgument(name + " must be a boolean");
    }
    return value === true;
  }

  function criteriaObject(criteria, allowDirection) {
    if (criteria == null || typeof criteria !== "object" || Array.isArray(criteria)) {
      throw invalidArgument("Search criteria must be an object");
    }

    var completeMatch = criteria.completeMatch;
    var matchCase = criteria.matchCase;
    if (completeMatch !== undefined && typeof completeMatch !== "boolean") {
      throw invalidArgument("SearchCriteria.completeMatch must be a boolean");
    }
    if (matchCase !== undefined && typeof matchCase !== "boolean") {
      throw invalidArgument("SearchCriteria.matchCase must be a boolean");
    }

    var result = {
      completeMatch: completeMatch === true,
      matchCase: matchCase === true,
    };
    if (allowDirection) {
      var direction = criteria.searchDirection;
      if (direction !== undefined && direction !== "Forward" && direction !== "Backwards") {
        throw invalidArgument(
          "SearchCriteria.searchDirection must be 'Forward' or 'Backwards'"
        );
      }
      result.searchDirection = direction === "Backwards" ? "Backwards" : "Forward";
    }
    return result;
  }

  function cellValueType(value) {
    return value === undefined ? null : value;
  }

  // RangeAreas is supplied by the range-areas family.  Its constructor takes
  // the same context/worksheet/object-path shape as Range in this runtime;
  // the hook lets that family choose a richer constructor without making this
  // search adapter depend on its private implementation.
  function newRangeAreas(context, worksheet) {
    if (typeof officeJs.createRangeAreas === "function") {
      return officeJs.createRangeAreas(context, worksheet || null);
    }
    if (typeof Excel.RangeAreas !== "function") {
      throw invalidArgument("RangeAreas is not available in this host");
    }
    return new Excel.RangeAreas(context, worksheet || null, null);
  }

  function newRange(context, worksheet) {
    return new Excel.Range(context, worksheet || null, null);
  }

  function queueRangeSearch(source, method, args, orNullObject) {
    var result = newRange(source.context, source._worksheet);
    source.context._queue.push({
      op: "rangeSearch",
      id: result._id,
      rangeId: source._id,
      method: method,
      args: args || [],
      orNullObject: orNullObject === true,
    });
    return result;
  }

  function queueWorksheetSearch(source, method, args, orNullObject) {
    var result = newRange(source.context, source);
    source.context._queue.push({
      op: "worksheetSearch",
      id: result._id,
      worksheetId: source._id,
      method: method,
      args: args || [],
      orNullObject: orNullObject === true,
    });
    return result;
  }

  function queueRangeAreasSearch(source, method, args, orNullObject, isWorksheet) {
    var result = newRangeAreas(source.context, isWorksheet ? source : source._worksheet);
    source.context._queue.push({
      op: isWorksheet ? "worksheetRangeAreasSearch" : "rangeAreasSearch",
      id: result._id,
      rangeId: isWorksheet ? undefined : source._id,
      worksheetId: isWorksheet ? source._id : undefined,
      method: method,
      args: args || [],
      orNullObject: orNullObject === true,
    });
    return result;
  }

  function newClientResult(context) {
    if (typeof officeJs.createClientResult === "function") {
      return officeJs.createClientResult(context);
    }
    return new OfficeExtension.ClientResult(context);
  }

  function queueReplaceAll(source, text, replacement, criteria, isWorksheet) {
    var result = newClientResult(source.context);
    source.context._queue.push({
      op: isWorksheet ? "worksheetReplaceAll" : "rangeReplaceAll",
      resultId: result._id,
      rangeId: isWorksheet ? undefined : source._id,
      worksheetId: isWorksheet ? source._id : undefined,
      text: text,
      replacement: replacement,
      criteria: criteria,
    });
    return result;
  }

  function usedRange(source, valuesOnly, isWorksheet, orNullObject) {
    var values = requireOptionalBoolean(valuesOnly, "valuesOnly");
    var args = [values];
    if (isWorksheet) {
      return queueWorksheetSearch(source, "getUsedRange", args, orNullObject);
    }
    return queueRangeSearch(source, "getUsedRange", args, orNullObject);
  }

  // Worksheet search and used-range members.
  Excel.Worksheet.prototype.findAll = function (text, criteria) {
    return queueRangeAreasSearch(
      this,
      "findAll",
      [requireString(text, "Worksheet.findAll text"), criteriaObject(criteria, false)],
      false,
      true
    );
  };

  Excel.Worksheet.prototype.findAllOrNullObject = function (text, criteria) {
    return queueRangeAreasSearch(
      this,
      "findAll",
      [requireString(text, "Worksheet.findAllOrNullObject text"), criteriaObject(criteria, false)],
      true,
      true
    );
  };

  Excel.Worksheet.prototype.getUsedRange = function (valuesOnly) {
    return usedRange(this, valuesOnly, true, false);
  };

  Excel.Worksheet.prototype.getUsedRangeOrNullObject = function (valuesOnly) {
    return usedRange(this, valuesOnly, true, true);
  };

  Excel.Worksheet.prototype.replaceAll = function (text, replacement, criteria) {
    return queueReplaceAll(
      this,
      requireString(text, "Worksheet.replaceAll text"),
      requireString(replacement, "Worksheet.replaceAll replacement"),
      criteriaObject(criteria, false),
      true
    );
  };

  // Range search and used-range members.
  Excel.Range.prototype.find = function (text, criteria) {
    return queueRangeSearch(
      this,
      "find",
      [requireString(text, "Range.find text"), criteriaObject(criteria, true)],
      false
    );
  };

  Excel.Range.prototype.findOrNullObject = function (text, criteria) {
    return queueRangeSearch(
      this,
      "find",
      [requireString(text, "Range.findOrNullObject text"), criteriaObject(criteria, true)],
      true
    );
  };

  Excel.Range.prototype.getUsedRange = function (valuesOnly) {
    return usedRange(this, valuesOnly, false, false);
  };

  Excel.Range.prototype.getUsedRangeOrNullObject = function (valuesOnly) {
    return usedRange(this, valuesOnly, false, true);
  };

  Excel.Range.prototype.replaceAll = function (text, replacement, criteria) {
    return queueReplaceAll(
      this,
      requireString(text, "Range.replaceAll text"),
      requireString(replacement, "Range.replaceAll replacement"),
      criteriaObject(criteria, false),
      false
    );
  };

  function specialCells(source, cellType, cellValueTypeArg, orNullObject) {
    requireString(cellType, "Range.getSpecialCells cellType");
    if (cellValueTypeArg !== undefined && cellValueTypeArg !== null) {
      requireString(cellValueTypeArg, "Range.getSpecialCells cellValueType");
    }
    return queueRangeAreasSearch(
      source,
      "getSpecialCells",
      [cellType, cellValueType(cellValueTypeArg)],
      orNullObject,
      false
    );
  }

  Excel.Range.prototype.getSpecialCells = function (cellType, cellValueTypeArg) {
    return specialCells(this, cellType, cellValueTypeArg, false);
  };

  Excel.Range.prototype.getSpecialCellsOrNullObject = function (
    cellType,
    cellValueTypeArg
  ) {
    return specialCells(this, cellType, cellValueTypeArg, true);
  };
})(globalThis);
