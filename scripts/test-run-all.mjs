import { spawnSync } from "node:child_process";

/**
 * Aggregate test runner used by CI. Each suite is spawned as its own process so
 * a crash in one suite cannot silently swallow the others, and every failure is
 * reported with a non-zero exit code.
 */
const STRIP_TYPES = "--experimental-strip-types";

const suites = [
  ["secrets", [], "check-secrets.mjs"],
  ["foundation", [], "test-foundation.mjs"],
  ["core-domain", [], "test-core-domain.mjs"],
  ["contracts", [], "test-contracts.mjs"],
  ["replay", [], "test-cases.mjs"],
  ["invariants", [], "test-invariants.mjs"],
  ["concurrency", [], "test-concurrency.mjs"],
  ["hardening", [], "test-hardening.mjs"],
  ["intents", [STRIP_TYPES], "test-intent-rules.mjs"],
  ["admin-intents", [STRIP_TYPES], "test-admin-intent-rules.mjs"],
  ["admin-credentials", [STRIP_TYPES], "test-admin-credentials.mjs"],
  ["admin-phase2", [STRIP_TYPES], "test-admin-phase2.mjs"],
  ["single-source", [STRIP_TYPES], "test-single-source.mjs"],
  ["orders", [STRIP_TYPES], "test-orders.mjs"],
  ["orders-concurrency", [STRIP_TYPES], "test-orders-concurrency.mjs"],
  ["orders-d1", [STRIP_TYPES], "test-orders-d1.mjs"],
  ["checkin-d1", [STRIP_TYPES], "test-checkin-d1.mjs"],
  ["data-governance-d1", [STRIP_TYPES], "test-data-governance-d1.mjs"],
  ["handoff-d1", [STRIP_TYPES], "test-handoff-d1.mjs"],
];

const failures = [];
for (const [name, flags, file] of suites) {
  console.log(`\n=== ${name} (${file}) ===`);
  const result = spawnSync(process.execPath, [...flags, `scripts/${file}`], { stdio: "inherit" });
  if (result.status !== 0) failures.push(name);
}

if (failures.length) {
  console.error(`\nFailed suites: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${suites.length} suites passed.`);
