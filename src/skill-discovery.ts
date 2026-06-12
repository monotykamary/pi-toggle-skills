/**
 * Skill discovery and frontmatter manipulation for pi-toggle-skills.
 *
 * Scans the standard pi skill directories to find SKILL.md files,
 * parses their YAML frontmatter, and provides safe round-trip editing
 * via gray-matter.
 */

import {
  type ToggleSkill,
  DISABLE_MODEL_INVOCATION_KEY,
  isDisabled,
  deduplicateSkills,
} from "./index.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import matter from "gray-matter";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

// Skill directories to scan (in priority order, matching pi's discovery)

function getGlobalPiSkillDirs(): string[] {
  return [join(getAgentDir(), "skills")];
}

function getGlobalAgentsSkillDirs(): string[] {
  return [join(homedir(), ".agents", "skills")];
}

function getProjectSkillDirs(cwd: string): string[] {
  return [join(cwd, ".pi", "skills"), join(cwd, ".agents", "skills")];
}

/** Skill source identifier for diagnostics. */
type SkillSource = "global-pi" | "global-agents" | "project-pi" | "project-agents";

export interface SkillDir {
  path: string;
  source: SkillSource;
}

function getAllSkillDirs(cwd: string): SkillDir[] {
  const dirs: SkillDir[] = [];

  for (const path of getGlobalPiSkillDirs()) {
    dirs.push({ path, source: "global-pi" });
  }
  for (const path of getGlobalAgentsSkillDirs()) {
    dirs.push({ path, source: "global-agents" });
  }
  for (const path of getProjectSkillDirs(cwd)) {
    dirs.push({ path, source: "project-pi" });
  }
  // Deduplicate by resolved (real) path so that symlinked directories
  // (e.g. ~/.agents/skills → ~/.pi/agent/skills) are not scanned twice.
  const seen = new Set<string>();
  return dirs.filter((d) => {
    let resolved = d.path;
    try { resolved = realpathSync(d.path); } catch { /* path doesn't exist yet */ }
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

/** Options for discoverSkills. */
export interface DiscoverSkillsOptions {
  /** If provided, override the skill directories to scan (for testing). */
  skillDirs?: SkillDir[];
}

/**
 * Discover all skills across standard locations.
 * Returns deduplicated skills (first found wins, matching pi's behavior).
 */
export function discoverSkills(cwd: string, options?: DiscoverSkillsOptions): ToggleSkill[] {
  const allSkills: ToggleSkill[] = [];
  const dirs = options?.skillDirs ?? getAllSkillDirs(cwd);

  for (const dir of dirs) {
    if (!existsSync(dir.path)) continue;
    const skills = loadSkillsFromDir(dir.path, dir.source);
    allSkills.push(...skills);
  }

  return deduplicateSkills(allSkills);
}

/**
 * Load skills from a directory tree.
 *
 * Mirrors pi's discovery rules:
 * - If a directory contains SKILL.md, treat it as a skill (don't recurse further)
 * - Otherwise, load direct .md children in the root
 * - Recurse into subdirectories to find SKILL.md
 */
function loadSkillsFromDir(dir: string, source: SkillSource): ToggleSkill[] {
  const skills: ToggleSkill[] = [];

  if (!existsSync(dir)) return skills;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    // Check for SKILL.md in this directory
    for (const entry of entries) {
      if (entry.name !== "SKILL.md") continue;

      const fullPath = join(dir, entry.name);
      const skill = loadSkillFromFile(fullPath);
      if (skill) skills.push(skill);

      // SKILL.md found — don't look for other .md files or recurse
      return skills;
    }

    // No SKILL.md — check root .md files (only in .pi/skills/ and ~/.pi/agent/skills/)
    const isDiscoverableRoot = source === "global-pi" || source === "project-pi";
    if (isDiscoverableRoot) {
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        if (!entry.name.endsWith(".md")) continue;

        const fullPath = join(dir, entry.name);
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try { isFile = statSync(fullPath).isFile(); } catch { continue; }
        }
        if (!isFile) continue;

        const skill = loadSkillFromFile(fullPath);
        if (skill) skills.push(skill);
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isDirectory = entry.isDirectory();

      if (entry.isSymbolicLink()) {
        try { isDirectory = statSync(fullPath).isDirectory(); } catch { continue; }
      }
      if (!isDirectory) continue;

      const subSkills = loadSkillsFromDir(fullPath, source);
      skills.push(...subSkills);
    }
  } catch {
    // Permission errors, etc. — skip silently.
  }

  return skills;
}

/**
 * Load a single skill from a SKILL.md (or root .md) file.
 * Returns null if the file can't be parsed or is missing a description.
 */
function loadSkillFromFile(filePath: string): ToggleSkill | null {
  try {
    const rawContent = readFileSync(filePath, "utf8");
    const { data: frontmatter } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    const name = (frontmatter.name as string) || parentDirName;
    const description = frontmatter.description as string;

    // Skills without description are not loaded by pi — skip them
    if (!description || description.trim() === "") return null;

    // Resolve symlinks so that the same physical SKILL.md reached via
    // different alias paths (e.g. ~/.agents/skills/x vs ~/.pi/agent/skills/x)
    // gets the same filePath and is correctly deduplicated.
    let realFilePath = filePath;
    try { realFilePath = realpathSync(filePath); } catch { /* keep as-is */ }
    const realBaseDir = dirname(realFilePath);

    return {
      name,
      description,
      filePath: realFilePath,
      baseDir: realBaseDir,
      disabled: isDisabled(frontmatter),
    };
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from a string using gray-matter.
 */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const parsed = matter(content);
  return { data: parsed.data as Record<string, unknown>, content: parsed.content };
}

/**
 * Toggle disable-model-invocation in a SKILL.md file.
 *
 * When disabling: sets `disable-model-invocation: true`
 * When enabling: removes the key entirely (false is the default)
 *
 * Returns true if the file was written, false on error.
 */
export function toggleSkillInvocation(filePath: string, disabled: boolean): boolean {
  try {
    const rawContent = readFileSync(filePath, "utf8");
    const parsed = matter(rawContent);

    if (disabled) {
      parsed.data[DISABLE_MODEL_INVOCATION_KEY] = true;
    } else {
      // Remove the key when enabling (false is the default / absent state)
      delete parsed.data[DISABLE_MODEL_INVOCATION_KEY];
    }

    const output = matter.stringify(parsed.content, parsed.data);
    writeFileSync(filePath, output, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a batch of toggle changes to disk.
 * Returns the list of filePaths that were successfully written.
 */
export function applyChanges(
  skills: ReadonlyArray<ToggleSkill>,
  changes: ReadonlyArray<{ filePath: string; newDisabled: boolean }>,
): string[] {
  const written: string[] = [];
  const skillsByPath = new Map<string, ToggleSkill>();
  for (const skill of skills) {
    skillsByPath.set(skill.filePath, skill);
  }

  for (const change of changes) {
    const skill = skillsByPath.get(change.filePath);
    // Only write if the target state differs from what we last read
    if (skill && skill.disabled !== change.newDisabled) {
      if (toggleSkillInvocation(change.filePath, change.newDisabled)) {
        written.push(change.filePath);
      }
    }
  }

  return written;
}
