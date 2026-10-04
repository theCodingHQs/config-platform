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

  const currentVersion = Number(page.schemaVersion || 1);

  if (currentVersion >= 2) {
    return {
      schemaVersion: 2,
      id: String(page.id),
      version: Number(page.version || 1),
      route: String(page.route || '/'),
      state: page.state || {},
      dataSources: Array.isArray(page.dataSources) ? page.dataSources : [],
      root: migrateNodeV1toV2(page.root),
    };
  }

  // Migration from v1 -> v2
  return {
    schemaVersion: 2,
    id: String(page.id),
    version: Number(page.version || 1),
    route: String(page.route || '/'),
    state: page.state || {},
    dataSources: Array.isArray(page.dataSources) ? page.dataSources : [],
    root: migrateNodeV1toV2(page.root),
  };
}
