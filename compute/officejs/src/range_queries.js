(function (global) {
  "use strict";
  var Excel = global.Excel;
  function request(source, method, args, nullable, clientResult) {
    var worksheet = source instanceof Excel.Worksheet;
    var result = clientResult ? global.__mogOfficeJs.createClientResult(source.context) : new Excel.Range(source.context, worksheet ? source : source._worksheet, null);
    source.context._queue.push({ op: "rangeQuery", method: method, args: args, nullable: nullable, id: result._id,
      rangeId: worksheet ? undefined : source._id, worksheetId: worksheet ? source._id : undefined });
    return result;
  }
  Excel.Range.prototype.getUsedRange = function (valuesOnly) { return request(this, "used", [valuesOnly], false); };
  Excel.Range.prototype.getUsedRangeOrNullObject = function (valuesOnly) { return request(this, "used", [valuesOnly], true); };
  Excel.Worksheet.prototype.getUsedRange = function (valuesOnly) { return request(this, "used", [valuesOnly], false); };
  Excel.Worksheet.prototype.getUsedRangeOrNullObject = function (valuesOnly) { return request(this, "used", [valuesOnly], true); };
  Excel.Range.prototype.find = function (text, criteria) { return request(this, "find", [text, criteria], false); };
  Excel.Range.prototype.findOrNullObject = function (text, criteria) { return request(this, "find", [text, criteria], true); };
  Excel.Range.prototype.replaceAll = function (text, replacement, criteria) { return request(this, "replace", [text, replacement, criteria], false, true); };
  Excel.Worksheet.prototype.replaceAll = function (text, replacement, criteria) { return request(this, "replace", [text, replacement, criteria], false, true); };
  Excel.Range.prototype.getIntersectionOrNullObject = function (anotherRange) {
    if (anotherRange instanceof Excel.Range) {
      if (anotherRange.context !== this.context) throw new global.OfficeExtension.Error({ code: "InvalidRequestContext", message: "The range belongs to another context." });
      anotherRange = { rangeId: anotherRange._id };
    }
    return request(this, "intersection", [anotherRange], true);
  };
})(globalThis);
