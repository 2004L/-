import { readFileSync } from "node:fs";
import {
  ORDER_STATUS,
  canTransitionOrder,
  assertOrderTransition,
  legacyStatusToOrderStatus,
} from "../lib/hotel-core.ts";

const read = (file) => readFileSync(file, "utf8");
const schema = read("db/schema.ts");
const migration = read("drizzle/0013_orders.sql");
const journal = read("drizzle/meta/_journal.json");
const orders = read("lib/orders.ts");
const ordersCore = read("lib/orders-core.ts");
const adminService = read("lib/admin-service.ts");
const legacySync = read("lib/legacy-core-sync.ts");

if (!canTransitionOrder(ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID)) throw new Error("待支付应可变为已支付");
if (!canTransitionOrder(ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.CANCELLED)) throw new Error("待支付应可取消");
if (!canTransitionOrder(ORDER_STATUS.PAID, ORDER_STATUS.REFUNDED)) throw new Error("已支付应可退款");
if (canTransitionOrder(ORDER_STATUS.CANCELLED, ORDER_STATUS.PAID)) throw new Error("已取消订单不得回到已支付");
if (canTransitionOrder(ORDER_STATUS.CLOSED, ORDER_STATUS.REFUNDED)) throw new Error("已关闭订单不得再退款");
let threw = false;
try { assertOrderTransition(ORDER_STATUS.REFUNDED, ORDER_STATUS.PAID); } catch { threw = true; }
if (!threw) throw new Error("非法订单状态流转必须抛错");
if (legacyStatusToOrderStatus("in_house") !== ORDER_STATUS.PAID) throw new Error("已入住应视为已支付");
if (legacyStatusToOrderStatus("cancelled") !== ORDER_STATUS.CANCELLED) throw new Error("已取消映射错误");
if (legacyStatusToOrderStatus("unknown") !== ORDER_STATUS.PENDING_PAYMENT) throw new Error("未知状态必须回落到待支付");
console.log("PASS  订单状态机与旧状态映射");

if (!schema.includes('sqliteTable("orders"')) throw new Error("db/schema.ts 缺少 orders 表");
if (!migration.includes("CREATE TABLE IF NOT EXISTS orders")) throw new Error("0013 迁移缺少 orders 建表");
for (const index of ["orders_hotel_no_uq", "orders_hotel_idempotency_uq", "orders_hotel_status_idx"]) {
  if (!migration.includes(index)) throw new Error(`0013 迁移缺少索引：${index}`);
}
if (!journal.includes("0013_orders")) throw new Error("迁移日志未登记 0013_orders");
console.log("PASS  orders 表与迁移");

for (const marker of ["ensureOrdersSchema", "updateOrderAmount", "transitionOrderStatus", "createOrder", "projectOrderToLegacy"]) {
  if (!orders.includes(marker)) throw new Error(`订单服务缺少能力：${marker}`);
}
for (const marker of ["ORDERS_DDL", "updateOrderAmountWith", "transitionOrderStatusWith", "createOrderWith", "projectOrderToLegacyWith", "assertOrderTransition"]) {
  if (!ordersCore.includes(marker)) throw new Error(`订单核心缺少能力：${marker}`);
}
if (!ordersCore.includes("version = version + 1")) throw new Error("订单写入必须原子递增版本号");
if (!ordersCore.includes("AND version = ?")) throw new Error("订单写入必须做版本号条件更新");
if (!ordersCore.includes("AND status = ?")) throw new Error("订单状态流转必须检查预期旧状态");
if (!ordersCore.includes("classifyOrderWriteMiss")) throw new Error("零影响行必须区分不存在与并发冲突");
if (!ordersCore.includes("ORDER_ERRORS.IDEMPOTENCY_REUSED") || !ordersCore.includes("matchesCreateRequest")) throw new Error("创建订单缺少幂等参数一致性校验");
if (ordersCore.includes("catch") && /catch\s*\([^)]*\)\s*\{\s*return\s+order/i.test(ordersCore)) throw new Error("订单核心不得吞掉写入失败");
console.log("PASS  订单服务原子写入、版本号与幂等");

if (!adminService.includes("updateOrderAmount")) throw new Error("金额调整未写入 orders");
if (!adminService.includes("expectedVersion") || !adminService.includes("order_version")) throw new Error("金额调整未携带订单版本号做条件更新");
if (!adminService.includes("amount_source")) throw new Error("管理员订单查询未标记金额来源，兼容回落会被静默掩盖");
if (!adminService.includes("missing a formal order")) throw new Error("正式订单缺失时缺少可观测性告警");
if (!orders.includes("OrderWriteResult") || !orders.includes("projection")) throw new Error("订单写入未返回投影结果，投影失败不可观测");
if (!adminService.includes("projectionNote") || !adminService.includes("projection: updated.projection")) throw new Error("管理员金额调整未把投影结果写入结果与审计");
if (/UPDATE demo_orders SET \$\{?column/.test(adminService) || adminService.includes("UPDATE demo_orders SET ${column}")) throw new Error("金额调整仍在直接写 demo_orders");
if (!adminService.includes("JOIN orders o ON o.hotel_id")) throw new Error("管理员订单查询未关联 orders");
if (!adminService.includes("COALESCE(o.total_amount, r.total_amount)")) throw new Error("管理员订单查询缺少金额回落");
console.log("PASS  金额归属 orders，reservations 只保留住宿事实");

if (!legacySync.includes("ordersLegacyBackfillSql")) throw new Error("旧数据投影未复用回填 SQL");
if (!ordersCore.includes("ordersLegacyBackfillSql") || !ordersCore.includes("INSERT OR IGNORE INTO orders")) throw new Error("订单核心缺少旧数据回填 SQL");
console.log("PASS  旧数据投影回填 orders");

console.log("Orders migration passed: 5 groups.");
