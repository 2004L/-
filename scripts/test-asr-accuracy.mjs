import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultManifest = path.join(root, "fixtures", "asr-cases.jsonl");
const manifestArg = process.argv.find((arg) => arg.startsWith("--manifest="));
const urlArg = process.argv.find((arg) => arg.startsWith("--url="));
const verbose = process.argv.includes("--verbose");
const manifestPath = path.resolve(manifestArg?.slice("--manifest=".length) ?? defaultManifest);
const asrUrl = urlArg?.slice("--url=".length) || process.env.ASR_WS_URL || "ws://127.0.0.1:8765/asr";
const maxCer = Number(process.env.ASR_MAX_CER ?? "0.08");
const maxLatencyMs = Number(process.env.ASR_MAX_LATENCY_MS ?? "5000");
const timeoutMs = Number(process.env.ASR_CASE_TIMEOUT_MS ?? "30000");

function fail(message, code = 2) {
  console.error(`ASR 验收未完成：${message}`);
  process.exitCode = code;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function cer(expected, actual) {
  const left = Array.from(normalizeText(expected));
  const right = Array.from(normalizeText(actual));
  if (!left.length) return right.length ? 1 : 0;
  return editDistance(left, right) / left.length;
}

const digitMap = new Map(Object.entries({ 零: "0", 〇: "0", 洞: "0", 幺: "1", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" }));

function digitText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[零〇洞幺一二两三四五六七八九]/gu, (char) => digitMap.get(char) ?? char);
}

function phoneLast4(text) {
  const candidates = digitText(text).match(/\d+/g) ?? [];
  const candidate = candidates.find((value) => value.length >= 4);
  return candidate?.slice(-4) ?? null;
}

function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = new Map([["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9]]);
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? (digits.get(tens) ?? 0) * 10 : 10) + (ones ? (digits.get(ones) ?? 0) : 0);
  }
  return digits.get(value) ?? null;
}

function roomCount(text) {
  const match = digitText(text).match(/(\d+|[一二两三四五六七八九十]+)\s*(?:间|个房|套)/u);
  return match ? chineseNumber(match[1]) : null;
}

function checkFields(expectedFields, actual) {
  const fields = expectedFields && typeof expectedFields === "object" ? expectedFields : {};
  const checks = [];
  if (fields.phone_last4 !== undefined) checks.push(["phone_last4", String(fields.phone_last4), phoneLast4(actual)]);
  if (fields.room_count !== undefined) checks.push(["room_count", String(fields.room_count), String(roomCount(actual) ?? "")]);
  return checks.map(([name, expected, actualValue]) => ({ name, expected, actual: actualValue ?? "", pass: expected === (actualValue ?? "") }));
}

function readCases() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`找不到样本清单 ${path.relative(root, manifestPath)}。请先把真实录音放入 fixtures/asr-audio，并按 docs/asr-acceptance.md 建立清单。`);
  }
  return fs.readFileSync(manifestPath, "utf8")
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"))
    .map(({ line, index }) => {
      try { return JSON.parse(line); } catch { throw new Error(`样本清单第 ${index} 行不是有效 JSON`); }
    });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("连接 ASR 超时")), timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`无法连接 ${asrUrl}`)); }, { once: true });
  });
}

async function transcribe(audioPath) {
  const socket = new WebSocket(asrUrl);
  await waitForOpen(socket);
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASR 返回超时")), timeoutMs);
    socket.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(String(event.data)); } catch { return; }
      if (payload.type === "error") {
        clearTimeout(timer);
        reject(new Error(payload.code || payload.message || "ASR 返回错误"));
      } else if (payload.type === "result") {
        clearTimeout(timer);
        resolve(payload);
      }
    });
  });
  socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
  const audio = fs.readFileSync(audioPath);
  for (let offset = 0; offset < audio.length; offset += 64 * 1024) socket.send(audio.subarray(offset, Math.min(offset + 64 * 1024, audio.length)));
  socket.send(JSON.stringify({ type: "stop" }));
  try { return await result; } finally { socket.close(); }
}

async function main() {
  let cases;
  try { cases = readCases(); } catch (error) { fail(error instanceof Error ? error.message : String(error)); return; }
  if (!cases.length) { fail("样本清单为空，不能通过验收"); return; }
  const rows = [];
  for (const item of cases) {
    const id = String(item.id ?? `case-${rows.length + 1}`);
    const audioPath = path.resolve(path.dirname(manifestPath), String(item.audio ?? ""));
    const startedAt = performance.now();
    try {
      if (!fs.existsSync(audioPath)) throw new Error(`找不到录音 ${path.relative(root, audioPath)}`);
      const payload = await transcribe(audioPath);
      const actual = String(payload.text ?? "").trim();
      const elapsedMs = Math.round(performance.now() - startedAt);
      const score = cer(item.expected, actual);
      const fieldChecks = checkFields(item.fields, actual);
      const pass = score <= Number(item.max_cer ?? maxCer) && elapsedMs <= Number(item.max_latency_ms ?? maxLatencyMs) && fieldChecks.every((field) => field.pass);
      rows.push({ id, pass, cer: Number(score.toFixed(4)), latency_ms: elapsedMs, field_checks: fieldChecks, expected_length: Array.from(normalizeText(item.expected)).length, actual_length: Array.from(normalizeText(actual)).length });
      console.log(`${pass ? "PASS" : "FAIL"} ${id.padEnd(28)} CER ${(score * 100).toFixed(1)}%  ${elapsedMs}ms  ${fieldChecks.map((field) => `${field.name}:${field.pass ? "OK" : "错"}`).join(" ")}`);
      if (verbose && !pass) console.log(`  expected=${item.expected}\n  actual=${actual}`);
    } catch (error) {
      rows.push({ id, pass: false, error: error instanceof Error ? error.message : String(error) });
      console.log(`FAIL ${id.padEnd(28)} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const passed = rows.filter((row) => row.pass).length;
  const summary = { manifest: path.relative(root, manifestPath), asr_url: asrUrl.replace(/\/\/[^/]+@/u, "//***@"), total: rows.length, passed, failed: rows.length - passed, pass_rate: Number((passed / rows.length).toFixed(4)), max_cer: maxCer, max_latency_ms: maxLatencyMs, cases: rows };
  const outputPath = path.join(root, "reports", "asr-accuracy-latest.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`\nASR 验收：${passed}/${rows.length} 通过；报告已写入 ${path.relative(root, outputPath)}`);
  if (passed !== rows.length) process.exitCode = 1;
}

await main();
