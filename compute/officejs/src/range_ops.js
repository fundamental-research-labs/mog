(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;

  function invalidRequestContext() {
    return new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  Excel.Range.prototype.merge = function (across) {
    this.context._queue.push({
      op: "rangeMerge",
      rangeId: this._id,
      across: across === true,
    });
  };

  Excel.Range.prototype.unmerge = function () {
    this.context._queue.push({
      op: "rangeUnmerge",
      rangeId: this._id,
    });
  };

  Excel.Range.prototype.insert = function (shift) {
    this.context._queue.push({
      op: "rangeInsert",
      rangeId: this._id,
      shift: shift == null ? "Down" : String(shift),
    });
  };

  Excel.Range.prototype.delete = function (shift) {
    this.context._queue.push({
      op: "rangeDelete",
      rangeId: this._id,
      shift: shift == null ? "Up" : String(shift),
    });
  };

  Excel.Range.prototype.copyFrom = function (sourceRange, copyType, skipBlanks, transpose) {
    var sourceId = null;
    var sourceAddress = null;
    if (sourceRange instanceof Excel.Range) {
      if (sourceRange.context !== this.context) throw invalidRequestContext();
      sourceId = sourceRange._id;
    } else {
      sourceAddress = String(sourceRange);
    }
    this.context._queue.push({
      op: "rangeCopyFrom",
      rangeId: this._id,
      sourceRangeId: sourceId,
      sourceAddress: sourceAddress,
      copyType: copyType == null ? "All" : String(copyType),
      skipBlanks: skipBlanks === true,
      transpose: transpose === true,
    });
  };

  ["rowHidden", "columnHidden"].forEach(function (name) {
    Object.defineProperty(Excel.Range.prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) {
          throw new OfficeExtension.Error({
            code: "PropertyNotLoaded",
            message: "The range property has not been loaded: " + name,
          });
        }
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
  });

  Object.defineProperty(Excel.Range.prototype, "style", {
    configurable: true,
    get: function () {
      if (!this._loaded.style) {
        throw new OfficeExtension.Error({
          code: "PropertyNotLoaded",
          message: "The range property has not been loaded: style",
        });
      }
      return this._style;
    },
    set: function (value) {
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

  Object.defineProperty(Excel.Range.prototype, "hyperlink", {
    configurable: true,
    get: function () {
      if (!this._loaded.hyperlink) {
        throw new OfficeExtension.Error({
          code: "PropertyNotLoaded",
          message: "The range property has not been loaded: hyperlink",
        });
      }
      return this._hyperlink;
    },
    set: function (value) {
      this._hyperlink = value;
      this._loaded.hyperlink = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "hyperlink",
        value: value,
      });
    },
  });
})(globalThis);
