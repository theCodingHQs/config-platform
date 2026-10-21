import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { Search, ChevronDown, Check, Ban } from 'lucide-react';
import { DynamicIcon, POPULAR_ENTITY_ICONS, ALL_ICON_NAMES } from './dynamic-icon';

interface IconPickerBaseProps {
  label?: string;
  /** id for the trigger button (lets an external <label htmlFor> point at it). */
  id?: string;
}

/** An icon is required (e.g. entity icons). */
interface RequiredIconPickerProps extends IconPickerBaseProps {
  clearable?: false;
  value: string;
  onChange: (iconName: string) => void;
}

/** An icon is optional: adds a "No icon" choice and reports `undefined` when cleared. */
interface ClearableIconPickerProps extends IconPickerBaseProps {
  clearable: true;
  value: string | undefined;
  onChange: (iconName: string | undefined) => void;
  /** Text shown when no icon is selected. */
  placeholder?: string;
  /** Name of the empty choice in the grid, e.g. "Automatic icon" when a default applies. */
  clearLabel?: string;
}

type IconPickerProps = RequiredIconPickerProps | ClearableIconPickerProps;

const PAGE_SIZE = 96;

/** Icon badge in the trigger: the control height minus the inset on each side. */
const ICON_BADGE_SIZE = 'calc(var(--control-height-md) - 2 * var(--space-1) - 2 * var(--border-width-sm))';

