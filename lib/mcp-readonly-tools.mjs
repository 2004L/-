const commandIdPattern = /^[a-zA-Z0-9:_-]{8,120}$/;

function normalizedBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP_API_BASE_URL must use http or https');
  return url.toString().replace(/\/$/, '');
}

export function loadMcpConfig(environment = process.env) {
  const apiBaseUrl = environment.MCP_API_BASE_URL;
  const tenantId = environment.MCP_TENANT_ID;
  const hotelId = environment.MCP_HOTEL_ID;
  if (!apiBaseUrl || !tenantId || !hotelId) {
    throw new Error('MCP_API_BASE_URL, MCP_TENANT_ID and MCP_HOTEL_ID are required');
  }
  return {
    apiBaseUrl: normalizedBaseUrl(apiBaseUrl),
    tenantId,
    hotelId,
    accessToken: environment.MCP_ACCESS_TOKEN ?? '',
  };
}

export function createHotelApiClient(config, fetchImpl = fetch) {
  async function read(path) {
    const headers = {
      Accept: 'application/json',
      'X-Tenant-ID': config.tenantId,
      'X-Hotel-ID': config.hotelId,
      'X-MCP-Client': 'hotel-agent-os-stdio',
    };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
    const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({ error: 'invalid_json_response' }));
    if (!response.ok) {
      const error = new Error(`Hotel API returned ${response.status}`);
      error.code = 'upstream_error';
      error.status = response.status;
      error.detail = body?.error ?? body?.message ?? 'unknown_error';
      throw error;
    }
    return body;
  }
  return { read };
}

function scoped(config, data) {
  return {
    tenant_id: config.tenantId,
    hotel_id: config.hotelId,
    observed_at: new Date().toISOString(),
    data,
  };
}

function assertCommandId(commandId) {
  if (!commandIdPattern.test(commandId)) throw new Error('invalid_command_id');
}

export function createReadonlyToolHandlers(config, apiClient) {
  const readModel = (operation, params = {}) => {
    const query = new URLSearchParams({ operation, ...params });
    return apiClient.read(`/api/mcp/read-model?${query.toString()}`);
  };
  return {
    async 'hotel.integration_status'() {
      const [health, pms] = await Promise.all([
        apiClient.read('/api/health'),
        apiClient.read('/api/pms/ping'),
      ]);
      return scoped(config, { health, pms });
    },
    async 'pms.ping'() {
      return scoped(config, await apiClient.read('/api/pms/ping'));
    },
    async 'police.command_status'({ command_id: commandId }) {
      assertCommandId(commandId);
      return scoped(config, await apiClient.read(`/api/police/status/${encodeURIComponent(commandId)}`));
    },
    async 'device.reader_status'({ command_id: commandId }) {
      assertCommandId(commandId);
      return scoped(config, await apiClient.read(`/api/device/reader/${encodeURIComponent(commandId)}`));
    },
    async 'device.encoder_status'({ command_id: commandId }) {
      assertCommandId(commandId);
      return scoped(config, await apiClient.read(`/api/device/encoder/${encodeURIComponent(commandId)}`));
    },
    async 'room.list_status'() { return scoped(config, await readModel('rooms')); },
    async 'reservation.search'({ phone_last4: phoneLast4 }) {
      if (!/^\d{4}$/.test(phoneLast4)) throw new Error('invalid_phone_last4');
      return scoped(config, await readModel('orders', { phone_last4: phoneLast4 }));
    },
    async 'workflow.get'({ workflow_id: workflowId }) {
      assertCommandId(workflowId);
      return scoped(config, await readModel('workflow', { workflow_id: workflowId }));
    },
    async 'housekeeping.list_tasks'() { return scoped(config, await readModel('tasks')); },
  };
}

export const readonlyToolCatalog = [
  {
    name: 'hotel.integration_status',
    description: '读取当前酒店的应用、数据库、模型配置和 PMS 适配器健康状态。只读，不返回密钥或住客身份原文。',
  },
  {
    name: 'pms.ping',
    description: '检查当前酒店 PMS 适配器连通性和运行模式。只读，不查询订单或住客数据。',
  },
  {
    name: 'police.command_status',
    description: '按命令编号查询公安登记命令状态。只读，不提交或重放登记。',
    commandId: true,
  },
  {
    name: 'device.reader_status',
    description: '按命令编号查询身份证读卡器命令状态。只读，不读取新的证件。',
    commandId: true,
  },
  {
    name: 'device.encoder_status',
    description: '按命令编号查询发卡机命令状态。只读，不写卡、不吐卡。',
    commandId: true,
  },
  { name: 'room.list_status', description: '只读查询指定酒店房态，返回脱敏房间状态和版本。' },
  { name: 'reservation.search', description: '按手机号后四位查询脱敏订单摘要。', phoneLast4: true },
  { name: 'workflow.get', description: '查询指定 AI 工作流及步骤状态。', workflowId: true },
  { name: 'housekeeping.list_tasks', description: '只读查询客房服务待办。' },
];
