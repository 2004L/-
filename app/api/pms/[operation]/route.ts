import { NextRequest, NextResponse } from "next/server";

type Operation = "orders" | "rooms" | "hold" | "checkin" | "checkout";

const TEMPORARY_API_KEY = "TEMP_PMS_API_KEY_REPLACE_ME";
const HOTEL = {
  propertyCode: "GZ-HAOS-001",
  name: "Hotel Agent OS 广州示范店",
  roomTypes: [
    { code: "DLX-KING", name: "高楼层大床房", pmsCode: "GZ-HAOS-001-DLX-KING" },
    { code: "DLX-TWIN", name: "高楼层双床房", pmsCode: "GZ-HAOS-001-DLX-TWIN" },
  ],
  rooms: [
    { number: "1208", roomTypeCode: "DLX-KING", pmsCode: "GZ-HAOS-001-1208" },
    { number: "1210", roomTypeCode: "DLX-TWIN", pmsCode: "GZ-HAOS-001-1210" },
  ],
};

function config() {
  const apiKey = process.env.PMS_API_KEY ?? TEMPORARY_API_KEY;
  return {
    provider: process.env.PMS_PROVIDER ?? "qloapps",
    version: process.env.PMS_VERSION ?? "1.6.1",
    baseUrl: process.env.PMS_BASE_URL ?? "https://pms.example.local/api",
    apiKey,
    temporaryKey: apiKey === TEMPORARY_API_KEY,
  };
}

function payload(operation: Operation, request: NextRequest) {
  const url = new URL(request.url);
  const c = config();
  const base = {
    ok: true,
    adapter: c.provider,
    pmsVersion: c.version,
    mode: c.temporaryKey ? "temporary-placeholder" : "live-ready",
    temporaryNotice: c.temporaryKey ? "临时占位：替换 PMS_API_KEY 后再启用真实 PMS 请求" : null,
    property: HOTEL,
    operation,
    traceId: `pms-${Date.now()}`,
  };

  if (operation === "orders") {
    return { ...base, matchStrategy: "phone-first-vector-search", query: url.searchParams.get("phone") ?? "masked-phone", orders: [{ orderId: "DEMO-MEITUAN-34908", source: "美团", status: "confirmed", guestPhone: "masked", stay: { nights: 1, roomTypeCode: "DLX-KING" } }, { orderId: "DEMO-DY-22881", source: "抖音团购", status: "confirmed", guestPhone: "masked", stay: { nights: 1, roomTypeCode: "DLX-KING" } }] };
  }
  if (operation === "rooms") return { ...base, rooms: HOTEL.rooms.map((room) => ({ ...room, status: "vacant-clean", holdable: true })) };
  if (operation === "hold") return { ...base, reservationId: "DEMO-MEITUAN-34908", roomNumber: "1208", status: "held", expiresInSeconds: 600, idempotencyKey: "checkin-CI-20260913-0087" };
  if (operation === "checkin") return { ...base, reservationId: "DEMO-MEITUAN-34908", status: "checked-in", actualCheckInAt: new Date().toISOString(), policeReceipt: "SIMULATED-RECEIPT" };
  return { ...base, reservationId: "DEMO-MEITUAN-34908", status: "checked-out", actualCheckOutAt: new Date().toISOString(), housekeepingEvent: "created" };
}

async function handle(request: NextRequest, params: Promise<{ operation: string }>) {
  const { operation: rawOperation } = await params;
  const operation = rawOperation as Operation;
  if (!["orders", "rooms", "hold", "checkin", "checkout"].includes(operation)) {
    return NextResponse.json({ ok: false, error: "unsupported_operation" }, { status: 404 });
  }
  return NextResponse.json(payload(operation, request));
}

export async function GET(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  return handle(request, context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  return handle(request, context.params);
}
