import { describe, it, expect, vi } from 'vitest';
import { buildPageLink, isPageLink, resolvePageLink } from '../src/renderer/page-link';
import { executeActionChain, type ActionExecutionContext } from '../src/renderer/action-runner';

const pages = [{ id: 'p_detail', route: '/machine-monitoring/machine' }];

describe('Links to a page by id', () => {
  it('builds a link with values and resolves it to the page current address', () => {
    const link = buildPageLink('p_detail', { machine: 'M 12', empty: '' });
    expect(isPageLink(link)).toBe(true);
    expect(resolvePageLink(link, pages)).toBe('/machine-monitoring/machine?machine=M+12&empty=');
    expect(resolvePageLink(buildPageLink('p_detail'), pages)).toBe('/machine-monitoring/machine');
  });

  it('follows the page when its address changes, and says nothing matches when the page is gone', () => {
    const link = buildPageLink('p_detail', { machine: 'M1' });
    expect(resolvePageLink(link, [{ id: 'p_detail', route: '/moved/machine' }])).toBe('/moved/machine?machine=M1');
    expect(resolvePageLink(link, [])).toBeNull();
  });

  it('the navigate action passes resolved values for the target page params', async () => {
    const navigate = vi.fn();
    const context = { navigate, showToast: vi.fn() } as unknown as ActionExecutionContext;
    await executeActionChain(
      [{ type: 'navigate', params: { pageId: 'p_detail', with: { machine: '{{ row.id }}' } } }],
      context,
      { row: { id: 'M7' } } as any,
    );
    expect(navigate).toHaveBeenCalledWith('page:p_detail?machine=M7');
  });

  it('still navigates to a typed address when no page is chosen', async () => {
    const navigate = vi.fn();
    const context = { navigate, showToast: vi.fn() } as unknown as ActionExecutionContext;
    await executeActionChain([{ type: 'navigate', params: { url: '/dashboard' } }], context, {} as any);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });
});
