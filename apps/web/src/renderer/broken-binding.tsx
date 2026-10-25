import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface BrokenBindingProps {
  type: 'entity' | 'field' | 'visual';
  id: string;
}

export const BrokenBinding: React.FC<BrokenBindingProps> = ({ type, id }) => {
  return (
    <span className="broken-binding" title={`Missing ${type} with ID: ${id}`}>
      <AlertTriangle size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--spacing-1)' }} />
      <span>[Broken {type}: {id}]</span>
    </span>
  );
};
