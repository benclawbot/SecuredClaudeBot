/**
 * Agents Manager - handles agent storage, initialization, and file management
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createChildLogger } from "../logger/index.js";
import type { Agent, AgentsConfig } from "../config/schema.js";

const log = createChildLogger("agents");

export class AgentsManager {
  private agentsDir: string;
  private userInfoPath: string;
  private agents: Map<string, Agent> = new Map();

  constructor(config: AgentsConfig = {} as AgentsConfig) {
    this.agentsDir = resolve(process.cwd(), config?.directory || "data/agents");
    this.userInfoPath = join(this.agentsDir, config?.userInfoFile || "user_info.md");
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.agentsDir)) {
      mkdirSync(this.agentsDir, { recursive: true });
      log.info({ path: this.agentsDir }, "Created agents directory");
    }
  }

  /**
   * Load all agents from disk
   */
  loadAgents(): Agent[] {
    this.agents.clear();

    if (!existsSync(this.agentsDir)) {
      return [];
    }

    const entries = readdirSync(this.agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentPath = join(this.agentsDir, entry.name, "agent.json");
        if (existsSync(agentPath)) {
          try {
            const content = readFileSync(agentPath, "utf-8");
            const agent = JSON.parse(content) as Agent;
            this.agents.set(agent.id, agent);
          } catch (err) {
            log.error({ agentDir: entry.name, err }, "Failed to load agent");
          }
        }
      }
    }

    log.info({ count: this.agents.size }, "Loaded agents from disk");
    return Array.from(this.agents.values());
  }

  /**
   * Get all agents
   */
  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get a specific agent
   */
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Create a new agent
   */
  createAgent(name: string, role: string): Agent {
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const agent: Agent = {
      id,
      name,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    // Create agent directory
    const agentDir = join(this.agentsDir, id);
    mkdirSync(agentDir, { recursive: true });

    // Write agent metadata
    writeFileSync(join(agentDir, "agent.json"), JSON.stringify(agent, null, 2));

    // Create default MD files
    this.writeAgentFile(id, "identity.md", `# ${name}\n\nIdentity description for this agent.\n`);
    this.writeAgentFile(id, "role.md", `# Role: ${role}\n\n## Goals\n- Primary goal here\n\n## Tools\n- Available tools\n\n## Resources\n- Available resources\n\n## Partners\n- Partner agents or systems\n`);
    this.writeAgentFile(id, "memories.md", `# Memories\n\n## Notable Events\n- Created: ${new Date().toISOString()}\n\n## Accomplishments\n\n## User Preferences\n\n## Warnings\n`);
    this.writeAgentFile(id, "lessons_learned.md", `# Lessons Learned\n\n## Root Cause Analysis\n\n## Solutions Applied\n\n## Knowledge Gained\n`);

    this.agents.set(id, agent);
    log.info({ agentId: id, name }, "Created new agent");

    return agent;
  }

  /**
   * Update an agent
   */
  updateAgent(id: string, updates: Partial<Pick<Agent, "name" | "role" | "status">>): Agent | null {
    const agent = this.agents.get(id);
    if (!agent) {
      return null;
    }

    const updated: Agent = {
      ...agent,
      ...updates,
      updatedAt: Date.now(),
    };

    const agentDir = join(this.agentsDir, id);
    writeFileSync(join(agentDir, "agent.json"), JSON.stringify(updated, null, 2));
    this.agents.set(id, updated);

    // Rename directory if name changed
    if (updates.name && updates.name !== agent.name) {
      const newDir = join(this.agentsDir, id);
      // Just log the name change, directory stays same
      log.info({ agentId: id, oldName: agent.name, newName: updates.name }, "Agent renamed");
    }

    log.info({ agentId: id }, "Updated agent");
    return updated;
  }

  /**
   * Delete an agent
   */
  deleteAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) {
      return false;
    }

    const agentDir = join(this.agentsDir, id);
    if (existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
    }

    this.agents.delete(id);
    log.info({ agentId: id }, "Deleted agent");
    return true;
  }

  /**
   * Read an agent file
   */
  readAgentFile(agentId: string, filename: string): string | null {
    const filePath = join(this.agentsDir, agentId, filename);
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
    return null;
  }

  /**
   * Write an agent file
   */
  writeAgentFile(agentId: string, filename: string, content: string): void {
    const agentDir = join(this.agentsDir, agentId);
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }
    const filePath = join(agentDir, filename);
    writeFileSync(filePath, content, "utf-8");
    log.debug({ agentId, filename }, "Wrote agent file");
  }

  /**
   * Get user info
   */
  getUserInfo(): string {
    if (existsSync(this.userInfoPath)) {
      return readFileSync(this.userInfoPath, "utf-8");
    }
    // Default user info template
    const defaultContent = `# User Information

## Personal Details
- Name:
- Background:
- Profession:

## Preferences
- Communication style:
- Topics of interest:
- Things to avoid:

## Important Context
- Current projects:
- Goals:
- Constraints:

## Relationships
- Key contacts:
- Team structure:

## Updates
*Add new information here as the agent learns about you*
`;
    this.setUserInfo(defaultContent);
    return defaultContent;
  }

  /**
   * Set user info
   */
  setUserInfo(content: string): void {
    writeFileSync(this.userInfoPath, content, "utf-8");
    log.info("Updated user info");
  }

  /**
   * Get all files for an agent
   */
  getAgentFiles(agentId: string): { name: string; path: string }[] {
    const agentDir = join(this.agentsDir, agentId);
    if (!existsSync(agentDir)) {
      return [];
    }

    const files = ["agent.json", "identity.md", "role.md", "memories.md", "lessons_learned.md"];
    return files
      .filter((f) => existsSync(join(agentDir, f)))
      .map((f) => ({ name: f, path: join(agentDir, f) }));
  }

  /**
   * Initialize all agents (called on gateway startup)
   */
  async initializeAgents(): Promise<void> {
    const agents = this.loadAgents();
    for (const agent of agents) {
      // Load agent files into memory
      const identity = this.readAgentFile(agent.id, "identity.md");
      const role = this.readAgentFile(agent.id, "role.md");
      const memories = this.readAgentFile(agent.id, "memories.md");
      const lessons = this.readAgentFile(agent.id, "lessons_learned.md");

      log.info(
        { agentId: agent.id, name: agent.name, hasFiles: !!(identity && role && memories) },
        "Agent initialized from files"
      );
    }
    log.info({ count: agents.length }, "All agents initialized");
  }

  /**
   * Add lesson learned
   */
  addLessonLearned(agentId: string, category: "root_cause" | "solution" | "knowledge", content: string): void {
    const lessonsPath = join(this.agentsDir, agentId, "lessons_learned.md");
    if (!existsSync(lessonsPath)) {
      return;
    }

    const current = readFileSync(lessonsPath, "utf-8");
    const timestamp = new Date().toISOString();
    let newContent = current;

    if (category === "root_cause") {
      newContent += `\n## ${timestamp}\n**Root Cause:** ${content}\n`;
    } else if (category === "solution") {
      newContent += `\n**Solution:** ${content}\n`;
    } else {
      newContent += `\n## Knowledge - ${timestamp}\n${content}\n`;
    }

    writeFileSync(lessonsPath, newContent, "utf-8");
    log.info({ agentId, category }, "Added lesson learned");
  }
}
