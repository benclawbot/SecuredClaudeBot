/**
 * Doctor / Diagnostics — health checks for all subsystems.
 * Can run as CLI: `pnpm --filter @fastbot/gateway run doctor`
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  results.push({
    name: "Node.js version",
    status: major >= 22 ? "ok" : major >= 20 ? "warn" : "fail",
    detail: `${nodeVersion} (recommended: >= 22)`,
  });

  // 2. Config file
  const configPath = resolve(process.cwd(), "config.json");
  results.push({
    name: "Config file",
    status: existsSync(configPath) ? "ok" : "fail",
    detail: existsSync(configPath) ? configPath : "Not found — run onboarding wizard",
  });

  // 3. Data directory
  const dataDir = resolve(process.cwd(), "data");
  results.push({
    name: "Data directory",
    status: existsSync(dataDir) ? "ok" : "warn",
    detail: existsSync(dataDir) ? dataDir : "Will be created on first run",
  });

  // 4. Required packages
  const requiredPkgs = ["grammy", "socket.io", "ai", "sql.js", "pino", "zod"];
  for (const pkg of requiredPkgs) {
    try {
      await import(pkg);
      results.push({
        name: `Package: ${pkg}`,
        status: "ok",
        detail: "Available",
      });
    } catch {
      results.push({
        name: `Package: ${pkg}`,
        status: "fail",
        detail: "Not installed — run pnpm install",
      });
    }
  }

  // 5. Environment variables (optional overrides)
  const envVars = ["SCB_PIN", "SCB_TELEGRAM_TOKEN", "SCB_LLM_API_KEY"];
  for (const envVar of envVars) {
    const set = !!process.env[envVar];
    results.push({
      name: `Env: ${envVar}`,
      status: set ? "ok" : "warn",
      detail: set ? "Set" : "Not set (using config.json value)",
    });
  }

  // 6. Port availability
  for (const port of [18789, 3100]) {
    const available = await checkPort(port);
    results.push({
      name: `Port ${port}`,
      status: available ? "ok" : "warn",
      detail: available
        ? "Available"
        : "In use — another instance may be running",
    });
  }

  return results;
}

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const { createServer } = require("node:net");
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

// CLI runner
async function main() {
  console.log("\n🔍 FastBot Doctor\n");
  console.log("Running diagnostics...\n");

  const results = await runChecks();
  let hasFailures = false;

  for (const r of results) {
    const icon =
      r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️ " : "❌";
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
    if (r.status === "fail") hasFailures = true;
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const failCount = results.filter((r) => r.status === "fail").length;

  console.log(
    `\n  Summary: ${okCount} passed, ${warnCount} warnings, ${failCount} failures\n`
  );

  if (hasFailures) {
    console.log("  ⚠️  Fix failures before starting the gateway.\n");
    process.exit(1);
  } else {
    console.log("  ✨ All checks passed. Ready to launch!\n");
  }
}

main().catch(console.error);

export { runChecks, type CheckResult };
