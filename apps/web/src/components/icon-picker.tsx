import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { DynamicIcon, POPULAR_ENTITY_ICONS, ALL_ICON_NAMES } from './dynamic-icon';

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
  label?: string;
}

const PAGE_SIZE = 96;

export const IconPicker: React.FC<IconPickerProps> = ({
  value,
  onChange,
  label = 'Entity Icon',
}) => {
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
        <label className="form-label" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}>
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'var(--surface)',
          border: 'var(--border-width-sm) solid var(--border)',
          borderRadius: 'var(--radius-control)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 'var(--font-size-sm)',
          transition: 'border-color 0.15s ease',
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div
            style={{
              width: 'var(--control-height-sm)',
              height: 'var(--control-height-sm)',
              borderRadius: 'var(--radius-control)',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <DynamicIcon name={value || 'Database'} size={16} />
          </div>
          <span style={{ fontWeight: 500 }}>{selectedLabel}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
            ({value || 'Database'})
          </span>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
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
            maxHeight: 380,
          }}
        >
          {/* Search bar */}
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={14}
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
              className="form-input"
              placeholder={`Search all ${ALL_ICON_NAMES.length} icons...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{
                paddingLeft: 'var(--space-6)',
                fontSize: 'var(--font-size-xs)',
                height: 'var(--control-height-sm)',
                width: '100%',
              }}
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
              maxHeight: 210,
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
                  <DynamicIcon name={item.name} size={18} />
                  {isSelected && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        backgroundColor: 'var(--primary)',
                        color: 'var(--accent-contrast)',
                        borderRadius: 'var(--radius-full)',
                        width: 12,
                        height: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check size={9} />
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
