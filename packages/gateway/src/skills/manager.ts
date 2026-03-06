/**
 * Skills Manager - Handles installation and management of Claude Code compatible skills
 */
import { createChildLogger } from "../logger/index.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const log = createChildLogger("skills");

const SKILLS_DIR = join(process.cwd(), "data", "skills");

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  installedAt: number;
  enabled: boolean;
  tools: string[];
}

/**
 * Ensure skills directory exists
 */
function ensureSkillsDir(): void {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/**
 * Load all installed skills
 */
export function listSkills(): InstalledSkill[] {
  ensureSkillsDir();

  try {
    const entries = readdirSync(SKILLS_DIR);
    const skills: InstalledSkill[] = [];

    for (const entry of entries) {
      const skillPath = resolve(SKILLS_DIR, entry);
      const stat = statSync(skillPath);

      if (!stat.isDirectory()) continue;

      // Try to load skill metadata
      const metaPath = join(skillPath, ".skill-meta.json");
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          skills.push(meta);
        } catch {
          // Invalid metadata, skip
        }
      } else {
        // Try to infer from SKILL.md or CLAUDE.md
        const skillMdPath = join(skillPath, "SKILL.md");
        const claudeMdPath = join(skillPath, "CLAUDE.md");
        const skillFile = existsSync(skillMdPath) ? skillMdPath : existsSync(claudeMdPath) ? claudeMdPath : null;

        if (skillFile) {
          const content = readFileSync(skillFile, "utf-8");
          const name = extractSkillName(entry, content);
          const description = extractSkillDescription(content);
          const tools = extractTools(content);

          skills.push({
            id: entry,
            name,
            description,
            source: "local",
            installedAt: stat.mtimeMs,
            enabled: true,
            tools,
          });
        }
      }
    }

    return skills;
  } catch (err) {
    log.error({ err }, "Failed to list skills");
    return [];
  }
}

/**
 * Extract skill name from SKILL.md content
 * Prefers repository name, falls back to content title
 */
function extractSkillName(id: string, content: string): string {
  // First try to extract proper title from content
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    const title = match[1].trim();
    // If the title is just "CLAUDE.md" or "SKILL.md", use the repo name instead
    if (title.toLowerCase() === "claude.md" || title.toLowerCase() === "skill.md") {
      return id;
    }
    return title;
  }
  // Fall back to repo/folder name
  return id;
}

/**
 * Extract skill description from SKILL.md content
 */
