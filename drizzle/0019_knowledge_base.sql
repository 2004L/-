-- 知识库：政策文档 + 切片 + FTS 索引，并预置门店政策 v1（客人可见）
-- bigrams 列在写入时切好，供 FTS5 做中文检索；中文两字查询（如「早餐」）靠它命中。
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  authority TEXT NOT NULL,
  visibility TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_documents_hotel_idx ON knowledge_documents(hotel_id, status, visibility);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  keywords TEXT,
  bigrams TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_doc_idx ON knowledge_chunks(hotel_id, document_id, seq);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(chunk_id UNINDEXED, bigrams);
INSERT OR IGNORE INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES ('kb-gz-breakfast', 'tenant-demo', 'hotel-gz-demo', '早餐时间与服务', 'policy', 'authoritative', 'guest', 1, '2026-01-01', NULL, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES ('kb-gz-breakfast-c0', 'tenant-demo', 'hotel-gz-demo', 'kb-gz-breakfast', 0, '早餐时间是早上七点到十点，地点在二楼餐厅。住客凭房卡用餐，无需另外付费。', '早饭 早点 餐厅 早餐时间', '早餐 餐时 时间 间与 与服 服务 间是 是早 早上 上七 七点 点到 到十 十点 地点 点在 在二 二楼 楼餐 餐厅 住客 客凭 凭房 房卡 卡用 用餐 无需 需另 另外 外付 付费 早饭 早点', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES ('kb-gz-breakfast-c0', '早餐 餐时 时间 间与 与服 服务 间是 是早 早上 上七 七点 点到 到十 十点 地点 点在 在二 二楼 楼餐 餐厅 住客 客凭 凭房 房卡 卡用 用餐 无需 需另 另外 外付 付费 早饭 早点');
INSERT OR IGNORE INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES ('kb-gz-parking', 'tenant-demo', 'hotel-gz-demo', '停车服务', 'policy', 'authoritative', 'guest', 1, '2026-01-01', NULL, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES ('kb-gz-parking-c0', 'tenant-demo', 'hotel-gz-demo', 'kb-gz-parking', 0, '酒店提供停车服务，地库（地下一层）为住客专用车位，凭房卡免费停放。车位有限，先到先得，不再另行收费。', '车位 停车费 停车 车库', '停车 车服 服务 酒店 店提 提供 供停 地库 地下 下一 一层 为住 住客 客专 专用 用车 车位 凭房 房卡 卡免 免费 费停 停放 位有 有限 先到 到先 先得 不再 再另 另行 行收 收费 车费 车库', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES ('kb-gz-parking-c0', '停车 车服 服务 酒店 店提 提供 供停 地库 地下 下一 一层 为住 住客 客专 专用 用车 车位 凭房 房卡 卡免 免费 费停 停放 位有 有限 先到 到先 先得 不再 再另 另行 行收 收费 车费 车库');
INSERT OR IGNORE INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES ('kb-gz-payment', 'tenant-demo', 'hotel-gz-demo', '支付与押金政策', 'policy', 'authoritative', 'guest', 1, '2026-01-01', NULL, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES ('kb-gz-payment-c0', 'tenant-demo', 'hotel-gz-demo', 'kb-gz-payment', 0, '押金与支付方式以门店当前政策为准。系统会在身份与房态核验后展示微信或支付宝付款页面，AI 不会自行修改金额。', '押金 微信 支付宝 付款 支付方式', 'ai 支付 付与 与押 押金 金政 政策 金与 与支 付方 方式 式以 以门 门店 店当 当前 前政 策为 为准 系统 统会 会在 在身 身份 份与 与房 房态 态核 核验 验后 后展 展示 示微 微信 信或 或支 付宝 宝付 付款 款页 页面 不会 会自 自行 行修 修改 改金 金额', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES ('kb-gz-payment-c0', 'ai 支付 付与 与押 押金 金政 政策 金与 与支 付方 方式 式以 以门 门店 店当 当前 前政 策为 为准 系统 统会 会在 在身 身份 份与 与房 房态 态核 核验 验后 后展 展示 示微 微信 信或 或支 付宝 宝付 付款 款页 页面 不会 会自 自行 行修 修改 改金 金额');
INSERT OR IGNORE INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES ('kb-gz-checkout', 'tenant-demo', 'hotel-gz-demo', '退房与延迟退房', 'policy', 'authoritative', 'guest', 1, '2026-01-01', NULL, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES ('kb-gz-checkout-c0', 'tenant-demo', 'hotel-gz-demo', 'kb-gz-checkout', 0, '退房时间为次日中午十二点前。如需延迟退房，请先联系前台查询当天房态，延迟退房可能产生额外费用。', '退房 几点退房 延迟退房 续住', '退房 房与 与延 延迟 迟退 房时 时间 间为 为次 次日 日中 中午 午十 十二 二点 点前 如需 需延 请先 先联 联系 系前 前台 台查 查询 询当 当天 天房 房态 房可 可能 能产 产生 生额 额外 外费 费用 几点 点退 续住', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES ('kb-gz-checkout-c0', '退房 房与 与延 延迟 迟退 房时 时间 间为 为次 次日 日中 中午 午十 十二 二点 点前 如需 需延 请先 先联 联系 系前 前台 台查 查询 询当 当天 天房 房态 房可 可能 能产 产生 生额 额外 外费 费用 几点 点退 续住');
INSERT OR IGNORE INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES ('kb-gz-late-fee', 'tenant-demo', 'hotel-gz-demo', '延迟退房加收标准（内部）', 'sop', 'reference', 'staff', 1, '2026-01-01', NULL, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES ('kb-gz-late-fee-c0', 'tenant-demo', 'hotel-gz-demo', 'kb-gz-late-fee', 0, '延迟退房至十四点加收半天房费，十四点之后按全价计算。需前台确认后手工调整金额。', '延迟退房 加收 半天房费', '延迟 迟退 退房 房加 加收 收标 标准 内部 房至 至十 十四 四点 点加 收半 半天 天房 房费 点之 之后 后按 按全 全价 价计 计算 需前 前台 台确 确认 认后 后手 手工 工调 调整 整金 金额', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
INSERT OR IGNORE INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES ('kb-gz-late-fee-c0', '延迟 迟退 退房 房加 加收 收标 标准 内部 房至 至十 十四 四点 点加 收半 半天 天房 房费 点之 之后 后按 按全 全价 价计 计算 需前 前台 台确 确认 认后 后手 手工 工调 调整 整金 金额');
