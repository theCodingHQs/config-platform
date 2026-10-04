import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface PropsErrorProps {
  nodeId: string;
  nodeType: string;
  errors: string[];
}

export const PropsError: React.FC<PropsErrorProps> = ({ nodeId, nodeType, errors }) => {
  return (
    <div className="props-error" role="alert">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
        <strong>Invalid props for &lt;{nodeType}&gt; (id: {nodeId})</strong>
      </div>
      <ul style={{ marginTop: '0.25rem', paddingLeft: '1.25rem' }}>
        {errors.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
    </div>
  );
};
