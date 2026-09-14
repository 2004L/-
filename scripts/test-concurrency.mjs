class VersionedCase {
  constructor() {
    this.status = "IDENTITY_VERIFIED";
    this.version = 7;
    this.room = null;
  }
  hold(room, expectedVersion) {
    if (this.status !== "IDENTITY_VERIFIED" || this.version !== expectedVersion) return { status: 409, error: "concurrent_update" };
    this.status = "ROOM_HELD";
    this.room = room;
    this.version += 1;
    return { status: 200, state: this.status, version: this.version };
  }
}

const item = new VersionedCase();
const snapshot = item.version;
const results = [item.hold("1208", snapshot), item.hold("1208", snapshot)];
if (results.filter((result) => result.status === 200).length !== 1 || results.filter((result) => result.status === 409).length !== 1) {
  throw new Error(`并发锁房结果不符合预期：${JSON.stringify(results)}`);
}

const commands = new Map();
let auditCount = 0;
function idempotent(key) {
  if (commands.has(key)) return commands.get(key);
  const value = { command_id: "cmd-demo-1", status: "SUCCEEDED" };
  commands.set(key, value);
  auditCount += 1;
  return value;
}
const first = idempotent("hold:case-1:1208");
const second = idempotent("hold:case-1:1208");
if (first.command_id !== second.command_id || auditCount !== 1) throw new Error("幂等重试生成了重复命令或审计事件");
console.log("PASS  同一房间并发锁定 -> 一次成功 + 一次 409");
console.log("PASS  同一幂等键重试 -> 复用命令且只增加一条审计");
