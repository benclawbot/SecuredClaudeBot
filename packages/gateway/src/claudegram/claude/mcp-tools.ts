/**
 * MCP Tools — Simplified MCP server factory for Claudegram.
 *
 * Provides basic project management tools. Media features (Reddit, Medium,
 * YouTube extraction) can be added later.
 */

import { z } from 'zod';
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, isPathWithinRoot } from '../utils/workspace-guard.js';

// ── Types ────────────────────────────────────────────────────────────

export interface McpToolsContext {
  sessionKey: string;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createClaudegramMcpServer(
  _toolsCtx: McpToolsContext
): McpSdkServerConfigWithInstance {
  const tools = buildToolList();

  return createSdkMcpServer({
    name: 'claudegram-tools',
    version: '1.0.0',
    tools,
  });
}

function buildToolList() {
  return [
    listProjectsTool(),
    switchProjectTool(),
  ];
}

// ── Tool Definitions ─────────────────────────────────────────────────

function listProjectsTool() {
  return tool(
    'claudegram_list_projects',
    'List all available projects in the workspace directory. Use this to see what projects the user can switch to.',
    {},
    async () => {
      try {
        const workspaceRoot = getWorkspaceRoot();
        const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
        const projects = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => e.name);

        return {
          content: [{
            type: 'text' as const,
            text: `Projects in ${workspaceRoot}:\n${projects.join('\n')}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}

function switchProjectTool() {
  return tool(
    'claudegram_switch_project',
    'Switch the working directory to a different project. The change takes effect on the next query. Use claudegram_list_projects first to see available projects.',
    { project_name: z.string().describe('Name of the project directory to switch to') },
    async ({ project_name }) => {
      try {
        const workspaceRoot = getWorkspaceRoot();
        const targetPath = path.resolve(workspaceRoot, project_name);

        if (!isPathWithinRoot(workspaceRoot, targetPath)) {
          return {
            content: [{ type: 'text' as const, text: `Error: Path must be within workspace root: ${workspaceRoot}` }],
            isError: true,
          };
        }

        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
          return {
            content: [{ type: 'text' as const, text: `Error: Project not found: ${project_name}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Switched to project: ${project_name} (${targetPath}). The new working directory will take effect on the next query.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error switching project: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
