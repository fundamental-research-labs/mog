/**
 * Person Column Renderer
 *
 * Renders person/user values with support for:
 * - Avatar display
 * - Name display
 * - Multi-person selection
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type {
  CardFieldProps,
  ColumnEditorProps,
  ColumnRenderer,
  FormFieldProps,
  PersonInfo,
} from '../types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate initials from a name.
 */
function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generate a consistent color from a string (user ID or name).
 */
function getAvatarColor(id: string): string {
  const colors = [
    '#F44336',
    '#E91E63',
    '#9C27B0',
    '#673AB7',
    '#3F51B5',
    '#2196F3',
    '#03A9F4',
    '#00BCD4',
    '#009688',
    '#4CAF50',
    '#8BC34A',
    '#CDDC39',
    '#FFC107',
    '#FF9800',
    '#FF5722',
    '#795548',
  ];

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

// For demo purposes - in real app, this would come from a user service
function getPersonInfo(id: string): PersonInfo {
  return {
    id,
    name: id, // In real app, look up by ID
    email: `${id.toLowerCase().replace(/\s/g, '.')}@example.com`,
  };
}

// =============================================================================
// Avatar Component
// =============================================================================

const PersonAvatar: React.FC<{
  person: PersonInfo;
  size?: number;
  showName?: boolean;
}> = ({ person, size = 24, showName = true }) => {
  const initials = getInitials(person.name);
  const color = getAvatarColor(person.id);

  return (
    <span
      className="person-avatar"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
      title={person.email || person.name}
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt={person.name}
          className="rounded-full"
          style={{
            width: size,
            height: size,
            objectFit: 'cover',
          }}
        />
      ) : (
        <span
          className="rounded-full flex items-center justify-center"
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            color: 'white',
            fontSize: size * 0.4,
            fontWeight: 500,
          }}
        >
          {initials}
        </span>
      )}
      {showName && <span className="person-name">{person.name}</span>}
    </span>
  );
};

// =============================================================================
// Display Renderer
// =============================================================================

function renderPerson(value: string | string[] | null, _column: ColumnSchema): React.ReactNode {
  if (!value) {
    return null;
  }

  const ids = Array.isArray(value) ? value : [value];
  const people = ids.map(getPersonInfo);

  if (people.length === 0) {
    return null;
  }

  return (
    <span className="person-renderer flex gap-ss-2 flex-wrap">
      {people.map((person) => (
        <PersonAvatar key={person.id} person={person} size={24} showName />
      ))}
    </span>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const PersonEditor: React.FC<ColumnEditorProps<'person'>> = ({
  value,
  column: _column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMulti = Array.isArray(value);

  // Demo: would come from user service
  const availablePeople: PersonInfo[] = [
    { id: 'alice', name: 'Alice Smith' },
    { id: 'bob', name: 'Bob Johnson' },
    { id: 'carol', name: 'Carol Williams' },
    { id: 'dave', name: 'Dave Brown' },
    { id: 'eve', name: 'Eve Davis' },
  ];

  const filteredPeople = availablePeople.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSelect = useCallback(
    (personId: string) => {
      if (isMulti) {
        const currentIds = (value as string[]) || [];
        const newIds = currentIds.includes(personId)
          ? currentIds.filter((id) => id !== personId)
          : [...currentIds, personId];
        onChange(newIds.length > 0 ? newIds : null);
      } else {
        onChange(personId);
        onCommit();
      }
    },
    [value, isMulti, onChange, onCommit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && isMulti) {
        e.preventDefault();
        onCommit();
      }
    },
    [onCommit, onCancel, isMulti],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        setIsOpen(false);
        onCommit();
      }
    },
    [onCommit],
  );

  const selectedIds = isMulti ? (value as string[]) || [] : value ? [value as string] : [];

  return (
    <div
      ref={containerRef}
      className={`person-editor ${className}`}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search people..."
        disabled={disabled}
        className="rounded-ss"
        style={{
          width: '100%',
          padding: '8px',
          border: '1px solid #ddd',
        }}
      />

      {isOpen && (
        <div
          className="person-dropdown z-ss-modal rounded-ss shadow-ss-md mt-ss-1"
          style={{
            position: 'absolute',
            backgroundColor: 'white',
            border: '1px solid #ddd',
            maxHeight: '200px',
            overflow: 'auto',
            width: '100%',
          }}
        >
          {filteredPeople.map((person) => {
            const isSelected = selectedIds.includes(person.id);
            return (
              <div
                key={person.id}
                className={`person-option ${isSelected ? 'selected' : ''} px-ss-3 py-ss-2 flex items-center gap-ss-2`}
                onClick={() => handleSelect(person.id)}
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  backgroundColor: isSelected ? '#f0f0f0' : 'transparent',
                }}
              >
                {isMulti && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <PersonAvatar person={person} size={20} showName />
              </div>
            );
          })}
          {filteredPeople.length === 0 && (
            <div className="px-ss-3 py-ss-2 text-ss-text-tertiary">No people found</div>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const PersonCardField: React.FC<CardFieldProps<'person'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (!value) {
    return null;
  }

  const ids = Array.isArray(value) ? value : [value];
  const people = ids.map(getPersonInfo);

  if (people.length === 0) {
    return null;
  }

  if (compact) {
    // Stacked avatars
    const maxShow = 3;
    const shown = people.slice(0, maxShow);
    const remaining = people.length - maxShow;

    return (
      <span
        className={`person-card-field compact ${className}`}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        {shown.map((person, index) => (
          <span
            key={person.id}
            className={index > 0 ? '-ml-ss-2' : ''}
            style={{
              zIndex: maxShow - index,
              position: 'relative',
            }}
          >
            <PersonAvatar person={person} size={20} showName={false} />
          </span>
        ))}
        {remaining > 0 && (
          <span className="text-ss-text-secondary text-hint ml-ss-1">+{remaining}</span>
        )}
      </span>
    );
  }

  return (
    <span className={`person-card-field flex gap-ss-1 flex-wrap ${className}`}>
      {people.map((person) => (
        <PersonAvatar key={person.id} person={person} size={20} showName />
      ))}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const PersonFormField: React.FC<FormFieldProps<'person'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;
  const isMulti = Array.isArray(value);

  // Demo: would come from user service
  const availablePeople: PersonInfo[] = [
    { id: 'alice', name: 'Alice Smith' },
    { id: 'bob', name: 'Bob Johnson' },
    { id: 'carol', name: 'Carol Williams' },
    { id: 'dave', name: 'Dave Brown' },
    { id: 'eve', name: 'Eve Davis' },
  ];

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (isMulti) {
        const selectedOptions = Array.from(e.target.selectedOptions, (opt) => opt.value);
        onChange(selectedOptions.length > 0 ? selectedOptions : null);
      } else {
        onChange(e.target.value || null);
      }
    },
    [isMulti, onChange],
  );

  const selectedIds = isMulti ? (value as string[]) || [] : value ? [value as string] : [];

  return (
    <div className={`person-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <select
        id={inputId}
        multiple={isMulti}
        value={isMulti ? selectedIds : (value as string) || ''}
        onChange={handleChange}
        disabled={disabled}
      >
        {!isMulti && (
          <option value="">{placeholder || `Select ${column.name.toLowerCase()}`}</option>
        )}
        {availablePeople.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const PersonRenderer: ColumnRenderer<'person'> = {
  render: renderPerson,
  editor: PersonEditor,
  cardField: PersonCardField,
  formField: PersonFormField,
};
