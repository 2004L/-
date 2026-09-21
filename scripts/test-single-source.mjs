import { readFileSync } from "node:fs";
import {
  LEGACY_ORDER_STATUS_TO_RESERVATION,
  legacyOccupiedStatusList,
  legacyOrderStatusToReservation,
  formalRoomId,
  RESERVATION_STATUS,
} from "../lib/hotel-core.ts";

const read = (file) => readFileSync(file, "utf8");
// 投影 SQL 住在 legacy-projection-core.ts，适配层只负责执行；两处一起看才是完整的旧数据投影。
const legacySync = read("lib/legacy-core-sync.ts") + read("lib/legacy-projection-core.ts");
const pmsSync = read("lib/pms-core-sync.ts");
const workflow = read("lib/workflow-engine.ts");
const transition = read("app/api/admin/workflows/[workflowId]/transition/route.ts");
const pmsRoute = read("app/api/pms/[operation]/route.ts");

if (legacyOrderStatusToReservation("awaiting_arrival") !== RESERVATION_STATUS.CONFIRMED) throw new Error("legacy awaiting_arrival 映射错误");
if (legacyOrderStatusToReservation("in_house") !== RESERVATION_STATUS.CHECKED_IN) throw new Error("legacy in_house 映射错误");
if (legacyOrderStatusToReservation("checked_out") !== RESERVATION_STATUS.CHECKED_OUT) throw new Error("legacy checked_out 映射错误");
if (legacyOrderStatusToReservation("cancelled") !== RESERVATION_STATUS.CANCELLED) throw new Error("legacy cancelled 映射错误");
if (legacyOrderStatusToReservation("unknown_status") !== RESERVATION_STATUS.PENDING_CONFIRMATION) throw new Error("未知状态必须回落到待确认");
if (legacyOccupiedStatusList() !== "'in_house', 'checkin_confirmed'") throw new Error("占用状态清单不正确");
if (formalRoomId("hotel-gz-demo", "1306") !== "room-hotel-gz-demo-1306") throw new Error("正式房间 id 生成错误");
if (!Object.keys(LEGACY_ORDER_STATUS_TO_RESERVATION).length) throw new Error("状态映射表为空");
console.log("PASS  单一状态映射与房间 id");

if (!legacySync.includes("LEGACY_ORDER_STATUS_TO_RESERVATION")) throw new Error("旧数据投影未使用统一状态映射");
if (/CASE status\s+WHEN 'awaiting_arrival'/.test(legacySync)) throw new Error("旧数据投影仍散落状态 CASE");
if (!legacySync.includes("r.reservation_no = demo_orders.order_code")) throw new Error("旧数据投影没有按订单号解析真实预订，子记录可能再次指向不存在的预订");
if (!legacySync.includes("NOT EXISTS (SELECT 1 FROM stays existing")) throw new Error("旧数据投影缺少入住记录去重，会写出同一预订的第二条入住记录");
console.log("PASS  旧数据投影走统一映射，并按订单号挂到真实预订上");

if (!pmsSync.includes("ON CONFLICT(hotel_id, room_number) DO UPDATE")) throw new Error("PMS 目录同步未按房间号 upsert");
if (!pmsSync.includes("formalRoomId(input.hotelId, room.roomNumber)")) throw new Error("PMS 目录同步未使用统一房间 id");
if (/(status|version) = excluded\./.test(pmsSync)) throw new Error("PMS 目录同步不得覆盖房态或版本号");
console.log("PASS  PMS 目录同步 upsert 且保留房态");

if (!workflow.includes("export function isValidWorkflowStep") || !workflow.includes("isValidWorkflowStep(input.stepKey)")) throw new Error("工作流步骤校验未导出/未使用");
if (transition.indexOf("isValidWorkflowStep(body.current_step)") > transition.indexOf("transitionWorkflow(")) throw new Error("工作流步骤必须先校验再写入");
console.log("PASS  工作流先校验后写");

for (const marker of ["admin_auth_required", "pms_write_requires_formal_flow", "\"ping\"", "formal-reservations", "formal-rooms"]) {
  if (!pmsRoute.includes(marker)) throw new Error(`PMS 路由缺少标记：${marker}`);
}
if (pmsRoute.includes("GZ-HAOS-001") || pmsRoute.includes("simulatorPms")) throw new Error("PMS 路由仍硬编码门店或直接改内存态");
console.log("PASS  PMS 路由鉴权与正式事实来源");

console.log("Single source of truth stopgap passed: 5 groups.");
