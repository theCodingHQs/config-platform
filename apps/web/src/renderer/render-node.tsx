import React from 'react';
import type { NodeDefinition, ExpressionScope } from '@config-platform/schema';
import { evaluateExpression, resolveProps } from '@config-platform/schema';
import { defaultRegistry, type ComponentRegistry } from './registry';
import { PropsError } from './props-error';
import { NodeErrorBoundary } from './error-boundary';
import { usePageRuntime } from '../context/page-runtime-context';

export interface RenderContext {
  registry?: ComponentRegistry;
  scope?: ExpressionScope;
  attachNodeId?: boolean;
}

/**
 * Inner component renderer that connects to PageRuntimeContext and evaluates visibleIf and props
 */
function NodeRenderer({ node, ctx }: { node: NodeDefinition; ctx: RenderContext }) {
  const runtime = usePageRuntime();
  const currentScope: ExpressionScope = {
    ...(runtime?.scope || {}),
    ...(ctx.scope || {}),
  };

  // 1. Evaluate visibility expression
  if (node.visibleIf) {
    try {
      const isVisible = evaluateExpression(node.visibleIf, currentScope);
      if (!isVisible) {
        return null;
      }
    } catch (err: any) {
      return (
        <NodeErrorBoundary key={node.id} nodeId={node.id} nodeType={node.type}>
          <PropsError
            nodeId={node.id}
            nodeType={node.type}
            errors={[`visibleIf: ${err?.message || 'Invalid expression'}`]}
          />
        </NodeErrorBoundary>
      );
    }
  }

  // 2. Component Registration lookup
  const registry = ctx.registry || defaultRegistry;
  const registration = registry.get(node.type);

  if (!registration) {
    return (
      <NodeErrorBoundary key={node.id} nodeId={node.id} nodeType={node.type}>
        <PropsError
          nodeId={node.id}
          nodeType={node.type}
          errors={[`Unregistered component type: '${node.type}'`]}
        />
      </NodeErrorBoundary>
    );
  }

  // 3. Resolve expressions in props
  const { resolved, errors } = resolveProps(node.props || {}, currentScope);
  const propErrorEntries = Object.entries(errors);
  if (propErrorEntries.length > 0) {
    const errorMessages = propErrorEntries.map(([prop, msg]) => `${prop}: ${msg}`);
    return (
      <NodeErrorBoundary key={node.id} nodeId={node.id} nodeType={node.type}>
        <PropsError nodeId={node.id} nodeType={node.type} errors={errorMessages} />
      </NodeErrorBoundary>
    );
  }

  // 4. Validate resolved props with Zod schema
  const parsed = registration.propsSchema.safeParse(resolved);
  if (!parsed.success) {
    const errorMessages = parsed.error.errors.map(
      (err) => `${err.path.join('.') || 'props'}: ${err.message}`
    );
    return (
      <NodeErrorBoundary key={node.id} nodeId={node.id} nodeType={node.type}>
        <PropsError nodeId={node.id} nodeType={node.type} errors={errorMessages} />
      </NodeErrorBoundary>
    );
  }

  // 5. Render children recursively if present
  let renderedChildren: React.ReactNode = undefined;
  if (node.children && node.children.length > 0) {
    renderedChildren = node.children.map((child) => renderNode(child, ctx));
  }

  const Component = registration.component;
  const content = <Component {...parsed.data}>{renderedChildren}</Component>;

  return (
    <NodeErrorBoundary key={node.id} nodeId={node.id} nodeType={node.type}>
      {ctx.attachNodeId ? (
        <div
          data-node-id={node.id}
          data-node-type={node.type}
          style={{ display: 'contents' }}
        >
          {content}
        </div>
      ) : (
        content
      )}
    </NodeErrorBoundary>
  );
}

/**
 * Pure renderNode(node, ctx) driven by component registry
 */
export function renderNode(
  node: NodeDefinition,
  ctx: RenderContext = {}
): React.ReactNode {
  return <NodeRenderer key={node.id} node={node} ctx={ctx} />;
}
