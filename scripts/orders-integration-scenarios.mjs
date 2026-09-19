import { ORDER_STATUS } from "../lib/hotel-core.ts";
import {
  ORDER_ERRORS,
  createOrderWith,
  ordersLegacyBackfillSql,
  projectOrderToLegacyWith,
  readOrder,
  transitionOrderStatusWith,
  updateOrderAmountWith,
} from "../lib/orders-core.ts";

const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";

/**
 * Order concurrency/idempotency scenarios. The same file runs against a real
 * D1 binding (miniflare/workerd) and against node:sqlite with two connections,
 * so the production SQL and the test assertions cannot drift apart.
 */
export async function runOrderScenarios({ runnerA, runnerB, check }) {
  const base = (overrides) => ({ tenantId: TENANT, hotelId: HOTEL, source: "美团", roomAmount: 380, depositAmount: 300, totalAmount: 680, ...overrides });
  const countOrders = async (orderNo) => Number((await runnerA.first("SELECT COUNT(*) AS c FROM orders WHERE hotel_id = ? AND order_no = ?", [HOTEL, orderNo])).c);
  const seedDemoOrder = (id, orderCode, total) => runnerA.run(
    "INSERT INTO demo_orders (id, tenant_id, hotel_id, order_code, source, guest_label, phone_last4, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, TENANT, HOTEL, orderCode, "美团", "演示住客", "4821", "awaiting_arrival", null, 380, 300, total, "2026-09-17T00:00:00.000Z", "2026-09-17T00:00:00.000Z"],
  );

  console.log("== 1. 同一订单金额并发修改");
  const amountOrder = await createOrderWith(runnerA, base({ orderNo: "O-AMT", idempotencyKey: "k-amt", totalAmount: 680 }));
  const version0 = amountOrder.order.version;
  const amountRace = await Promise.allSettled([
    updateOrderAmountWith(runnerA, { hotelId: HOTEL, orderNo: "O-AMT", amountType: "total_amount", amount: 700, expectedVersion: version0 }),
    updateOrderAmountWith(runnerB, { hotelId: HOTEL, orderNo: "O-AMT", amountType: "total_amount", amount: 800, expectedVersion: version0 }),
  ]);
  const amountWinners = amountRace.filter((item) => item.status === "fulfilled").length;
  const amountLoser = amountRace.find((item) => item.status === "rejected");
  check("两次并发金额修改只有一次成功", amountWinners === 1, `success=${amountWinners}`);
  check("失败方是版本冲突而非虚假成功", amountLoser?.status === "rejected" && amountLoser.reason.message === ORDER_ERRORS.VERSION_CONFLICT, amountLoser?.reason?.message);
  const amountAfter = await readOrder(runnerA, HOTEL, "O-AMT");
  check("版本号只递增一次", amountAfter.version === version0 + 1, `version=${amountAfter.version}`);
  check("落库金额等于胜出请求", [700, 800].includes(amountAfter.total_amount), String(amountAfter.total_amount));

  console.log("\n== 2. 支付与取消状态竞争");
  await createOrderWith(runnerA, base({ orderNo: "O-RACE", idempotencyKey: "k-race", totalAmount: 500 }));
  const statusRace = await Promise.allSettled([
    transitionOrderStatusWith(runnerA, { hotelId: HOTEL, orderNo: "O-RACE", from: ORDER_STATUS.PENDING_PAYMENT, to: ORDER_STATUS.PAID }),
    transitionOrderStatusWith(runnerB, { hotelId: HOTEL, orderNo: "O-RACE", from: ORDER_STATUS.PENDING_PAYMENT, to: ORDER_STATUS.CANCELLED }),
  ]);
  const statusWinners = statusRace.filter((item) => item.status === "fulfilled").length;
  const statusLoser = statusRace.find((item) => item.status === "rejected");
  check("支付与取消只有一次成功", statusWinners === 1, `success=${statusWinners}`);
  check("失败方是状态冲突", statusLoser?.status === "rejected" && statusLoser.reason.message === ORDER_ERRORS.STATUS_CONFLICT, statusLoser?.reason?.message);

  console.log("\n== 3. 同一幂等请求重复提交");
  const idemFirst = await createOrderWith(runnerA, base({ orderNo: "O-IDEM", idempotencyKey: "k-idem", totalAmount: 680 }));
  const idemSecond = await createOrderWith(runnerB, base({ orderNo: "O-IDEM", idempotencyKey: "k-idem", totalAmount: 680 }));
  check("重复请求复用同一订单", idemFirst.order.id === idemSecond.order.id);
  check("重复请求标记为幂等重放", idemSecond.idempotent === true);
  check("只产生一条订单", (await countOrders("O-IDEM")) === 1);

  console.log("\n== 4. 同一幂等 Key 不同请求参数");
  let reusedError = "";
  try { await createOrderWith(runnerA, base({ orderNo: "O-IDEM-DIFF", idempotencyKey: "k-idem", totalAmount: 999 })); }
  catch (error) { reusedError = error.message; }
  check("不同参数复用幂等 Key 被拒绝", reusedError === ORDER_ERRORS.IDEMPOTENCY_REUSED, reusedError);
  check("未产生第二条订单", (await countOrders("O-IDEM-DIFF")) === 0);

  console.log("\n== 5. 投影失败时正式订单保持正确");
  await createOrderWith(runnerA, base({ orderNo: "O-PROJ", idempotencyKey: "k-proj", totalAmount: 680 }));
  const projectionOrder = await updateOrderAmountWith(runnerA, { hotelId: HOTEL, orderNo: "O-PROJ", amountType: "total_amount", amount: 777 });
  const missingRow = await projectOrderToLegacyWith(runnerA, { ...projectionOrder, id: "ord-no-such-demo-row" });
  check("缺失演示投影行返回 no_legacy_row", missingRow === "no_legacy_row", missingRow);
  const projectionAfter = await readOrder(runnerA, HOTEL, "O-PROJ");
  check("投影失败不影响正式金额", projectionAfter.total_amount === 777, String(projectionAfter.total_amount));

  console.log("\n== 6. 正式订单缺失时的兼容行为");
  await seedDemoOrder("legacy-1", "O-LEGACY", 680);
  const fallback = await runnerA.first("SELECT d.order_code, o.id AS order_id, COALESCE(o.total_amount, d.total_amount) AS effective_total FROM demo_orders d LEFT JOIN orders o ON o.hotel_id = d.hotel_id AND o.order_no = d.order_code WHERE d.order_code = ?", ["O-LEGACY"]);
  check("正式订单缺失时回落演示金额", fallback.order_id === null && Number(fallback.effective_total) === 680, JSON.stringify(fallback));

  console.log("\n== 7. 旧数据回填不覆盖较新的正式订单");
  await createOrderWith(runnerA, base({ orderNo: "O-BACKFILL", idempotencyKey: "k-backfill", totalAmount: 999 }));
  await seedDemoOrder("legacy-backfill-1", "O-BACKFILL", 680);
  await runnerA.run(ordersLegacyBackfillSql(), [TENANT, HOTEL]);
  const backfilled = await readOrder(runnerA, HOTEL, "O-BACKFILL");
  check("回填不覆盖正式订单金额", backfilled.total_amount === 999, `total=${backfilled.total_amount}`);
  check("回填不覆盖正式订单版本", backfilled.version === 1, `version=${backfilled.version}`);

  console.log("\n== 8. 投影抛错时正式订单仍保持正确");
  await runnerA.run("DROP TABLE demo_orders", []);
  let projectionThrew = false;
  try { await projectOrderToLegacyWith(runnerA, projectionOrder); } catch { projectionThrew = true; }
  check("投影异常向上抛出（由适配层记录，不掩盖正式结果）", projectionThrew);
  const finalOrder = await readOrder(runnerA, HOTEL, "O-PROJ");
  check("投影异常后正式金额依旧正确", finalOrder.total_amount === 777, String(finalOrder.total_amount));

  return 17;
}
