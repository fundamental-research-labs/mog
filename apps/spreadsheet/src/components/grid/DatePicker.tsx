import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { DateValidationBounds } from '../../domain/date-picker/eligibility';

export interface DatePickerProps {
  currentValue: string;
  onSelect: (isoDate: string, direction: 'up' | 'down' | 'left' | 'right' | 'none') => void;
  onCancel?: () => void;
  isOpen: boolean;
  width: number;
  todayIso: string;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  validationBounds?: DateValidationBounds | null;
}

interface CalendarState {
  viewMonth: number;
  viewYear: number;
  focusedDay: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(
  iso: string | null | undefined,
): { year: number; month: number; day: number } | null {
  const match = iso ? ISO_RE.exec(iso) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2
    ? isLeap(year)
      ? 29
      : 28
    : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function dayOfWeek(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;
}

function addDays(year: number, month: number, day: number, delta: number) {
  let y = year;
  let m = month;
  let d = day + delta;
  while (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d += daysInMonth(y, m);
  }
  while (d > daysInMonth(y, m)) {
    d -= daysInMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { year: y, month: m, day: d };
}

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isBlocked(iso: string, bounds: DateValidationBounds | null | undefined): boolean {
  if (!bounds || bounds.unsupportedFormulaBound || bounds.strictness !== 'stop') return false;
  if (bounds.equalIso) return iso !== bounds.equalIso;
  if (bounds.notEqualIso) return iso === bounds.notEqualIso;
  if (bounds.operator === 'between') {
    return Boolean(
      (bounds.lower &&
        (bounds.lower.inclusive
          ? compareIso(iso, bounds.lower.iso) < 0
          : compareIso(iso, bounds.lower.iso) <= 0)) ||
      (bounds.upper &&
        (bounds.upper.inclusive
          ? compareIso(iso, bounds.upper.iso) > 0
          : compareIso(iso, bounds.upper.iso) >= 0)),
    );
  }
  if (bounds.operator === 'notBetween' && bounds.lower && bounds.upper) {
    return compareIso(iso, bounds.lower.iso) >= 0 && compareIso(iso, bounds.upper.iso) <= 0;
  }
  if (bounds.lower) {
    const cmp = compareIso(iso, bounds.lower.iso);
    if (cmp < 0 || (!bounds.lower.inclusive && cmp === 0)) return true;
  }
  if (bounds.upper) {
    const cmp = compareIso(iso, bounds.upper.iso);
    if (cmp > 0 || (!bounds.upper.inclusive && cmp === 0)) return true;
  }
  return false;
}

export function DatePicker({
  currentValue,
  onSelect,
  onCancel,
  isOpen,
  width,
  todayIso,
  locale = 'en-US',
  dir = 'ltr',
  validationBounds = null,
}: DatePickerProps) {
  const selected = useMemo(() => parseIso(currentValue), [currentValue]);
  const today = useMemo(() => parseIso(todayIso) ?? { year: 2026, month: 1, day: 1 }, [todayIso]);
  const initial = selected ?? today;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<CalendarState>({
    viewMonth: initial.month,
    viewYear: initial.year,
    focusedDay: initial.day,
  });

  useEffect(() => {
    if (isOpen) rootRef.current?.focus();
  }, [isOpen]);

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    [locale],
  );

  const firstDay = 0;
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        weekdayFormatter.format(new Date(Date.UTC(2024, 0, 7 + ((i + firstDay) % 7)))),
      ),
    [weekdayFormatter],
  );

