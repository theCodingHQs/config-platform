import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface NodeErrorBoundaryProps {
  nodeId: string;
  nodeType: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class NodeErrorBoundary extends Component<NodeErrorBoundaryProps, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error in component <${this.props.nodeType} id="${this.props.nodeId}">:`, error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="node-error" role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
            <strong>Component Error: &lt;{this.props.nodeType}&gt; (id: {this.props.nodeId})</strong>
          </div>
          <p style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-sm)' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
