import {
  ADMIN_DEMO_ACCOUNTS,
  PBKDF2_ITERATIONS,
  demoPasswordFor,
  demoSeedPlan,
  hashPasswordWithSalt,
  isProductionLike,
  needsSaltRotation,
} from "../lib/admin-credentials.ts";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const envOf = (values) => (name) => values[name];

console.log("== 演示账号口令策略");
const missing = demoSeedPlan(envOf({}));
check("未配置口令时不再创建演示账号", missing.enabled === false && missing.reason === "demo_password_missing" && missing.accounts.length === 0, JSON.stringify(missing));

const shared = demoSeedPlan(envOf({ ADMIN_DEMO_PASSWORD: "hotel-demo-2026" }));
check("配置共享口令后创建 4 个账号", shared.enabled === true && shared.accounts.length === 4);
check("共享口令模式仍可逐角色覆盖", shared.accounts.every((account) => account.password === "hotel-demo-2026"));

const scoped = demoSeedPlan(envOf({ ADMIN_DEMO_PASSWORD: "shared-pass", ADMIN_DEMO_PASSWORD_OWNER: "owner-pass" }));
check("逐角色口令优先于共享口令", scoped.accounts.find((account) => account.username === "owner")?.password === "owner-pass" && scoped.accounts.find((account) => account.username === "manager")?.password === "shared-pass");

const prod = demoSeedPlan(envOf({ NODE_ENV: "production", ADMIN_DEMO_PASSWORD: "hotel-demo-2026" }));
check("生产环境默认关闭演示账号", prod.enabled === false && prod.reason === "demo_accounts_disabled", JSON.stringify(prod));
check("isProductionLike 识别 prod", isProductionLike(envOf({ NODE_ENV: "production" })) && isProductionLike(envOf({ ENVIRONMENT: "prod" })) && !isProductionLike(envOf({})));

console.log("\n== 每账号独立盐与哈希");
const first = await hashPasswordWithSalt("hotel-demo-2026");
const second = await hashPasswordWithSalt("hotel-demo-2026");
check("同一口令两次哈希得到不同盐", first.salt !== second.salt, `${first.salt} vs ${second.salt}`);
check("同一口令两次哈希得到不同哈希", first.hash !== second.hash);
check("哈希格式保持兼容", first.hash.startsWith(`pbkdf2$${PBKDF2_ITERATIONS}$${first.salt}$`), first.hash.slice(0, 40));
const replay = await hashPasswordWithSalt("hotel-demo-2026", first.salt);
check("固定盐可复现哈希（供登录校验）", replay.hash === first.hash);

console.log("\n== 共享盐检测与轮换");
const sharedRows = ADMIN_DEMO_ACCOUNTS.map((account) => ({ id: account.id, password_salt: "571cd1ef29384c9b971783b19cb4b65f" }));
check("检测到共享盐", needsSaltRotation(sharedRows) === true);
const uniqueRows = await Promise.all(ADMIN_DEMO_ACCOUNTS.map(async (account, index) => ({ id: account.id, password_salt: (await hashPasswordWithSalt("x", `salt-${index}`)).salt })));
check("独立盐不再触发轮换", needsSaltRotation(uniqueRows) === false);
check("缺少盐的账号也会触发轮换", needsSaltRotation([{ id: "admin-owner-demo", password_salt: null }, { id: "admin-manager-demo", password_salt: null }]) === true);
check("逐角色口令解析无硬编码回退", demoPasswordFor(ADMIN_DEMO_ACCOUNTS[0], envOf({})) === null);

if (failures) {
  console.error(`\nAdmin credential checks FAILED: ${failures}.`);
  process.exit(1);
}
console.log("\nAdmin credential checks passed.");
