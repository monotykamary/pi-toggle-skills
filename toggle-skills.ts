/**
 * pi-toggle-skills — toggle skill visibility in pi's system prompt.
 *
 * Toggles `disable-model-invocation` in SKILL.md frontmatter to control
 * whether a skill appears in the model's available skills list.
 *
 * When a skill has `disable-model-invocation: true`, pi excludes it from
 * the system prompt entirely. Users can still invoke it explicitly via
 * /skill:name commands.
 *
 * This extension modifies SKILL.md files on disk. Changes require a /reload
 * to take effect — the extension auto-reloads after saving changes.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  TOGGLE_COMMAND_DESCRIPTION,
  type ToggleSkill,
  computeChanges,
} from "./src/index.js";
import {
  discoverSkills,
  toggleSkillInvocation,
  applyChanges,
} from "./src/skill-discovery.js";
import { ToggleSkillSelectorComponent, type ToggleSkillSelectorResult } from "./src/skill-selector.js";

export default function (pi: ExtensionAPI) {
  let currentSkills: ToggleSkill[] = [];

  pi.on("session_start", async (_event, ctx) => {
    currentSkills = discoverSkills(ctx.cwd);

    if (currentSkills.length > 0) {
      const hidden = currentSkills.filter((s) => s.disabled).length;
      const visible = currentSkills.length - hidden;

      if (ctx.hasUI) {
        ctx.ui.notify(
          `pi-toggle-skills: ${visible} visible, ${hidden} hidden skill(s) — use /toggle-skills to manage`,
          "info",
        );
      }
    }
  });

  pi.registerCommand("toggle-skills", {
    description: TOGGLE_COMMAND_DESCRIPTION,
    getArgumentCompletions(prefix: string) {
      const subcommands = ["status", "enable", "disable", "list", "help"];
      const matches = subcommands.filter((s) => s.startsWith(prefix));
      return matches.length > 0 ? matches.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      await handleToggleCommand(ctx, args.trim(), currentSkills, (skills) => {
        currentSkills = skills;
      });
    },
  });
}

async function handleToggleCommand(
  ctx: ExtensionCommandContext,
  args: string,
  currentSkills: ToggleSkill[],
  setSkills: (skills: ToggleSkill[]) => void,
): Promise<void> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  const rest = parts.slice(1).join(" ");

  // /toggle-skills — open interactive TUI selector (default)
  if (!subcommand) {
    await showToggleSelector(ctx, currentSkills, setSkills);
    return;
  }

  // /toggle-skills list — show skills and their status
  if (subcommand === "list") {
    showStatus(ctx, currentSkills);
    return;
  }

  // /toggle-skills status — same as list
  if (subcommand === "status") {
    showStatus(ctx, currentSkills);
    return;
  }

  // /toggle-skills disable <name> — hide a skill from the system prompt
  if (subcommand === "disable") {
    if (!rest) {
      ctx.ui.notify(
        "Usage: /toggle-skills disable <skill-name>",
        "warning",
      );
      return;
    }

    const skill = findSkillByName(currentSkills, rest);
    if (!skill) {
      ctx.ui.notify(`Skill not found: "${rest}". Use /toggle-skills list to see available skills.`, "warning");
      return;
    }

    if (skill.disabled) {
      ctx.ui.notify(`Skill "${skill.name}" is already hidden.`, "info");
      return;
    }

    if (toggleSkillInvocation(skill.filePath, true)) {
      skill.disabled = true;
      ctx.ui.notify(
        `Disabled: "${skill.name}" — hidden from system prompt. Run /reload to apply.`,
        "info",
      );
    } else {
      ctx.ui.notify(`Failed to toggle skill "${skill.name}". Check file permissions.`, "error");
    }
    return;
  }

  // /toggle-skills enable <name> — show a skill in the system prompt
  if (subcommand === "enable") {
    if (!rest) {
      ctx.ui.notify(
        "Usage: /toggle-skills enable <skill-name>",
        "warning",
      );
      return;
    }

    const skill = findSkillByName(currentSkills, rest);
    if (!skill) {
      ctx.ui.notify(`Skill not found: "${rest}". Use /toggle-skills list to see available skills.`, "warning");
      return;
    }

    if (!skill.disabled) {
      ctx.ui.notify(`Skill "${skill.name}" is already visible.`, "info");
      return;
    }

    if (toggleSkillInvocation(skill.filePath, false)) {
      skill.disabled = false;
      ctx.ui.notify(
        `Enabled: "${skill.name}" — visible in system prompt. Run /reload to apply.`,
        "info",
      );
    } else {
      ctx.ui.notify(`Failed to toggle skill "${skill.name}". Check file permissions.`, "error");
    }
    return;
  }

  // /toggle-skills help
  if (subcommand === "help") {
    ctx.ui.notify(
      [
        "pi-toggle-skills commands:",
        "  /toggle-skills               Open interactive TUI to toggle skill visibility",
        "  /toggle-skills status        Show current skills and their visibility",
        "  /toggle-skills list          Same as /toggle-skills status",
        "  /toggle-skills disable <n>   Hide a skill from the system prompt",
        "  /toggle-skills enable <n>    Show a skill in the system prompt",
        "  /toggle-skills help          This message",
        "",
        "Mechanism: toggles disable-model-invocation in SKILL.md frontmatter.",
        "  When true, the skill is excluded from the system prompt.",
        "  Users can still invoke hidden skills via /skill:name commands.",
        "  Changes require /reload to take effect (auto-reloaded after TUI save).",
      ].join("\n"),
      "info",
    );
    return;
  }

  ctx.ui.notify(
    `Unknown subcommand: "${subcommand}". Use /toggle-skills help for usage.`,
    "warning",
  );
}

// Open the interactive TUI selector.
async function showToggleSelector(
  ctx: ExtensionCommandContext,
  currentSkills: ToggleSkill[],
  setSkills: (skills: ToggleSkill[]) => void,
): Promise<void> {
  if (currentSkills.length === 0) {
    ctx.ui.notify("No skills found. Add skills to ~/.pi/agent/skills/ or .pi/skills/ first.", "warning");
    return;
  }

  const result = await ctx.ui.custom<ToggleSkillSelectorResult>(
    (tui, theme, _kb, done) => {
      const selector = new ToggleSkillSelectorComponent(
        theme,
        currentSkills,
        (result) => done(result),
      );

      return {
        render(width: number) {
          return selector.render(width);
        },
        invalidate() {
          selector.invalidate();
        },
        handleInput(data: string) {
          selector.handleInput(data);
          tui.requestRender();
        },
      };
    },
  );

  if (!result || result.cancelled) {
    ctx.ui.notify("Toggle selector cancelled.", "info");
    return;
  }

  // Compute what changed
  const changes = computeChanges(currentSkills, result.skills);
  if (changes.length === 0) {
    ctx.ui.notify("No changes to apply.", "info");
    return;
  }

  // Write changes to disk
  const written = applyChanges(currentSkills, changes);
  if (written.length === 0) {
    ctx.ui.notify("No files were written. Check file permissions.", "warning");
    return;
  }

  setSkills(result.skills);

  // Summarize what changed
  const disabled = changes.filter((c) => c.newDisabled).length;
  const enabled = changes.length - disabled;
  const parts: string[] = [];
  if (enabled > 0) parts.push(`${enabled} enabled`);
  if (disabled > 0) parts.push(`${disabled} disabled`);
  const summary = parts.join(", ");

  // Auto-reload to apply changes
  ctx.ui.notify(
    `Skills updated: ${summary}. Reloading to apply...`,
    "info",
  );

  // Small delay so the user sees the notification before reload
  setTimeout(() => {
    ctx.reload();
  }, 500);
}

function findSkillByName(skills: ReadonlyArray<ToggleSkill>, name: string): ToggleSkill | undefined {
  // Exact match first
  const exact = skills.find((s) => s.name === name);
  if (exact) return exact;

  // Prefix match
  const prefix = skills.find((s) => s.name.startsWith(name));
  if (prefix) return prefix;

  // Fuzzy: contains
  const fuzzy = skills.find((s) => s.name.includes(name));
  return fuzzy;
}

function showStatus(
  ctx: ExtensionCommandContext,
  skills: ReadonlyArray<ToggleSkill>,
): void {
  const lines: string[] = [];

  if (skills.length === 0) {
    lines.push("No skills found. Add skills to ~/.pi/agent/skills/ or .pi/skills/.");
  } else {
    const visible = skills.filter((s) => !s.disabled);
    const hidden = skills.filter((s) => s.disabled);

    if (hidden.length > 0) {
      lines.push(`Visible skills (${visible.length}):`);
      for (const skill of visible) {
        lines.push(`  ✓ ${skill.name}`);
      }
      lines.push("");
      lines.push(`Hidden skills (${hidden.length}):`);
      for (const skill of hidden) {
        lines.push(`  ✗ ${skill.name}`);
      }
    } else {
      lines.push(`All skills visible (${skills.length}):`);
      for (const skill of skills) {
        lines.push(`  ✓ ${skill.name}`);
      }
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
