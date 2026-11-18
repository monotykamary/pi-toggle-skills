/**
 * Skill discovery and frontmatter manipulation for pi-toggle-skills.
 *
 * Scans the standard pi skill directories to find SKILL.md files,
 * parses their YAML frontmatter, and provides safe round-trip editing
 * without reformatting Markdown or unrelated YAML.
 */

import {
  type ToggleSkill,
  DISABLE_MODEL_INVOCATION_KEY,
  isDisabled,
  deduplicateSkills,
} from "./index.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import matter from "gray-matter";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isDeepStrictEqual } from "node:util";
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

type FileSnapshot = ReturnType<typeof getSkillSnapshot>;

function getSkillSnapshot(path: string) {
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile()) throw new Error("Not a regular skill file");
  return info;
}

function unchanged(before: FileSnapshot, after: FileSnapshot): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

/** Edit only the flag's line, preserving body, comments, newline style and other YAML. */
function editInvocationFlag(raw: string, disabled: boolean, expectedDisabled?: boolean): string | undefined {
  const open = /^\uFEFF?---[ \t]*(\r?\n)/.exec(raw);
  if (!open) return;
  const yamlAndBody = raw.slice(open[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(yamlAndBody);
  if (!close) return;
  const { data, content } = parseFrontmatter(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  if (expectedDisabled !== undefined && expectedDisabled !== isDisabled(data)) return;

  const key = DISABLE_MODEL_INVOCATION_KEY;
  const yaml = yamlAndBody.slice(0, close.index);
  const eol = open[1];
  let nextYaml: string;
  if (Object.hasOwn(data, key)) {
    // Refuse force-reformatting an unusual representation (flow mappings,
    // aliases, multiline values, etc.). The semantic check below also rejects
    // matches outside the actual top-level mapping.
    const field = new RegExp(`^((?:${key}|'${key}'|"${key}")[ \\t]*:[ \\t]*)(?:true|false|null|~)?([ \\t]*)(#[^\\r\\n]*)?(\\r?\\n)`, "m").exec(yaml);
    if (!field) return;
    const replacement = disabled
      ? `${field[1]}true${field[2] || (field[3] ? " " : "")}${field[3] ?? ""}${field[4]}`
      : field[3] ? `${field[3]}${field[4]}` : "";
    nextYaml = yaml.slice(0, field.index) + replacement + yaml.slice(field.index + field[0].length);
  } else {
    if (!disabled) return;
    nextYaml = `${yaml}${key}: true${eol}`;
  }

  const output = open[0] + nextYaml + yamlAndBody.slice(close.index);
  const wanted = { ...data };
  if (disabled) wanted[key] = true;
  else delete wanted[key];
  const checked = parseFrontmatter(output);
  if (checked.content !== content || !isDeepStrictEqual(checked.data, wanted) || raw === output) return;
  return output;
}

/** Toggle a skill's latest file, or refuse if the visibility state is stale or the file is busy. */
export function toggleSkillInvocation(filePath: string, disabled: boolean, expectedDisabled?: boolean): boolean {
  try {
    const target = realpathSync(filePath);
    if (basename(target).toLowerCase() === "settings.json") return false;
    const lock = `${target}.lock`;
    // Refuse a competing writer immediately. Never steal on age; after a
    // crash a leftover lock requires manual removal.
    mkdirSync(lock, { mode: 0o700 });
    try {
      const before = getSkillSnapshot(target);
      const bytes = readFileSync(target);
      const raw = bytes.toString("utf8");
      if (!Buffer.from(raw).equals(bytes)) return false;
      const output = editInvocationFlag(raw, disabled, expectedDisabled);
      if (output === undefined) return false;
      const temporary = join(dirname(target), `.toggle-skills-${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      let published = false;
      try {
        try {
          writeFileSync(fd, output, "utf8");
          fchmodSync(fd, Number(before.mode & 0o7777n));
        } finally {
          closeSync(fd);
        }
        // Editors need not honor the lock. Compare the bytes too: a same-size
        // edit can occur within one filesystem timestamp tick.
        if (realpathSync(filePath) !== target || !unchanged(before, getSkillSnapshot(target)) ||
          !readFileSync(target).equals(bytes) || !unchanged(before, getSkillSnapshot(target))) return false;
        renameSync(temporary, target);
        published = true;
        return true;
      } finally {
        if (!published) {
          try { unlinkSync(temporary); } catch { /* best-effort cleanup */ }
        }
      }
    } finally {
      rmdirSync(lock);
    }
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
      if (toggleSkillInvocation(change.filePath, change.newDisabled, skill.disabled)) {
        written.push(change.filePath);
      }
    }
  }

  return written;
}
