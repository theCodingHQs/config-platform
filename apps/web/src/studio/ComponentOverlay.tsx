import React, { useEffect, useState, useCallback } from 'react';
import type { PageDefinition, NodeDefinition } from '@config-platform/schema';

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
}

interface ComponentOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  draft: PageDefinition | null;
}

function findNode(root: NodeDefinition, id: string): NodeDefinition | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export const ComponentOverlay: React.FC<ComponentOverlayProps> = ({
  containerRef,
  selectedNodeId,
  hoveredNodeId,
  draft,
}) => {
  const [activeRect, setActiveRect] = useState<HighlightRect | null>(null);
  const [hoveredRect, setHoveredRect] = useState<HighlightRect | null>(null);

  const calculateRect = useCallback(
    (nodeId: string | null): HighlightRect | null => {
      if (!nodeId || !containerRef.current) return null;
      const container = containerRef.current;
      const wrapper = container.querySelector(`[data-node-id="${nodeId}"]`);
      if (!wrapper) return null;

      // Extract the actual rendered DOM element inside the display:contents wrapper
      const elem = (wrapper.firstElementChild as HTMLElement) || (wrapper as HTMLElement);
      if (!elem) return null;

      const containerRect = container.getBoundingClientRect();
      const elemRect = elem.getBoundingClientRect();

      const isJsdom =
        typeof navigator !== 'undefined' &&
        (navigator.userAgent.includes('jsdom') || navigator.userAgent.includes('Node.js'));

      if (!isJsdom && elemRect.width === 0 && elemRect.height === 0) return null;

      const computed = window.getComputedStyle(elem);

      return {
        top: elemRect.top - containerRect.top + container.scrollTop,
        left: elemRect.left - containerRect.left + container.scrollLeft,
        width: elemRect.width || (isJsdom ? 120 : 0),
        height: elemRect.height || (isJsdom ? 36 : 0),
        borderRadius: computed.borderRadius || '0px',
      };
    },
    [containerRef]
  );

  const updateRects = useCallback(() => {
    setActiveRect(calculateRect(selectedNodeId));
    if (hoveredNodeId && hoveredNodeId !== selectedNodeId) {
      setHoveredRect(calculateRect(hoveredNodeId));
    } else {
      setHoveredRect(null);
    }
  }, [calculateRect, selectedNodeId, hoveredNodeId]);

  useEffect(() => {
    updateRects();

    const container = containerRef.current;
    if (!container) return;

    const handleScrollOrResize = () => {
      requestAnimationFrame(updateRects);
    };

    container.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        requestAnimationFrame(updateRects);
      });
      ro.observe(container);
    }

    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        requestAnimationFrame(updateRects);
      });
      mo.observe(container, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      container.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [containerRef, updateRects, selectedNodeId, hoveredNodeId, draft]);

  const selectedNode = draft && selectedNodeId ? findNode(draft.root, selectedNodeId) : null;
  const hoveredNode = draft && hoveredNodeId ? findNode(draft.root, hoveredNodeId) : null;

  if (!activeRect && !hoveredRect) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 50,
        overflow: 'visible',
      }}
    >
      {/* Active Component Highlight */}
      {activeRect && (
        <div
          data-testid="preview-active-overlay"
          style={{
            position: 'absolute',
            top: activeRect.top,
            left: activeRect.left,
            width: activeRect.width,
            height: activeRect.height,
            border: 'var(--border-width-md) solid var(--editor-overlay-selected)',
            backgroundColor: 'var(--editor-overlay-selected-bg)',
            borderRadius: activeRect.borderRadius,
            boxShadow: 'var(--shadow-md)',
            transition: 'all 0.12s ease-out',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          {/* Badge Label */}
          <div
            style={{
              position: 'absolute',
              top: activeRect.top < 26 ? '2px' : '-24px',
              left: 0,
              backgroundColor: 'var(--editor-overlay-selected)',
              color: 'var(--editor-overlay-badge-text)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              padding: 'var(--spacing-1) var(--spacing-2)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)',
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow-sm)',
              zIndex: 52,
            }}
          >
            <span>{selectedNode?.type || 'active'}</span>
            <span style={{ opacity: 0.75, fontFamily: 'var(--font-mono)' }}>#{selectedNodeId}</span>
          </div>

          {/* 4 Corner Accent Handles */}
          <div
            style={{
              position: 'absolute',
              top: -3,
              left: -3,
              width: 6,
              height: 6,
              backgroundColor: 'var(--editor-overlay-badge-text)',
              border: 'var(--border-width-sm) solid var(--editor-overlay-selected)',
              borderRadius: 'var(--radius-xs)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 6,
              height: 6,
              backgroundColor: 'var(--editor-overlay-badge-text)',
              border: 'var(--border-width-sm) solid var(--editor-overlay-selected)',
              borderRadius: 'var(--radius-xs)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -3,
              left: -3,
              width: 6,
              height: 6,
              backgroundColor: 'var(--editor-overlay-badge-text)',
              border: 'var(--border-width-sm) solid var(--editor-overlay-selected)',
              borderRadius: 'var(--radius-xs)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: -3,
              right: -3,
              width: 6,
              height: 6,
              backgroundColor: 'var(--editor-overlay-badge-text)',
              border: 'var(--border-width-sm) solid var(--editor-overlay-selected)',
              borderRadius: 'var(--radius-xs)',
            }}
          />
        </div>
      )}

      {/* Hovered Component Highlight */}
      {hoveredRect && hoveredNodeId !== selectedNodeId && (
        <div
          data-testid="preview-hovered-overlay"
          style={{
            position: 'absolute',
            top: hoveredRect.top,
            left: hoveredRect.left,
            width: hoveredRect.width,
            height: hoveredRect.height,
            border: 'var(--border-width-md) dashed var(--editor-overlay-hover)',
            backgroundColor: 'var(--editor-overlay-hover-bg)',
            borderRadius: hoveredRect.borderRadius,
            transition: 'all 0.08s ease-out',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          {/* Badge Label */}
          <div
            style={{
              position: 'absolute',
              top: hoveredRect.top < 24 ? '2px' : '-22px',
              left: 0,
              backgroundColor: 'var(--editor-overlay-hover)',
              color: 'var(--editor-overlay-badge-text)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              padding: 'var(--spacing-1) var(--spacing-2)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)',
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow-sm)',
              zIndex: 51,
            }}
          >
            <span>{hoveredNode?.type || 'component'}</span>
            <span style={{ opacity: 0.75, fontFamily: 'var(--font-mono)' }}>#{hoveredNodeId}</span>
          </div>
        </div>
      )}
    </div>
  );
};
