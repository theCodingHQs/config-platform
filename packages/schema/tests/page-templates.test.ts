import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplatePage } from '../dist/page-templates.js';

const jobs = {
  id: 't_jobs',
  name: 'job',
  label: 'Job',
  columns: [
    { id: 'c_title', name: 'title', label: 'Title', type: 'text' },
    { id: 'c_reported', name: 'reported_on', label: 'Reported On', type: 'date' },
    { id: 'c_hours', name: 'hours', label: 'Hours', type: 'number' },
  ],
} as any;

describe('CRUD list pages', () => {
  it('list newest first by their first date column', () => {
    const page = createTemplatePage('CRUD list', 'p_job', '/jobs', jobs, { tableColumns: ['c_title', 'c_reported', 'c_hours'] });
    assert.deepEqual(page.dataSources?.[0].sort, { fieldId: 'c_reported', order: 'desc' });
  });

  it('keep a sort they are given, and have none without a date column', () => {
    const given = createTemplatePage('CRUD list', 'p_job', '/jobs', jobs, { sort: { fieldId: 'c_hours', order: 'asc' } });
    assert.deepEqual(given.dataSources?.[0].sort, { fieldId: 'c_hours', order: 'asc' });
    const noDates = createTemplatePage('CRUD list', 'p_job', '/jobs', jobs, { tableColumns: ['c_title', 'c_hours'] });
    assert.equal(noDates.dataSources?.[0].sort, undefined);
  });
});
