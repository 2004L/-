import { readFileSync } from "node:fs";
import { adminPermissions, adminToolArgumentSchemas, adminToolNames, adminToolPermissions, rolePermissions, routeAdminIntent, isRoomNumber, parseAmount } from "../lib/admin-tools.ts";

const read = (file) => readFileSync(file, "utf8");
const page = read("app/page.tsx");
const route = read("app/api/admin/agent/turn/route.ts");
const llm = read("lib/admin-llm.ts");
const asr = read("services/asr/server.py");
const adminService = read("lib/admin-service.ts");

const pending = { pending_action_id: "action-phase2-demo" };
const cases = [
  ["实时识别查尾号4821", "查尾号4821", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.arguments.phone_last4 === "4821"],
  ["自动规划换房确认卡", "把尾号4821换到1306", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.workflow?.target_room === "1306"],
  ["中文数字转阿拉伯数字", "把尾号四千八百二十一的客人换到一千三百零六", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.arguments.phone_last4 === "4821" && result.workflow?.target_room === "1306"],
  ["确认执行必须命中确认工具", "确认执行", (result) => result.type === "tool_call" && result.tool_name === "admin.confirm_pending_action"],
  ["取消后不执行工具", "取消", (result) => result.type === "tool_call" && result.tool_name === "admin.cancel_pending_action"],
  ["识别客房打扫完成", "1208 打扫完成", (result) => result.type === "tool_call" && result.tool_name === "admin.mark_room_clean" && result.arguments.room_number === "1208"],
  ["口语打扫说法", "把 1306 收拾好了", (result) => result.type === "tool_call" && result.tool_name === "admin.mark_room_clean" && result.arguments.room_number === "1306"],
  ["打扫缺房号要澄清", "打扫完成了", (result) => result.type === "clarification" && result.intent === "mark_room_clean"],
  ["识别近一个月清理", "清理近一个月的已退房记录", (result) => result.type === "tool_call" && result.tool_name === "admin.prepare_purge_closed_loops" && result.arguments.range === "30d"],
  ["识别近一年清理", "把近一年的退房历史删掉", (result) => result.type === "tool_call" && result.tool_name === "admin.prepare_purge_closed_loops" && result.arguments.range === "365d"],
  ["清理缺范围要追问", "清理已退房数据", (result) => result.type === "clarification" && result.intent === "purge_closed_loops"],
  ["识别在住客人列表", "在住客人列表", (result) => result.type === "tool_call" && result.tool_name === "admin.list_in_house_guests"],
  ["识别数据库清单", "看看数据库有哪些表", (result) => result.type === "tool_call" && result.tool_name === "admin.get_database_schema"],
  ["识别指定据表预览", "看一下 reservations 表", (result) => result.type === "tool_call" && result.tool_name === "admin.get_table_rows" && result.arguments.table === "reservations"],
  ["识别客房服务需求", "1206 需要打扫", (result) => result.type === "tool_call" && result.tool_name === "admin.set_room_service_need" && result.arguments.room_number === "1206" && result.arguments.need === "cleaning"],
  ["识别补物品需求", "给 1210 送毛巾", (result) => result.type === "tool_call" && result.tool_name === "admin.set_room_service_need" && result.arguments.need === "supplies"],
];

for (const [id, text, assert] of cases) {
  const result = routeAdminIntent(text, pending);
  if (!assert(result)) throw new Error(`第二阶段验收失败：${id} -> ${JSON.stringify(result)}`);
  console.log(`PASS  ${id}`);
}

if (!isRoomNumber("1306") || isRoomNumber("13a") || !isRoomNumber(" 1208 ")) throw new Error("房号校验不通过");
if (parseAmount("680元") !== 680 || parseAmount("abc") !== null || parseAmount(" 1299 ") !== 1299) throw new Error("金额解析不通过");
console.log("PASS  确认卡字段格式校验");

const pageMarkers = ["AdminPipeline", "结束录音", "发送", "重试", "正在理解管理员意图", "麦克风", "模型", "工具", "确认", "打扫完成，改为可售", "markAdminRoomClean", "AdminDataPanel", "数据库表（点击查看前 20 行）", "在住客人的房间与是否需要服务", "AdminKnowledgePanel", "政策知识库（店长自己维护，不用写 SQL）", "试问：客人这么问，系统会答什么", "canManage={adminUser.permissions.includes(\"admin:manage_knowledge\")}"];
for (const marker of pageMarkers) if (!page.includes(marker)) throw new Error(`管理后台缺少可视化/按钮标记：${marker}`);
console.log("PASS  管理后台状态可视化与语音按钮");

const streamMarkers = ["connecting", "understanding", "planning", "awaiting_confirmation"];
for (const marker of streamMarkers) if (!llm.includes(marker) || !route.includes("event.stage")) throw new Error(`管理员流式阶段缺失：${marker}`);
console.log("PASS  管理员模型流式阶段");

if (!asr.includes('"is_final": False') || !asr.includes("ASR_PARTIAL_INTERVAL")) throw new Error("本地 ASR 缺少临时识别结果");
console.log("PASS  本地 ASR 临时识别文字");

for (const marker of ["room_change_conflict", "admin_action_expired", "admin_action_not_confirmable"]) if (!adminService.includes(marker)) throw new Error(`确认单安全边界缺失：${marker}`);
console.log("PASS  占用、过期、重复提交保护");

