<div align="center">

# 🔘 pi-toggle-skills

**Toggle skill visibility in [pi](https://github.com/earendil-works/pi-coding-agent)'s system prompt**

_Flip `disable-model-invocation` on skills so the model only sees the ones you want._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

## The Problem

Pi loads skills from multiple directories and includes their names and descriptions in the system prompt. If you have many skills installed, the prompt gets noisy — the model sees every skill and may inappropriately trigger ones you rarely use.

Pi supports `disable-model-invocation: true` in SKILL.md frontmatter to hide a skill from the system prompt, but toggling it requires manually editing each YAML file. There's no interactive way to manage skill visibility.

## The Solution

`pi-toggle-skills` gives you an interactive TUI to toggle which skills are visible to the model:

- Discover all skills from the standard directories (`~/.pi/agent/skills/`, `.pi/skills/`, etc.)
- Interactive `/toggle-skills` command — search, toggle, done
- Flips `disable-model-invocation` directly in each SKILL.md's YAML frontmatter
- Auto-reloads pi after saving so changes take effect immediately
- Subcommands for quick CLI-style enable/disable

When a skill has `disable-model-invocation: true`, pi excludes it from the system prompt entirely. The skill is still available via explicit `/skill:name` commands — it just won't be suggested to the model automatically.

## Usage

### Interactive Commands

| Command                         | What it does                                    |
| ------------------------------- | ----------------------------------------------- |
| `/toggle-skills`                | Open interactive TUI to toggle skill visibility |
| `/toggle-skills status`         | Show current skills and their visibility status |
| `/toggle-skills disable <name>` | Hide a skill from the system prompt             |
| `/toggle-skills enable <name>`  | Show a skill in the system prompt               |
| `/toggle-skills list`           | Same as `/toggle-skills status`                 |
| `/toggle-skills help`           | Show usage reference                            |

### Interactive TUI Keybindings

| Key      | Action                                  |
| -------- | --------------------------------------- |
| `Enter`  | Toggle selected skill                   |
| `Ctrl+A` | Disable all (filtered if search active) |
| `Ctrl+D` | Enable all (filtered if search active)  |
| `Ctrl+S` | Save changes and reload pi              |
| `Esc`    | Cancel (discard changes)                |
| `Ctrl+C` | Clear search, or cancel if empty        |
| ↑/↓      | Navigate the list                       |

### CLI Examples

```
/toggle-skills disable brave-search
→ Disabled: "brave-search" — hidden from system prompt. Run /reload to apply.

/toggle-skills enable brave-search
→ Enabled: "brave-search" — visible in system prompt. Run /reload to apply.
```

## Installation

```bash
pi install https://github.com/monotykamary/pi-toggle-skills
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["https://github.com/monotykamary/pi-toggle-skills"]
}
```

Then `/reload` or restart pi.

For quick one-off tests:

```bash
pi -e ./toggle-skills.ts
```

## How It Works

```
Session starts
  → Extension discovers skills from standard directories
  → Parses SKILL.md YAML frontmatter to check disable-model-invocation
  → Notifies how many visible/hidden skills

/toggle-skills (interactive):
  → Opens TUI selector listing all skills
  → Changes collected in-memory (no disk writes until Ctrl+S)
  → Ctrl+S: writes changed SKILL.md files, calls ctx.reload()
  → Esc: discards changes, no files modified

/toggle-skills disable/enable:
  → Toggles disable-model-invocation in SKILL.md frontmatter
  → Adds the key when disabling, removes it when enabling (false is the default)
  → Uses gray-matter for safe YAML round-tripping
  → User must /reload for changes to take effect
```

The extension does NOT monkey-patch any pi internals. It modifies SKILL.md files on disk and relies on pi's skill re-scanning on `/reload` to apply changes.

### Frontmatter Changes

When disabling a skill, the extension adds `disable-model-invocation: true` to the SKILL.md frontmatter:

```yaml
---
name: my-skill
description: Does things
disable-model-invocation: true # ← added
---
```

When enabling, the key is removed entirely (since `false`/absent are equivalent):

```yaml
---
name: my-skill
description: Things done
---
```

### Skill Directories Scanned

The extension scans the same directories pi uses:

| Directory             | Scope                    |
| --------------------- | ------------------------ |
| `~/.pi/agent/skills/` | Global (pi-specific)     |
| `~/.agents/skills/`   | Global (agent-standard)  |
| `.pi/skills/`         | Project (pi-specific)    |
| `.agents/skills/`     | Project (agent-standard) |

Package skills, settings skills, and `--skill` paths are not currently scanned (they require reading `settings.json` and CLI args).

## Comparison with Alternatives

| Approach                    | Pros                                                                                                      | Cons                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **pi-toggle-skills** (this) | Interactive TUI; directly modifies SKILL.md; no intermediate config; auto-reload; batch changes with undo | Requires `/reload`; doesn't scan package/settings/CLI skills        |
| Manual SKILL.md editing     | No extension needed                                                                                       | Tedious; error-prone YAML editing; must remember frontmatter syntax |
| Deleting SKILL.md files     | Effective                                                                                                 | Destructive; must restore to re-enable; can't toggle back easily    |

## Development

```bash
npm install
npm test          # Vitest unit tests
npm run typecheck # TypeScript validation (pi-tui import error is expected — types resolve at runtime)
npm run lint:dead # Dead code detection (knip)
```

### Structure

```
.
├── toggle-skills.ts        # Main extension
├── src/
│   ├── index.ts             # Constants, types, and utilities
│   ├── skill-discovery.ts   # Skill directory scanning, frontmatter parsing/writing
│   └── skill-selector.ts    # Interactive TUI component
├── __tests__/
│   └── unit/
│       ├── toggle-skills.test.ts
│       └── skill-discovery.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── knip.json
```

## License

MIT
