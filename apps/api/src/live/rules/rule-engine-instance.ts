/** The server's one rule engine, fed by the live hub's tag store */
import { liveHub } from '../live-hub.js';
import { RuleEngine } from './rule-engine.js';

export const ruleEngine = new RuleEngine(liveHub.store);
