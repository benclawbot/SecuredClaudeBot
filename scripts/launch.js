#!/usr/bin/env node

import { spawn, execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const DASHBOARD_URL = "http://localhost:3100";

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

function openBrowser(url) {
  const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(start, [url], { detached: true, stdio: "ignore" }).unref();
    console.log(`\nOpened browser: ${url}`);
  } catch (err) {
    console.log(`\nPlease open in your browser: ${url}`);
  }
}

/**
 * Check if Claude Code CLI is installed, if not install it
 */
function ensureClaudeCodeInstalled() {
  console.log("\nChecking Claude Code CLI installation...");

  const claudePath = join(homedir(), ".claude", "bin", "claude");

  if (existsSync(claudePath)) {
    console.log("Claude Code CLI is already installed.");
    return true;
  }

  console.log("Claude Code CLI not found. Installing...");

  try {
    // Try to install Claude Code via npm
    execSync("npm install -g @anthropic-ai/claude-code", { stdio: "inherit" });
    console.log("Claude Code CLI installed successfully!");
    return true;
  } catch (err) {
    console.log("Failed to install via npm. Trying curl installation...");

    try {
      // Try curl installation for macOS/Linux
      const isWindows = process.platform === "win32";
      if (isWindows) {
        console.log("Windows: Please install Claude Code manually from https://claude.com/claude-code");
        return false;
      }

      // Linux/macOS
      execSync("curl -s https://claude.com/install.sh | sh", { stdio: "inherit" });
      console.log("Claude Code CLI installed successfully!");
      return true;
    } catch (installErr) {
      console.log("Could not automatically install Claude Code.");
      console.log("Please install manually: https://claude.com/claude-code");
      return false;
    }
  }
}

/**
 * Configure Claude Code settings if not already configured
 */
function configureClaudeCodeSettings() {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsDir = join(homedir(), ".claude");

  // Create .claude directory if it doesn't exist
  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }

  // Check if settings.json exists
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  // Update settings with recommended values
  const recommendedSettings = {
    dangerouslySkipPermissions: true,
    maxTokens: 8192,
    thinking: {
      enabled: true,
      budget: 10000
    }
  };

  // Merge settings
  const updatedSettings = { ...settings, ...recommendedSettings };

  // Write settings
  writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
  console.log("Claude Code settings configured at:", settingsPath);
}

/**
 * Ensure pnpm is configured to auto-build native dependencies
 */
function configurePnpm() {
  console.log("\nConfiguring pnpm to auto-build native dependencies...");

  try {
    // Configure pnpm to auto-install and build native dependencies
    execSync("pnpm config set ignore-scripts false", { stdio: "inherit" });
    execSync("pnpm config set auto-install-peers true", { stdio: "inherit" });

    // Also set in project .npmrc
    const npmrcPath = join(process.cwd(), ".npmrc");
    let npmrcContent = "";
    if (existsSync(npmrcPath)) {
      npmrcContent = readFileSync(npmrcPath, "utf-8");
    }

    // Add auto-build settings if not present
    if (!npmrcContent.includes("ignore-scripts=false")) {
      const newContent = npmrcContent + "\nignore-scripts=false\nauto-install-peers=true\n";
      writeFileSync(npmrcPath, newContent);
    }

    console.log("pnpm configured successfully.");
  } catch (err) {
    console.log("Warning: Could not configure pnpm automatically.");
  }
}

/**
 * Run pnpm install with auto-approval
 */
function runPnpmInstall() {
  console.log("\nRunning pnpm install (auto-building native dependencies)...");

  try {
    // First do install with all scripts allowed
    execSync("pnpm install --ignore-scripts=false", { stdio: "inherit" });
    console.log("pnpm install completed.");
    return true;
  } catch (err) {
    console.log("pnpm install failed, trying regular install...");
    try {
      execSync("pnpm install", { stdio: "inherit" });
      return true;
    } catch {
      return false;
    }
  }
}

async function main() {
  console.log("\n=== FastBot Launch ===\n");

  // Ensure Claude Code is installed and configured
  ensureClaudeCodeInstalled();
  configureClaudeCodeSettings();

  // Configure pnpm to auto-build native deps
  configurePnpm();

  // Default to production mode
  const choice = "2";

  if (choice === "1") {
    console.log("\nStarting in Development mode...\n");
    console.log("Tip: Access the dashboard at", DASHBOARD_URL);

    // Open browser automatically
    openBrowser(DASHBOARD_URL);

    // Start dev mode
    const dev = spawn("pnpm", ["dev"], { stdio: "inherit", shell: true });
    dev.on("close", (code) => {
      rl.close();
      process.exit(code);
    });
  } else if (choice === "2") {
    console.log("\nStarting in Production mode...\n");

    // Start PM2
    try {
      execSync("npx pm2 start ecosystem.config.cjs", { stdio: "inherit", shell: true });
      console.log("\nPM2 services started.");
      console.log("Tip: Access the dashboard at", DASHBOARD_URL);

      // Open browser automatically
      openBrowser(DASHBOARD_URL);

      console.log("\nView logs: npx pm2 logs");
    } catch (err) {
      console.error("Failed to start PM2:", err.message);
    }
    rl.close();
  } else {
    console.log("\nInvalid choice. Please run 'pnpm launch' and choose 1 or 2.");
    rl.close();
  }
}

main();
