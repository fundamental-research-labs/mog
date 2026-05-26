/**
 * Equation Template Gallery Component
 *
 * A gallery of predefined equation templates organized by category.
 * Users can click templates to quickly insert common equations.
 *
 */

import { useCallback, useMemo } from 'react';

import type { EquationTemplate, EquationTemplateCategory } from '../../ui-store';
import {
  ALL_EQUATION_TEMPLATES,
  CATEGORY_DISPLAY_NAMES,
  getRecentTemplates,
  getTemplatesForCategory,
} from './equation-templates';
import { EquationPreviewSmall } from './EquationPreview';

// =============================================================================
// Types
// =============================================================================

export interface EquationTemplateGalleryProps {
  /** Currently selected category */
  selectedCategory: EquationTemplateCategory;
  /** Recent template IDs */
  recentTemplateIds: string[];
  /** Called when category is changed */
  onCategoryChange: (category: EquationTemplateCategory) => void;
  /** Called when a template is selected */
  onTemplateSelect: (template: EquationTemplate) => void;
  /** Search query (optional) */
  searchQuery?: string;
}

// =============================================================================
// Sub-components
// =============================================================================

interface CategoryTabProps {
  category: EquationTemplateCategory;
  isSelected: boolean;
  onClick: () => void;
  count?: number;
}

function CategoryTab({ category, isSelected, onClick, count }: CategoryTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
 px-3 py-1.5 text-body-sm rounded-ss-md whitespace-nowrap transition-colors
 ${
   isSelected
     ? 'bg-ss-accent text-ss-text-inverse font-medium'
     : 'bg-ss-surface-secondary text-ss-text-secondary hover:bg-ss-surface-tertiary hover:text-ss-text-primary'
 }
 `}
      aria-selected={isSelected}
      role="tab"
    >
      {CATEGORY_DISPLAY_NAMES[category]}
      {count !== undefined && count > 0 && (
        <span
          className={`ml-1.5 text-caption ${isSelected ? 'text-ss-text-inverse/80' : 'text-ss-text-tertiary'}`}
        >
          ({count})
        </span>
      )}
    </button>
  );
}

interface TemplateCardProps {
  template: EquationTemplate;
  onClick: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
 flex flex-col items-center justify-center p-3 gap-2
 bg-ss-surface-secondary hover:bg-ss-surface-tertiary
 border border-ss-border hover:border-ss-accent/50
 rounded-ss-lg transition-all cursor-pointer
 min-h-[70px] group
 "
      title={`Insert: ${template.name}`}
      aria-label={`Insert ${template.name} equation: ${template.latex}`}
    >
      <div className="flex-1 flex items-center justify-center overflow-hidden max-w-full">
        <EquationPreviewSmall latex={template.latex} />
      </div>
      <div className="text-caption text-ss-text-tertiary group-hover:text-ss-text-secondary truncate max-w-full">
        {template.name}
      </div>
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Gallery of equation templates organized by category.
 *
 * Features:
 * - Category tabs for navigation
 * - Recent templates section (populated from user history)
 * - Search filtering (optional)
 * - Click to insert template
 * - Visual preview of each template
 */
export function EquationTemplateGallery({
  selectedCategory,
  recentTemplateIds,
  onCategoryChange,
  onTemplateSelect,
  searchQuery = '',
}: EquationTemplateGalleryProps) {
  // Get templates for current category
  const templates = useMemo(() => {
    if (selectedCategory === 'recent') {
      return getRecentTemplates(recentTemplateIds);
    }
    return getTemplatesForCategory(selectedCategory);
  }, [selectedCategory, recentTemplateIds]);

  // Filter by search query if provided
  const filteredTemplates = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      return templates;
    }

    const query = searchQuery.toLowerCase().trim();

    // If searching, search across all templates regardless of category
    const searchPool = searchQuery.length > 0 ? ALL_EQUATION_TEMPLATES : templates;

    return searchPool.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.latex.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query),
    );
  }, [templates, searchQuery]);

  // Handle template click
  const handleTemplateClick = useCallback(
    (template: EquationTemplate) => {
      onTemplateSelect(template);
    },
    [onTemplateSelect],
  );

  // Category list (with recent first if has items)
  const categories: EquationTemplateCategory[] = useMemo(() => {
    const cats: EquationTemplateCategory[] = [
      'basic',
      'algebra',
      'calculus',
      'statistics',
      'greek',
    ];
    if (recentTemplateIds.length > 0) {
      return ['recent', ...cats];
    }
    return cats;
  }, [recentTemplateIds.length]);

  return (
    <div className="flex flex-col gap-3">
      {/* Category Tabs */}
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Template categories"
      >
        {categories.map((category) => (
          <CategoryTab
            key={category}
            category={category}
            isSelected={selectedCategory === category}
            onClick={() => onCategoryChange(category)}
            count={category === 'recent' ? recentTemplateIds.length : undefined}
          />
        ))}
      </div>

      {/* Template Grid */}
      <div
        className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[200px] overflow-y-auto pr-1"
        role="tabpanel"
        aria-label={`${CATEGORY_DISPLAY_NAMES[selectedCategory]} templates`}
      >
        {filteredTemplates.length === 0 ? (
          <div className="col-span-full text-center py-6 text-ss-text-tertiary text-body-sm">
            {searchQuery ? 'No templates match your search' : 'No templates in this category'}
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => handleTemplateClick(template)}
            />
          ))
        )}
      </div>
    </div>
  );
}
