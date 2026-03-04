#!/usr/bin/env node

import { spawn } from "child_process";
import { execSync } from "child_process";
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

async function main() {
  console.log("\n=== FastBot Launch ===\n");
  console.log("1. Development mode (hot reload, verbose logging)");
  console.log("2. Production mode (optimized, runs as service with PM2)\n");

  const choice = await askQuestion("Choose launch mode (1/2): ");

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
      execSync("npx pm2 start ecosystem.config.js", { stdio: "inherit", shell: true });
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