for (const name of adminToolNames) {
  if (!adminToolArgumentSchemas[name]) throw new Error(`管理员工具缺少参数校验：${name}`);
  if (!adminToolPermissions[name]) throw new Error(`管理员工具缺少权限映射：${name}`);
}
for (const permission of adminPermissions) {
  if (!Object.values(rolePermissions).some((list) => list.includes(permission))) throw new Error(`管理员权限未授予任何角色：${permission}`);
}
if (![rolePermissions.owner, rolePermissions.manager, rolePermissions.housekeeping].every((list) => list.includes("admin:housekeeping"))) throw new Error("客房/店长/老板应能确认打扫完成");
if (![rolePermissions.owner, rolePermissions.manager].every((list) => list.includes("admin:purge_data"))) throw new Error("店长/老板应能清理历史数据");
if (rolePermissions.housekeeping.includes("admin:purge_data") || rolePermissions.frontdesk.includes("admin:purge_data")) throw new Error("客房和前台不应能删除业务记录");
if (rolePermissions.housekeeping.includes("admin:read_database") || rolePermissions.frontdesk.includes("admin:read_database")) throw new Error("只有店长和老板能读原始数据库");
if (!rolePermissions.housekeeping.includes("admin:service")) throw new Error("客房应能登记房间需要什么服务");
if (rolePermissions.frontdesk.includes("admin:housekeeping")) throw new Error("前台不应能把脏房直接标为可售");
if (!adminService.includes("ADMIN_ROOM_MARKED_CLEAN")) throw new Error("打扫完成缺少管理员审计事件");
if (![rolePermissions.owner, rolePermissions.manager].every((list) => list.includes("admin:manage_knowledge"))) throw new Error("店长/老板应能在后台维护门店政策");
if (rolePermissions.frontdesk.includes("admin:manage_knowledge") || rolePermissions.housekeeping.includes("admin:manage_knowledge")) throw new Error("前台和客房不应能改客人拿到的政策答案");
for (const name of ["admin.list_knowledge_documents", "admin.get_knowledge_document", "admin.preview_knowledge_answer", "admin.prepare_knowledge_document", "admin.prepare_knowledge_status"]) {
  if (adminToolPermissions[name] !== "admin:manage_knowledge") throw new Error(`政策工具权限映射不正确：${name}`);
}
if (!adminService.includes("ADMIN_KNOWLEDGE_DOCUMENT_SAVED") || !adminService.includes("ADMIN_KNOWLEDGE_STATUS_CHANGED")) throw new Error("政策变更缺少管理员审计事件");
if (!adminService.includes("knowledge_document_save") || !adminService.includes("knowledge_document_status")) throw new Error("政策变更没有走确认单执行路径");
console.log("PASS  管理员工具面与权限授予完整（每个工具都有参数校验与权限，客房/店长/老板可改可售，前台不可）");

const cleanSchema = adminToolArgumentSchemas["admin.mark_room_clean"];
if (!cleanSchema.safeParse({ room_number: "1208" }).success) throw new Error("合法房号被拒绝");
if (cleanSchema.safeParse({ room_number: "12" }).success) throw new Error("非法房号未被拒绝");
if (cleanSchema.safeParse({}).success) throw new Error("缺少房号仍然通过校验");
console.log("PASS  打扫完成的房号格式校验");

const purgeSchema = adminToolArgumentSchemas["admin.prepare_purge_closed_loops"];
for (const range of ["3d", "7d", "30d", "180d", "365d"]) {
  if (!purgeSchema.safeParse({ range }).success) throw new Error(`合法区间被拒绝：${range}`);
}
if (purgeSchema.safeParse({ range: "1d" }).success) throw new Error("非法区间未被拒绝");
if (purgeSchema.safeParse({}).success) throw new Error("缺少时间范围仍然通过校验");
console.log("PASS  清理区间只接受五档");

const knowledgeSchema = adminToolArgumentSchemas["admin.prepare_knowledge_document"];
const knowledgeDraft = { title: "加床政策", effective_from: "2026-09-20", chunks: ["加床需提前一天预约。"] };
if (!knowledgeSchema.safeParse(knowledgeDraft).success) throw new Error("合法的政策草稿被拒绝");
if (knowledgeSchema.safeParse({ ...knowledgeDraft, chunks: [] }).success) throw new Error("没有切片的草稿仍然通过校验");
if (knowledgeSchema.safeParse({ ...knowledgeDraft, chunks: Array.from({ length: 21 }, () => "政策") }).success) throw new Error("切片超过 20 条仍然通过校验");
if (knowledgeSchema.safeParse({ ...knowledgeDraft, effective_from: "2026/09/20" }).success) throw new Error("非 ISO 日期仍然通过校验");
if (knowledgeSchema.safeParse({ ...knowledgeDraft, visibility: "everyone" }).success) throw new Error("非法可见范围仍然通过校验");
if (!knowledgeSchema.safeParse({ ...knowledgeDraft, keywords: "车位 停车费 车库" }).success) throw new Error("合法关键词被拒绝");
if (knowledgeSchema.safeParse({ ...knowledgeDraft, keywords: "关键词".repeat(80) }).success) throw new Error("超长关键词仍然通过校验");
const statusSchema = adminToolArgumentSchemas["admin.prepare_knowledge_status"];
for (const status of ["active", "draft", "retired"]) {
  if (!statusSchema.safeParse({ document_id: "kb-gz-breakfast", status, reason: "店长维护" }).success) throw new Error(`合法状态被拒绝：${status}`);
}
if (statusSchema.safeParse({ document_id: "kb-gz-breakfast", status: "deleted", reason: "店长维护" }).success) throw new Error("非法状态仍然通过校验");
console.log("PASS  政策录入表单与状态校验");

console.log(`Admin phase-2 acceptance passed: ${cases.length + 13} checks.`);