export const IconPicker: React.FC<IconPickerProps> = (props) => {
  const { value, label = 'Entity Icon', id } = props;
  const clearable = props.clearable === true;
  const placeholder = props.clearable ? props.placeholder ?? 'No icon' : undefined;
  const clearLabel = props.clearable ? props.clearLabel ?? 'No icon' : 'No icon';
  const onChange = props.onChange as (iconName: string | undefined) => void;
  const generatedId = useId();
  const triggerId = id ?? `icon-picker-${generatedId}`;
  const isEmpty = clearable && !value;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Popular');
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  const categories = [
    { id: 'Popular', label: 'Popular' },
    { id: 'All', label: `All (${ALL_ICON_NAMES.length})` },
    { id: 'People', label: 'People' },
    { id: 'Commerce', label: 'Commerce' },
    { id: 'Organization', label: 'Organization' },
    { id: 'Content', label: 'Content' },
    { id: 'Operations', label: 'Operations' },
  ];

  // Reset display count on search or category switch
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [search, activeCategory]);

  const allFilteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase();

    // When searching, search across all 1800+ Lucide icons
    if (q) {
      return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q)).map((name) => {
        const popular = POPULAR_ENTITY_ICONS.find((p) => p.name === name);
        return {
          name,
          label: popular?.label || name,
        };
      });
    }

    // Filter by selected category
    if (activeCategory === 'All') {
      return ALL_ICON_NAMES.map((name) => {
        const popular = POPULAR_ENTITY_ICONS.find((p) => p.name === name);
        return {
          name,
          label: popular?.label || name,
        };
      });
    }

    if (activeCategory === 'Popular') {
      return POPULAR_ENTITY_ICONS.map((p) => ({
        name: p.name,
        label: p.label,
      }));
    }

    return POPULAR_ENTITY_ICONS.filter((p) => p.category === activeCategory).map((p) => ({
      name: p.name,
      label: p.label,
    }));
  }, [search, activeCategory]);

  const visibleIcons = useMemo(() => {
    return allFilteredIcons.slice(0, displayCount);
  }, [allFilteredIcons, displayCount]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedPopular = POPULAR_ENTITY_ICONS.find((i) => i.name === value);
  const selectedLabel = selectedPopular?.label || value || 'Database';

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {label && (
        <label
          className="form-label"
          htmlFor={triggerId}
        >
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        id={triggerId}
        type="button"
        className="form-input"
        onClick={() => {
          // Each opening starts fresh (no leftover search hiding icons or the "No icon" choice)
          if (!isOpen) setSearch('');
          setIsOpen(!isOpen);
        }}
        style={{
          // Same height, border, radius and text as inputs and selects (theme density / text size);
          // the icon badge is inset by the same space on every side
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          height: 'var(--control-height-md)',
          paddingBlock: 0,
          paddingInlineStart: 'var(--space-1)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          <div
            style={{
              width: ICON_BADGE_SIZE,
              height: ICON_BADGE_SIZE,
              flexShrink: 0,
              borderRadius: 'var(--radius-control)',
              backgroundColor: isEmpty ? 'transparent' : 'var(--primary-subtle)',
              border: isEmpty ? 'var(--border-width-sm) dashed var(--border)' : 'none',
              color: isEmpty ? 'var(--text-muted)' : 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isEmpty ? <Ban size="1em" /> : <DynamicIcon name={value || 'Database'} size="1.15em" />}
          </div>
          {isEmpty ? (
            <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>
          ) : (
            <>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabel}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                ({value || 'Database'})
              </span>
            </>
          )}
        </div>
        <ChevronDown size="1.15em" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-1))',
            left: 0,
            right: 0,
            zIndex: 1000,
            backgroundColor: 'var(--surface)',
            border: 'var(--border-width-sm) solid var(--border)',
            borderRadius: 'var(--radius-surface)',
            boxShadow: 'var(--shadow-xl)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            maxHeight: '28em',
          }}
        >
          {/* Search bar */}
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size="1em"
              style={{
                position: 'absolute',
                left: 'var(--space-2)',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              className="form-input form-control-sm"
              placeholder={`Search all ${ALL_ICON_NAMES.length} icons...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{ paddingLeft: 'var(--space-6)', width: '100%' }}
            />
          </div>

          {/* Category Tabs (hidden during active search) */}
          {!search && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                overflowX: 'auto',
                paddingBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-control)',
                    border: 'none',
                    backgroundColor:
                      activeCategory === cat.id ? 'var(--primary)' : 'var(--surface-subtle)',
                    color: activeCategory === cat.id ? 'var(--accent-contrast)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: activeCategory === cat.id ? 600 : 400,
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          {/* Status info */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              paddingLeft: 'var(--space-1)',
              paddingRight: 'var(--space-1)',
            }}
          >
            <span>
              {search
                ? `Found ${allFilteredIcons.length} icon${allFilteredIcons.length === 1 ? '' : 's'}`
                : `Showing ${visibleIcons.length} of ${allFilteredIcons.length}`}
            </span>
            {allFilteredIcons.length > visibleIcons.length && (
              <span style={{ fontStyle: 'italic' }}>Scroll down to load more</span>
            )}
          </div>

          {/* Icon Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 'var(--space-2)',
              overflowY: 'auto',
              maxHeight: '15em',
              padding: 'var(--space-1)',
            }}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop <= el.clientHeight + 50) {
                if (displayCount < allFilteredIcons.length) {
                  setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, allFilteredIcons.length));
                }
              }
            }}
          >
            {/* "No icon" choice for optional icons (hidden while searching) */}
            {clearable && !search && (
              <button
                type="button"
                title={clearLabel}
                aria-label={clearLabel}
                aria-pressed={isEmpty}
                onClick={() => {
                  onChange(undefined);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-control)',
                  border: isEmpty
                    ? 'var(--border-width-md) solid var(--primary)'
                    : 'var(--border-width-sm) dashed var(--border)',
                  backgroundColor: isEmpty ? 'var(--primary-subtle)' : 'var(--surface)',
                  color: isEmpty ? 'var(--primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <Ban size="1.25em" />
              </button>
            )}
            {visibleIcons.map((item) => {
              const isSelected = value === item.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  title={`${item.label} (${item.name})`}
                  onClick={() => {
                    onChange(item.name);
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-control)',
                    border: isSelected
                      ? 'var(--border-width-md) solid var(--primary)'
                      : 'var(--border-width-sm) solid var(--border)',
                    backgroundColor: isSelected
                      ? 'var(--primary-subtle)'
                      : 'var(--surface)',
                    color: isSelected ? 'var(--primary)' : 'var(--text)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <DynamicIcon name={item.name} size="1.25em" />
                  {isSelected && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        backgroundColor: 'var(--primary)',
                        color: 'var(--accent-contrast)',
                        borderRadius: 'var(--radius-full)',
                        width: '0.875em',
                        height: '0.875em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check size="0.65em" />
                    </div>
                  )}
                </button>
              );
            })}

            {allFilteredIcons.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: 'var(--space-4)',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                No icons found matching &quot;{search}&quot;
              </div>
            )}
          </div>

          {/* Load More Button */}
          {allFilteredIcons.length > visibleIcons.length && (
            <button
              type="button"
              onClick={() =>
                setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, allFilteredIcons.length))
              }
              style={{
                width: '100%',
                padding: 'var(--space-1) var(--space-2)',
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text)',
                border: 'var(--border-width-sm) solid var(--border)',
                borderRadius: 'var(--radius-control)',
                fontSize: 'var(--font-size-xs)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Load more icons ({allFilteredIcons.length - visibleIcons.length} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
};
