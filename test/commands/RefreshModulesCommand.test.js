import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshModulesCommand } from '../../dist/commands/RefreshModulesCommand.js';

describe('RefreshModulesCommand', () => {
  it('request is the bare command, like OM (CLUCommand with empty suffix)', () => {
    assert.equal(RefreshModulesCommand.request().toBuffer().toString(), 'req_refresh_modules');
    assert.ok(RefreshModulesCommand.requestMatches(RefreshModulesCommand.request().toBuffer()));
  });

  it('responseMatches() checks only the prefix (as OM does)', () => {
    assert.ok(RefreshModulesCommand.responseMatches(Buffer.from('resp_refresh_modules:192.168.1.5')));
    assert.ok(RefreshModulesCommand.responseMatches(Buffer.from('resp_refresh_modules')));
    assert.ok(!RefreshModulesCommand.responseMatches(Buffer.from('resp_reset:1.2.3.4')));
    assert.ok(!RefreshModulesCommand.responseMatches(Buffer.from('resp_refresh')));
  });
});
