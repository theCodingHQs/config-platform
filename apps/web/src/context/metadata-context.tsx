import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchemaEntities } from '../api/client';
import type { ErdTable, ErdColumn } from '@config-platform/schema';

export interface MetadataContextValue {
  tenantId: string;
  entities: ErdTable[];
  isLoading: boolean;
  error: Error | null;
  resolveEntity: (entityId: string) => ErdTable | undefined;
  resolveField: (fieldId: string) => ErdColumn | undefined;
}

const MetadataContext = createContext<MetadataContextValue | null>(null);

export interface MetadataProviderProps {
  tenantId: string;
  initialEntities?: ErdTable[];
  children: React.ReactNode;
}

export function MetadataProvider({ tenantId, initialEntities, children }: MetadataProviderProps) {
  const { data, isLoading, error } = useQuery<ErdTable[], Error>({
    queryKey: ['schema-entities', tenantId],
    queryFn: () => fetchSchemaEntities(tenantId),
    initialData: initialEntities,
    staleTime: 60000,
  });

  const entities = data || [];

  const { entityMap, fieldMap } = useMemo(() => {
    const eMap = new Map<string, ErdTable>();
    const fMap = new Map<string, ErdColumn>();

    for (const entity of entities) {
      eMap.set(entity.id, entity);
      eMap.set(entity.name, entity);

      const cols = entity.columns || entity.fields || [];
      for (const col of cols) {
        fMap.set(col.id, col);
      }
    }

    return { entityMap: eMap, fieldMap: fMap };
  }, [entities]);

  const value = useMemo<MetadataContextValue>(() => ({
    tenantId,
    entities,
    isLoading,
    error,
    resolveEntity: (entityId: string) => entityMap.get(entityId),
    resolveField: (fieldId: string) => fieldMap.get(fieldId),
  }), [tenantId, entities, isLoading, error, entityMap, fieldMap]);

  return (
    <MetadataContext.Provider value={value}>
      {children}
    </MetadataContext.Provider>
  );
}

export function useMetadata(): MetadataContextValue {
  const ctx = useContext(MetadataContext);
  if (!ctx) {
    throw new Error('useMetadata must be used within a MetadataProvider');
  }
  return ctx;
}

export function useOptionalMetadata(): MetadataContextValue | null {
  return useContext(MetadataContext);
}
