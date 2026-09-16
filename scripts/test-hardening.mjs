import { performance } from "node:perf_hooks";

const rounds = Math.max(1, Number(process.env.PRESSURE_ROUNDS ?? 10));
const concurrency = Math.max(1, Number(process.env.PRESSURE_CONCURRENCY ?? 8));

// 默认只做本地并发/幂等压力模型；设置 TARGET_BASE_URL 才会主动请求外部环境。
const snapshot = { version: 1, room: null, commands: new Map() };
const hold = (room, expectedVersion) => {
  if (snapshot.version !== expectedVersion || snapshot.room) return { status: 409 };
  snapshot.room = room;
  snapshot.version += 1;
  return { status: 200 };
};
const version = snapshot.version;
const race = [hold("1208", version), hold("1208", version)];
if (race.filter((item) => item.status === 200).length !== 1 || race.filter((item) => item.status === 409).length !== 1) throw new Error("并发锁房不变量失败");
const idempotent = (key) => {
  if (!snapshot.commands.has(key)) snapshot.commands.set(key, { command_id: `cmd-${snapshot.commands.size + 1}`, audit_delta: 1 });
  return snapshot.commands.get(key);
};
if (idempotent("checkin:demo") !== idempotent("checkin:demo") || snapshot.commands.size !== 1) throw new Error("幂等重试不变量失败");
console.log("PASS  本地并发模型：同一房间一次成功、一次 409；幂等键只生成一条命令");

const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
if (!base) {
  console.log("SKIP  未设置 TARGET_BASE_URL，未触碰任何外部服务。需要实压时再显式设置目标地址。");
  process.exit(0);
}

const samples = [];
let failures = 0;
for (let round = 0; round < rounds; round += 1) {
  const batch = await Promise.all(Array.from({ length: concurrency }, async () => {
    const started = performance.now();
    try {
      const response = await fetch(`${base}/api/health`, { headers: { Accept: "application/json" } });
      samples.push(performance.now() - started);
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
      samples.push(performance.now() - started);
    }
    return true;
  }));
  void batch;
}
samples.sort((a, b) => a - b);
const percentile = (ratio) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * ratio))] ?? 0;
const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
console.log(`HTTP pressure: ${samples.length} requests, failures=${failures}, avg=${Math.round(average)}ms, p50=${Math.round(percentile(0.5))}ms, p95=${Math.round(percentile(0.95))}ms`);
if (failures > 0) process.exitCode = 1;