function extractSkillDescription(content: string): string {
  const match = content.match(/^[^#][\s\S]*?\n\n/m);
  return match ? match[0].trim().slice(0, 200) : "";
}

/**
 * Extract available tools/commands from SKILL.md
 */
function extractTools(content: string): string[] {
  const tools: string[] = [];

  // Look for skill invocations
  const invokeMatches = content.matchAll(/(?:^|\n)\/\/?\s*(\w+(?:\s+\w+)?)\s*\(skill\)/gim);
  for (const match of invokeMatches) {
    const tool = match[1].toLowerCase().replace(/\s+/g, "-");
    if (!tools.includes(tool)) tools.push(tool);
  }

  // If no explicit tools found, look for common patterns
  if (tools.length === 0) {
    const lines = content.split("\n");
    for (const line of lines) {
      const cmdMatch = line.match(/^\/\/?\s*(\w+)\s+skill/i);
      if (cmdMatch) {
        tools.push(cmdMatch[1].toLowerCase());
      }
    }
  }

  return tools;
}

/**
 * Install a skill from a git repository
 */
export async function installSkill(source: string): Promise<{ success: boolean; skill?: InstalledSkill; error?: string }> {
  ensureSkillsDir();

  try {
    // Parse source - could be:
    // - git@github.com:user/repo.git
    // - https://github.com/user/repo
    // - npm package name
    let repoUrl = source;
    let skillName = "";

    if (source.includes("github.com") || source.endsWith(".git")) {
      // It's a git repository
      if (source.startsWith("git@")) {
        // Convert SSH to HTTPS
        repoUrl = source.replace("git@github.com:", "https://github.com/");
      } else if (!source.startsWith("https://")) {
        repoUrl = `https://github.com/${source}`;
      }
      // Extract repo name
      const match = repoUrl.match(/github\.com\/[^\/]+\/([^.]+)/);
      skillName = match ? match[1] : randomBytes(4).toString("hex");
    } else {
      // Assume npm package
      skillName = source;
    }

    const skillPath = resolve(SKILLS_DIR, skillName);

    if (existsSync(skillPath)) {
      return { success: false, error: `Skill "${skillName}" is already installed` };
    }

    // Clone or download the skill
    if (repoUrl.includes("github.com")) {
      log.info({ source: repoUrl, skillName }, "Cloning skill repository");

      // Use git clone
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("git", ["clone", "--depth", "1", repoUrl, skillPath], {
          stdio: "pipe",
        });

        let stderr = "";
        proc.stderr?.on("data", (d) => { stderr += d.toString(); });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Git clone failed: ${stderr}`));
          }
        });

        proc.on("error", reject);
      });
    } else {
      return { success: false, error: "Unsupported source. Use GitHub repository URL." };
    }

    // Verify skill file exists (SKILL.md or CLAUDE.md)
    const skillMdPath = join(skillPath, "SKILL.md");
    const claudeMdPath = join(skillPath, "CLAUDE.md");
    const skillFile = existsSync(skillMdPath) ? skillMdPath : existsSync(claudeMdPath) ? claudeMdPath : null;

    if (!skillFile) {
      // Clean up
      rmSync(skillPath, { recursive: true, force: true });
      return { success: false, error: "Invalid skill: SKILL.md or CLAUDE.md not found" };
    }

    // Read and parse skill
    const content = readFileSync(skillFile, "utf-8");
    const stat = statSync(skillPath);

    const skill: InstalledSkill = {
      id: skillName,
      name: extractSkillName(skillName, content),
      description: extractSkillDescription(content),
      source: repoUrl,
      installedAt: Date.now(),
      enabled: true,
      tools: extractTools(content),
    };

    // Save metadata
    const metaPath = join(skillPath, ".skill-meta.json");
    writeFileSync(metaPath, JSON.stringify(skill, null, 2));

    log.info({ skillName, tools: skill.tools }, "Skill installed successfully");

    return { success: true, skill };
  } catch (err) {
    log.error({ source, err }, "Failed to install skill");
    return { success: false, error: String(err) };
  }
}

/**
 * Uninstall a skill
 */
export function uninstallSkill(skillId: string): { success: boolean; error?: string } {
  try {
    const skillPath = resolve(SKILLS_DIR, skillId);

    if (!existsSync(skillPath)) {
      return { success: false, error: "Skill not found" };
    }

    rmSync(skillPath, { recursive: true, force: true });
    log.info({ skillId }, "Skill uninstalled");

    return { success: true };
  } catch (err) {
    log.error({ skillId, err }, "Failed to uninstall skill");
    return { success: false, error: String(err) };
  }
}

/**
 * Toggle skill enabled state
 */
export function toggleSkill(skillId: string, enabled: boolean): { success: boolean; error?: string } {
  try {
    const skillPath = resolve(SKILLS_DIR, skillId);
    const metaPath = join(skillPath, ".skill-meta.json");

    if (!existsSync(metaPath)) {
      return { success: false, error: "Skill metadata not found" };
    }

    const skill: InstalledSkill = JSON.parse(readFileSync(metaPath, "utf-8"));
    skill.enabled = enabled;
    writeFileSync(metaPath, JSON.stringify(skill, null, 2));

    log.info({ skillId, enabled }, "Skill toggled");

    return { success: true };
  } catch (err) {
    log.error({ skillId, err }, "Failed to toggle skill");
    return { success: false, error: String(err) };
  }
}

/**
 * Get all enabled skills for the system prompt
 */
export function getSkillsForSystemPrompt(): string {
  const skills = listSkills().filter(s => s.enabled);

  if (skills.length === 0) {
    return "";
  }

  const skillList = skills.map(s =>
    `- **${s.name}**: ${s.description} (tools: ${s.tools.join(", ") || "none"})`
  ).join("\n");

  return `
## Available Skills

The following skills are installed and available as tools:

${skillList}

You can invoke these skills when users ask for tasks that match their capabilities. Use the skill name as a tool.`;
}
