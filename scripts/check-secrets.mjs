import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { spawnSync } from "node:child_process";

const stagedOnly = process.argv.includes("--staged");
const selfExcluded = new Set([
  ".gitleaks.toml",
  "scripts/check-secrets.mjs",
]);
const contentExcluded = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const safePlaceholders = ["TEMP_PMS_API_KEY_REPLACE_ME", "TEMP_LLM_API_KEY_REPLACE_ME"];

const detectors = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/g,
  },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  {
    name: "OpenAI-style key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: "live payment key",
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: "credential assignment",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\r\n\s]{12,}["']/gi,
  },
  {
    name: "Chinese resident identity number",
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
  },
];

function runGit(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(message?.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function candidateFiles() {
  const args = stagedOnly
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  return runGit(args)
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function riskyFilename(file) {
  const name = basename(file).toLowerCase();
  const extension = extname(name);
  if (name === "nul" || name === "sshgit.txt") return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(name)) return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
    return true;
  }
  if ([".pem", ".key", ".p12", ".pfx", ".jks", ".secret"].includes(extension)) {
    return true;
  }
  return file.toLowerCase().includes("/.ssh/") || file.toLowerCase().startsWith(".ssh/");
}

function fileBuffer(file) {
  if (stagedOnly) return runGit(["show", `:${file}`], null);
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

const findings = [];
for (const file of candidateFiles()) {
  if (riskyFilename(file)) {
    findings.push({ file, name: "sensitive filename", line: null });
  }
  if (selfExcluded.has(file) || contentExcluded.has(file)) continue;

  const buffer = fileBuffer(file);
  if (!buffer || buffer.includes(0)) continue;

  let text = buffer.toString("utf8");
  for (const placeholder of safePlaceholders) {
    text = text.replaceAll(placeholder, "DEMO");
  }
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      findings.push({
        file,
        name: detector.name,
        line: lineAt(text, match.index ?? 0),
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Security check failed. Potential sensitive material was found:");
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`- ${location} (${finding.name})`);
  }
  console.error("Values are intentionally hidden. Remove or rotate any real credential before committing.");
  process.exit(1);
}

console.log(
  stagedOnly
    ? "Security check passed for staged files."
    : "Security check passed for tracked and unignored files.",
);
