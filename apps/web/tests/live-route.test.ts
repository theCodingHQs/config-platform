import { describe, it, expect } from 'vitest';
import { livePath, parseLivePath } from '../src/studio/live/live-route';

describe('Studio → Live addresses', () => {
  it('each screen has its own address, read back to the same screen', () => {
    expect(parseLivePath('', null)).toEqual({ tab: 'connections', screen: 'list' });
    expect(parseLivePath('connections/new', null)).toEqual({ tab: 'connections', screen: 'pick' });
    expect(parseLivePath('connections/new', 'mqtt')).toEqual({ tab: 'connections', screen: 'new', kind: 'mqtt' });
    expect(parseLivePath('connections/lc_1', null)).toEqual({ tab: 'connections', screen: 'edit', id: 'lc_1' });
    expect(parseLivePath('rules', null)).toEqual({ tab: 'rules', screen: 'list' });
    expect(parseLivePath('rules/new', null)).toEqual({ tab: 'rules', screen: 'new' });
    expect(parseLivePath('rules/lr_9/', null)).toEqual({ tab: 'rules', screen: 'edit', id: 'lr_9' });
    expect(parseLivePath('agents', null)).toEqual({ tab: 'agents', screen: 'list' });
    // Anything else is the connections list
    expect(parseLivePath('nonsense/x', null)).toEqual({ tab: 'connections', screen: 'list' });
  });

  it('builds the addresses the screens read', () => {
    expect(livePath.tab('connections')).toBe('/studio/live');
    expect(livePath.tab('rules')).toBe('/studio/live/rules');
    expect(livePath.connection('lc_1')).toBe('/studio/live/connections/lc_1');
    expect(livePath.newConnection('http-push')).toBe('/studio/live/connections/new?kind=http-push');
    expect(livePath.rule('lr_9')).toBe('/studio/live/rules/lr_9');
  });
});
