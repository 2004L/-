import assert from 'node:assert/strict';
import {
  createHotelApiClient,
  createReadonlyToolHandlers,
  loadMcpConfig,
  readonlyToolCatalog,
} from '../lib/mcp-readonly-tools.mjs';

const config = loadMcpConfig({
  MCP_API_BASE_URL: 'http://127.0.0.1:8787/',
  MCP_TENANT_ID: 'tenant-test',
  MCP_HOTEL_ID: 'hotel-test',
  MCP_ACCESS_TOKEN: 'test-token',
});

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  const path = new URL(url).pathname;
  const payload = path === '/api/health'
    ? { ok: true }
    : path === '/api/pms/ping'
      ? { adapter: 'simulator', mode: 'simulation' }
      : path === '/api/mcp/read-model'
        ? { operation: new URL(url).searchParams.get('operation'), items: [] }
        : { command_id: path.split('/').at(-1), status: 'SUCCEEDED' };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const handlers = createReadonlyToolHandlers(config, createHotelApiClient(config, fakeFetch));

assert.deepEqual(readonlyToolCatalog.map((tool) => tool.name), [
  'hotel.integration_status',
  'pms.ping',
  'police.command_status',
  'device.reader_status',
  'device.encoder_status',
  'room.list_status',
  'reservation.search',
  'workflow.get',
  'housekeeping.list_tasks',
]);

const integration = await handlers['hotel.integration_status']({});
assert.equal(integration.tenant_id, 'tenant-test');
assert.equal(integration.hotel_id, 'hotel-test');
assert.equal(integration.data.health.ok, true);
assert.equal(integration.data.pms.mode, 'simulation');

const police = await handlers['police.command_status']({ command_id: 'police:case-001' });
assert.equal(police.data.status, 'SUCCEEDED');
assert.equal((await handlers['room.list_status']({})).data.operation, 'rooms');
assert.equal((await handlers['reservation.search']({ phone_last4: '4821' })).data.operation, 'orders');
assert.equal((await handlers['workflow.get']({ workflow_id: 'wf:case-001' })).data.operation, 'workflow');
assert.equal((await handlers['housekeeping.list_tasks']({})).data.operation, 'tasks');
await assert.rejects(
  handlers['device.encoder_status']({ command_id: '../secret' }),
  /invalid_command_id/,
);

assert.ok(calls.every((call) => call.init.method === 'GET'));
assert.ok(calls.every((call) => call.init.headers['X-Tenant-ID'] === 'tenant-test'));
assert.ok(calls.every((call) => call.init.headers['X-Hotel-ID'] === 'hotel-test'));
assert.ok(calls.every((call) => call.init.headers.Authorization === 'Bearer test-token'));
assert.ok(calls.some((call) => call.url.endsWith('/api/police/status/police%3Acase-001')));

let transientAttempts = 0;
const retryingClient = createHotelApiClient(config, async () => {
  transientAttempts += 1;
  if (transientAttempts < 3) return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503 });
  return new Response(JSON.stringify({ ok: true, recovered: true }), { status: 200 });
});
assert.deepEqual(await retryingClient.read('/api/pms/ping'), { ok: true, recovered: true });
assert.equal(transientAttempts, 3);

console.log('MCP read-only gateway checks passed: scoped config, safe GET-only handlers and command-id validation.');