  const calendarDays = useMemo(() => {
    const dim = daysInMonth(state.viewYear, state.viewMonth);
    const offset = (dayOfWeek(state.viewYear, state.viewMonth, 1) - firstDay + 7) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      return day >= 1 && day <= dim ? day : null;
    });
  }, [state.viewYear, state.viewMonth]);

  const moveFocus = useCallback((delta: number) => {
    setState((s) => {
      const next = addDays(s.viewYear, s.viewMonth, s.focusedDay, delta);
      return { viewYear: next.year, viewMonth: next.month, focusedDay: next.day };
    });
  }, []);

  const moveMonth = useCallback((delta: number) => {
    setState((s) => {
      let year = s.viewYear;
      let month = s.viewMonth + delta;
      while (month < 1) {
        month += 12;
        year -= 1;
      }
      while (month > 12) {
        month -= 12;
        year += 1;
      }
      return {
        viewYear: year,
        viewMonth: month,
        focusedDay: Math.min(s.focusedDay, daysInMonth(year, month)),
      };
    });
  }, []);

  const commit = useCallback(
    (day: number, direction: 'up' | 'down' | 'left' | 'right' | 'none') => {
      const iso = toIso(state.viewYear, state.viewMonth, day);
      if (!isBlocked(iso, validationBounds)) onSelect(iso, direction);
    },
    [onSelect, state.viewMonth, state.viewYear, validationBounds],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          moveFocus(dir === 'rtl' ? 1 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveFocus(dir === 'rtl' ? -1 : 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-7);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(7);
          break;
        case 'Home':
          e.preventDefault();
          if (e.ctrlKey) setState((s) => ({ ...s, focusedDay: 1 }));
          else moveFocus(-dayOfWeek(state.viewYear, state.viewMonth, state.focusedDay));
          break;
        case 'End':
          e.preventDefault();
          if (e.ctrlKey)
            setState((s) => ({ ...s, focusedDay: daysInMonth(s.viewYear, s.viewMonth) }));
          else moveFocus(6 - dayOfWeek(state.viewYear, state.viewMonth, state.focusedDay));
          break;
        case 'PageUp':
          e.preventDefault();
          moveMonth(e.shiftKey ? -12 : -1);
          break;
        case 'PageDown':
          e.preventDefault();
          moveMonth(e.shiftKey ? 12 : 1);
          break;
        case 'Enter':
          e.preventDefault();
          commit(state.focusedDay, e.shiftKey ? 'up' : 'down');
          break;
        case 'Tab':
          e.preventDefault();
          commit(state.focusedDay, e.shiftKey ? 'left' : 'right');
          break;
        case 'Escape':
          e.preventDefault();
          onCancel?.();
          break;
      }
    },
    [
      commit,
      dir,
      moveFocus,
      moveMonth,
      onCancel,
      state.focusedDay,
      state.viewMonth,
      state.viewYear,
    ],
  );

  if (!isOpen) return null;

  const monthLabel = monthFormatter.format(
    new Date(Date.UTC(state.viewYear, state.viewMonth - 1, 1)),
  );
  const selectedIso = selected ? toIso(selected.year, selected.month, selected.day) : null;

  return (
    <div
      ref={rootRef}
      data-date-picker
      role="dialog"
      aria-label="Date picker"
      className="p-2 bg-ss-surface text-ss-text-primary"
      style={{ minWidth: Math.max(width, 248) }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      dir={dir}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          className="p-1 hover:bg-ss-surface-hover rounded text-ss-text-secondary"
          onClick={() => moveMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div
          id="date-picker-month"
          className="text-dropdown font-medium text-text"
          aria-live="polite"
        >
          {monthLabel}
        </div>
        <button
          type="button"
          className="p-1 hover:bg-ss-surface-hover rounded text-ss-text-secondary"
          onClick={() => moveMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0 mb-1" role="row">
        {weekdays.map((day) => (
          <div
            key={day}
            role="columnheader"
            className="text-center text-hint font-medium text-ss-text-tertiary py-1"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0" role="grid" aria-labelledby="date-picker-month">
        {calendarDays.map((day, index) => {
          if (day === null)
            return <div key={`empty-${index}`} className="w-8 h-8" role="gridcell" />;
          const iso = toIso(state.viewYear, state.viewMonth, day);
          const blocked = isBlocked(iso, validationBounds);
          const isSelected = iso === selectedIso;
          const isToday = iso === todayIso;
          const isFocused = day === state.focusedDay;
          return (
            <button
              key={iso}
              type="button"
              className={`w-8 h-8 text-dropdown rounded-full flex items-center justify-center transition-colors ${
                blocked
                  ? 'text-ss-text-disabled cursor-not-allowed line-through'
                  : 'cursor-pointer hover:bg-ss-surface-secondary'
              } ${isFocused && !isSelected ? 'bg-ss-primary-light' : ''} ${
                isSelected
                  ? 'bg-ss-primary text-ss-text-inverse hover:bg-ss-primary-hover'
                  : 'text-text'
              } ${isToday && !isSelected ? 'ring-1 ring-border-focus' : ''}`}
              disabled={blocked}
              onClick={() => commit(day, 'down')}
              onMouseEnter={() => setState((s) => ({ ...s, focusedDay: day }))}
              role="gridcell"
              tabIndex={isFocused ? 0 : -1}
              aria-selected={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-disabled={blocked}
              aria-label={iso}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-ss-border-light">
        <button
          type="button"
          className="w-full text-dropdown text-ss-primary hover:text-ss-primary-hover hover:bg-ss-primary-lighter py-1 rounded disabled:text-ss-text-disabled disabled:hover:bg-transparent"
          disabled={isBlocked(todayIso, validationBounds)}
          onClick={() => onSelect(todayIso, 'down')}
        >
          Today
        </button>
      </div>
    </div>
  );
}
