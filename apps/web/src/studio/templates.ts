import type { PageDefinition, ErdTable, NodeDefinition } from '@config-platform/schema';

export type TemplateType = 'Master/Detail' | 'Dashboard' | 'CRUD list';

export function createTemplatePage(
  template: TemplateType,
  pageId: string,
  route: string,
  entity: ErdTable
): PageDefinition {
  const cols = (entity.columns || []).filter(
    (c) => !['id', 'created_at', 'updated_at'].includes(c.id)
  );
  const numCol = cols.find((c) => c.type === 'number');
  const dsId = `ds_${entity.name}`;

  switch (template) {
    case 'Master/Detail': {
      return {
        schemaVersion: 2,
        id: pageId,
        version: 1,
        route,
        state: { selectedId: '' },
        dataSources: [
          {
            id: dsId,
            entityId: entity.id,
            limit: 10,
          },
        ],
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical', gap: 16 },
          children: [
            {
              id: 'header_text',
              type: 'text',
              props: { value: `${entity.label} Master / Detail`, variant: 'h1' },
            },
            {
              id: 'main_grid',
              type: 'grid',
              props: { columns: 2, gap: 16, responsiveCollapse: true },
              children: [
                {
                  id: 'table_node',
                  type: 'table',
                  props: {
                    source: dsId,
                    columns: cols.slice(0, 3).map((c) => ({ fieldId: c.id })),
                    pageSize: 10,
                    onRowClick: [
                      {
                        type: 'setState',
                        params: { key: 'selectedId', value: '{{ row.id }}' },
                      },
                    ],
                  },
                },
                {
                  id: 'details_node',
                  type: 'details',
                  visibleIf: '{{ state.selectedId != null && state.selectedId != "" }}',
                  props: {
                    source: dsId,
                    recordId: '{{ state.selectedId }}',
                    fields: cols.map((c) => ({ fieldId: c.id })),
                  },
                },
              ],
            },
          ],
        },
      };
    }

    case 'Dashboard': {
      return {
        schemaVersion: 2,
        id: pageId,
        version: 1,
        route,
        state: {},
        dataSources: [
          {
            id: dsId,
            entityId: entity.id,
            limit: 10,
          },
        ],
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical', gap: 16 },
          children: [
            {
              id: 'header_text',
              type: 'text',
              props: { value: `${entity.label} Dashboard`, variant: 'h1' },
            },
            {
              id: 'stats_grid',
              type: 'grid',
              props: { columns: 3, gap: 16, responsiveCollapse: true },
              children: [
                {
                  id: 'stat_1',
                  type: 'stat',
                  props: {
                    entityId: entity.id,
                    op: 'count',
                    label: `Total ${entity.label}s`,
                  },
                },
                {
                  id: 'stat_2',
                  type: 'stat',
                  props: {
                    entityId: entity.id,
                    op: numCol ? 'avg' : 'count',
                    fieldId: numCol?.id,
                    label: numCol ? `Avg ${numCol.label}` : `Active ${entity.label}s`,
                  },
                },
                {
                  id: 'stat_3',
                  type: 'stat',
                  props: {
                    entityId: entity.id,
                    op: numCol ? 'max' : 'count',
                    fieldId: numCol?.id,
                    label: numCol ? `Max ${numCol.label}` : 'Total Active',
                  },
                },
              ],
            },
            {
              id: 'dashboard_tabs',
              type: 'tabs',
              props: {
                tabs: [
                  { id: 'tab_overview', label: 'Overview Chart' },
                  { id: 'tab_table', label: 'Recent Records' },
                ],
                defaultTab: 'tab_overview',
              },
              children: [
                {
                  id: 'chart_node',
                  type: 'chart',
                  props: {
                    source: dsId,
                    type: 'bar',
                    groupByFieldId: cols[0]?.id || 'id',
                    aggregateOp: 'count',
                    title: `${entity.label} Breakdown`,
                  },
                },
                {
                  id: 'table_node',
                  type: 'table',
                  props: {
                    source: dsId,
                    columns: cols.slice(0, 3).map((c) => ({ fieldId: c.id })),
                    pageSize: 10,
                  },
                },
              ],
            },
          ],
        },
      };
    }

    case 'CRUD list': {
      return {
        schemaVersion: 2,
        id: pageId,
        version: 1,
        route,
        state: {
          editRecordId: '',
          createModalOpen: false,
          editModalOpen: false,
        },
        dataSources: [
          {
            id: dsId,
            entityId: entity.id,
            limit: 10,
          },
        ],
        root: {
          id: 'root_stack',
          type: 'stack',
          props: { direction: 'vertical', gap: 16 },
          children: [
            {
              id: 'header_stack',
              type: 'stack',
              props: { direction: 'horizontal', justify: 'space-between', align: 'center' },
              children: [
                {
                  id: 'title_text',
                  type: 'text',
                  props: { value: `${entity.label} Management`, variant: 'h1' },
                },
                {
                  id: 'create_btn',
                  type: 'button',
                  props: {
                    label: `+ New ${entity.label}`,
                    variant: 'primary',
                    onClick: [
                      {
                        type: 'openModal',
                        params: { modalKey: 'createModalOpen' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: 'crud_table',
              type: 'table',
              props: {
                source: dsId,
                columns: cols.slice(0, 4).map((c) => ({ fieldId: c.id })),
                pageSize: 10,
                onRowClick: [
                  {
                    type: 'setState',
                    params: { key: 'editRecordId', value: '{{ row.id }}' },
                  },
                  {
                    type: 'openModal',
                    params: { modalKey: 'editModalOpen' },
                  },
                ],
              },
            },
            {
              id: 'create_modal',
              type: 'modal',
              props: {
                title: `Create ${entity.label}`,
                openStateKey: 'createModalOpen',
              },
              children: [
                {
                  id: 'create_form',
                  type: 'form',
                  props: {
                    mode: 'create',
                    entityId: entity.id,
                    fields: cols.map((c) => ({ fieldId: c.id })),
                    onSuccess: [
                      {
                        type: 'closeModal',
                        params: { modalKey: 'createModalOpen' },
                      },
                      {
                        type: 'refetch',
                        params: { source: dsId },
                      },
                      {
                        type: 'showToast',
                        params: {
                          message: `${entity.label} created successfully`,
                          variant: 'success',
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: 'edit_modal',
              type: 'modal',
              props: {
                title: `Edit ${entity.label}`,
                openStateKey: 'editModalOpen',
              },
              children: [
                {
                  id: 'edit_form',
                  type: 'form',
                  props: {
                    mode: 'edit',
                    entityId: entity.id,
                    recordId: '{{ state.editRecordId }}',
                    fields: cols.map((c) => ({ fieldId: c.id })),
                    onSuccess: [
                      {
                        type: 'closeModal',
                        params: { modalKey: 'editModalOpen' },
                      },
                      {
                        type: 'refetch',
                        params: { source: dsId },
                      },
                      {
                        type: 'showToast',
                        params: {
                          message: `${entity.label} updated successfully`,
                          variant: 'success',
                        },
                      },
                    ],
                  },
                },
                {
                  id: 'delete_btn',
                  type: 'button',
                  props: {
                    label: `Delete ${entity.label}`,
                    variant: 'danger',
                    onClick: [
                      {
                        type: 'confirm',
                        params: {
                          title: 'Delete Confirmation',
                          message: `Are you sure you want to delete this ${entity.label}?`,
                          confirmLabel: 'Delete',
                          cancelLabel: 'Cancel',
                        },
                      },
                      {
                        type: 'deleteRecord',
                        params: {
                          entityId: entity.id,
                          id: '{{ state.editRecordId }}',
                        },
                      },
                      {
                        type: 'closeModal',
                        params: { modalKey: 'editModalOpen' },
                      },
                      {
                        type: 'refetch',
                        params: { source: dsId },
                      },
                      {
                        type: 'showToast',
                        params: {
                          message: `${entity.label} deleted successfully`,
                          variant: 'success',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };
    }
  }
}
