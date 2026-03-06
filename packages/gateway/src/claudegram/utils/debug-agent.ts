#!/usr/bin/env npx tsx
/**
 * Debug utility for testing long-running agent queries with watchdog.
 *
 * Usage:
 *   # Basic test with default project
 *   CLAUDE_SDK_LOG_LEVEL=basic npx tsx src/utils/debug-agent.ts
 *
 *   # Test with specific project directory
 *   CLAUDE_SDK_LOG_LEVEL=basic npx tsx src/utils/debug-agent.ts /path/to/project
 *
 *   # Test with shorter warning threshold
 *   AGENT_WATCHDOG_WARN_SECONDS=10 CLAUDE_SDK_LOG_LEVEL=basic npx tsx src/utils/debug-agent.ts
 *
 *   # Test with hard timeout
 *   AGENT_QUERY_TIMEOUT_MS=60000 CLAUDE_SDK_LOG_LEVEL=basic npx tsx src/utils/debug-agent.ts
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { AgentWatchdog } from '../claude/agent-watchdog.js';
import {
  createAgentTimer,
  recordMessage,
  formatDuration,
  getElapsedMs,
  getTimingReport,
} from './agent-timer.js';

const TEST_PROMPTS = {
  quick: 'What is 2 + 2?',
  medium: 'List the files in the current directory and describe what this project does.',
  long: 'Explore this codebase thoroughly. Find all TypeScript files, identify the main entry points, and explain the architecture. Use the Task tool with subagents if needed to parallelize your exploration.',
  subagent: 'Use the Task tool to spawn an explore agent that finds all configuration files in this project.',
};

async function main() {
  const projectDir = process.argv[2] || process.cwd();
  const promptKey = (process.argv[3] as keyof typeof TEST_PROMPTS) || 'medium';
  const prompt = TEST_PROMPTS[promptKey] || TEST_PROMPTS.medium;

  console.log('=== Debug Agent Test ===');
  console.log(`Project: ${projectDir}`);
  console.log(`Prompt: ${promptKey} — "${prompt.substring(0, 80)}..."`);
  console.log(`Watchdog enabled: ${config.AGENT_WATCHDOG_ENABLED}`);
  console.log(`Watchdog warn after: ${config.AGENT_WATCHDOG_WARN_SECONDS}s`);
  console.log(`Watchdog log interval: ${config.AGENT_WATCHDOG_LOG_SECONDS}s`);
  console.log(`Query timeout: ${config.AGENT_QUERY_TIMEOUT_MS}ms (0 = disabled)`);
  console.log('========================\n');

  const timer = createAgentTimer();
  const controller = new AbortController();

  // Initialize watchdog
  const watchdog = config.AGENT_WATCHDOG_ENABLED
    ? new AgentWatchdog({
        chatId: '0', // Debug session
        warnAfterSeconds: config.AGENT_WATCHDOG_WARN_SECONDS,
        logIntervalSeconds: config.AGENT_WATCHDOG_LOG_SECONDS,
        timeoutMs: config.AGENT_QUERY_TIMEOUT_MS > 0 ? config.AGENT_QUERY_TIMEOUT_MS : undefined,
        onWarning: (sinceMsg, total) => {
          console.log(`[DEBUG] WATCHDOG WARNING: No messages for ${formatDuration(sinceMsg)} (total: ${formatDuration(total)})`);
        },
        onTimeout: () => {
          console.log('[DEBUG] WATCHDOG TIMEOUT: Aborting query');
          controller.abort();
        },
      })
    : null;

  watchdog?.start();

  try {
    const response = query({
      prompt,
      options: {
        cwd: projectDir,
        tools: ['Bash', 'Read', 'Glob', 'Grep', 'Task'],
        allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Task'],
        permissionMode: 'acceptEdits',
        abortController: controller,
        model: 'opus',
      },
    });

    let messageCount = 0;
    for await (const message of response) {
      recordMessage(timer);
      watchdog?.recordActivity(message.type);
      messageCount++;

      const elapsed = formatDuration(getElapsedMs(timer));

      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            console.log(`[${elapsed}] TEXT: ${block.text.substring(0, 200)}...`);
          } else if (block.type === 'tool_use') {
            const toolInput = 'input' in block ? block.input as Record<string, unknown> : {};
            console.log(`[${elapsed}] TOOL: ${block.name}`);
            if (block.name === 'Task') {
              console.log(`  └─ SUBAGENT: ${toolInput.subagent_type || 'unknown'} — ${String(toolInput.description || toolInput.prompt || '').substring(0, 80)}`);
            }
          }
        }
      } else if (message.type === 'result') {
        console.log(`\n[${elapsed}] RESULT: ${message.subtype}`);
        if (message.subtype === 'success') {
          console.log(`  └─ ${message.result?.substring(0, 200)}...`);
        }
      } else if (message.type === 'tool_use_summary') {
        console.log(`[${elapsed}] TOOL_SUMMARY`);
      } else if (message.type === 'system') {
        console.log(`[${elapsed}] SYSTEM: ${message.subtype}`);
      }
    }

    console.log(`\n=== Query Complete ===`);
    console.log(`${getTimingReport(timer)}`);
    console.log(`Raw messages: ${messageCount}`);
  } catch (error) {
    console.error('\n=== Query Error ===');
    console.error(error instanceof Error ? error.message : error);
  } finally {
    watchdog?.stop();
  }
}

main().catch(console.error);
