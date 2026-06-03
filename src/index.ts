/**
 * Shared constants, types, and utilities for pi-toggle-skills.
 */

/** Description shown in the / commands list. */
export const TOGGLE_COMMAND_DESCRIPTION = "Toggle which skills are visible to the model (disable-model-invocation)";

/** Frontmatter key that controls skill visibility. */
export const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";

/** A discovered skill with its toggle state. */
export interface ToggleSkill {
  /** Skill name from frontmatter (or parent directory as fallback). */
  name: string;
  /** Description from frontmatter. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Directory containing the SKILL.md. */
  baseDir: string;
  /** Whether disable-model-invocation is currently true. */
  disabled: boolean;
}

/** Snapshot of a skill's original state before any in-memory toggles. */
export interface SkillToggleChange {
  filePath: string;
  originalDisabled: boolean;
  newDisabled: boolean;
}

/**
 * Check whether a frontmatter object has disable-model-invocation set to true.
 */
export function isDisabled(frontmatter: Record<string, unknown>): boolean {
  return frontmatter[DISABLE_MODEL_INVOCATION_KEY] === true;
}

/**
 * Format a skill's status for display.
 */
export function formatSkillStatus(skill: ToggleSkill): string {
  return skill.disabled ? "✗ hidden" : "✓ visible";
}

/**
 * Format a skill for one-line display (e.g. in status list).
 */
export function formatSkillLine(skill: ToggleSkill): string {
  const status = skill.disabled ? "hidden" : "visible";
  return `${skill.name} [${status}] — ${skill.description.slice(0, 80)}`;
}

/**
 * Deduplicate skills by filePath — keep the first occurrence.
 */
export function deduplicateSkills(skills: ReadonlyArray<ToggleSkill>): ToggleSkill[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (seen.has(skill.filePath)) return false;
    seen.add(skill.filePath);
    return true;
  });
}

/**
 * Compute the set of changes between original skills and current (toggled) state.
 */
export function computeChanges(
  originals: ReadonlyArray<ToggleSkill>,
  current: ReadonlyArray<ToggleSkill>,
): SkillToggleChange[] {
  const currentByPath = new Map<string, ToggleSkill>();
  for (const skill of current) {
    currentByPath.set(skill.filePath, skill);
  }

  const changes: SkillToggleChange[] = [];
  for (const original of originals) {
    const currentSkill = currentByPath.get(original.filePath);
    if (currentSkill && currentSkill.disabled !== original.disabled) {
      changes.push({
        filePath: original.filePath,
        originalDisabled: original.disabled,
        newDisabled: currentSkill.disabled,
      });
    }
  }

  return changes;
}

/**
 * Validate a skill name per the Agent Skills spec.
 * Returns array of error messages (empty if valid).
 */
export function validateSkillName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > 64) {
    errors.push(`name exceeds 64 characters (${name.length})`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("name must not start or end with a hyphen");
  }
  if (name.includes("--")) {
    errors.push("name must not contain consecutive hyphens");
  }
  return errors;
}
