/**
 * "Add machine" and "Edit machine" modals, shared by the monitoring pages. Saving one changes the
 * machine register, so every open page showing machines updates by itself.
 */
import { fieldId } from '../entities.js';
import type { Node } from './blocks.js';
import type { PageContext } from './context.js';

const FORM_FIELDS = ['name', 'code', 'machine_type', 'line', 'work_center', 'data_source', 'hourly_target', 'shift_hours', 'shifts_per_day', 'max_temperature', 'manufacturer', 'model', 'installed_on', 'active'];

const toast = (message: string) => ({ type: 'showToast', params: { message, variant: 'success' } });
const closeModal = (modalKey: string) => ({ type: 'closeModal', params: { modalKey } });

export function machineModals(prefix: string, ctx: PageContext): Node[] {
  const entityId = ctx.machine.id;
  const fields = FORM_FIELDS.map((n) => ({ fieldId: fieldId(ctx.machine, n), ...(n === 'code' ? { helpText: 'Links the machine to its live tags: machines.<code>.speed' } : {}) }));
  return [
    {
      id: `${prefix}_create_modal`,
      type: 'modal',
      props: { title: 'Add machine', icon: 'Plus', entityId, openStateKey: 'createOpen', size: 'lg' },
      children: [
        {
          id: `${prefix}_create_form`,
          type: 'form',
          props: {
            mode: 'create',
            entityId,
            showHeader: false,
            showCancel: true,
            submitLabel: 'Add machine',
            fields,
            onCancel: [closeModal('createOpen')],
            onSuccess: [closeModal('createOpen'), toast('Machine added. Every open screen shows it now.')],
          },
        },
      ],
    },
    {
      id: `${prefix}_edit_modal`,
      type: 'modal',
      props: { title: 'Machine configuration', icon: 'Settings', entityId, openStateKey: 'editOpen', size: 'lg' },
      children: [
        {
          id: `${prefix}_edit_form`,
          type: 'form',
          props: {
            mode: 'edit',
            entityId,
            recordId: '{{ state.editId }}',
            showHeader: false,
            showCancel: true,
            submitLabel: 'Save configuration',
            fields: [...fields, { fieldId: fieldId(ctx.machine, 'daily_target'), readOnly: true, helpText: 'Hourly target × shift length × shifts' }],
            onCancel: [closeModal('editOpen')],
            onSuccess: [closeModal('editOpen'), toast('Configuration saved')],
          },
        },
      ],
    },
  ];
}

export const openEdit = [
  { type: 'setState', params: { key: 'editId', value: '{{ row.id }}' } },
  { type: 'openModal', params: { modalKey: 'editOpen' } },
];
