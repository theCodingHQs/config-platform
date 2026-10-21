import type { PageDefinition, NodeDefinition } from './page.js';

/**
 * Migrates a NodeDefinition from v1 to v2
 */
function migrateNodeV1toV2(node: any): NodeDefinition {
  if (!node || typeof node !== 'object') {
    return node;
  }

  const migratedProps = { ...(node.props || {}) };

  // For table nodes, keep entityId working for backward compatibility
  if (node.type === 'table') {
    if (!migratedProps.columns) {
      migratedProps.columns = [];
    }
    if (!migratedProps.pageSize) {
      migratedProps.pageSize = 10;
    }
  }

  const migratedChildren = Array.isArray(node.children)
    ? node.children.map(migrateNodeV1toV2)
    : undefined;

  return {
    id: String(node.id),
    type: node.type,
    visibleIf: node.visibleIf || undefined,
    props: migratedProps,
    children: migratedChildren,
  };
}

/**
 * Migrates a PageDefinition from v1 to v2
 */
export function migratePageV1toV2(page: any): PageDefinition {
  if (!page || typeof page !== 'object') {
    throw new Error('Invalid page definition to migrate');
  }

  // Page-level presentation settings (set from the Pages screen) carry through unchanged;
  // only present keys are copied so absent stays absent (= default).
  const presentation: Partial<Pick<PageDefinition, 'width' | 'icon' | 'allowedRoles'>> = {};
  if (page.width !== undefined) presentation.width = page.width;
  if (page.icon !== undefined) presentation.icon = page.icon;
  // Access restriction: dropping it here would silently open the page to every role
  if (Array.isArray(page.allowedRoles) && page.allowedRoles.length > 0) {
    presentation.allowedRoles = page.allowedRoles;
  }

  // v1 and v2 share the same page-level shape; nodes are migrated individually
  return {
    schemaVersion: 2,
    id: String(page.id),
    version: Number(page.version || 1),
    route: String(page.route || '/'),
    state: page.state || {},
    dataSources: Array.isArray(page.dataSources) ? page.dataSources : [],
    root: migrateNodeV1toV2(page.root),
    ...presentation,
  };
}
