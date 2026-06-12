/**
 * ToggleSkillSelectorComponent — an interactive TUI for toggling which
 * skills are visible in pi's system prompt.
 *
 * Modeled after pi-hide-providers' HideProviderSelectorComponent:
 * - Lists all discovered skills with their enabled/disabled status
 * - Search/filter via Input component
 * - Enter toggles disable-model-invocation for the selected skill
 * - Ctrl+A / Ctrl+D bulk disable/enable (respects search filter)
 * - Ctrl+S to save changes to disk and reload pi
 * - Esc to cancel (discard in-memory toggles)
 *
 * Changes are collected in-memory and only written to disk on Ctrl+S.
 * After writing, the user runs /reload so the skill list in the system prompt updates.
 */

import {
  Container,
  type Component,
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, keyText } from "@earendil-works/pi-coding-agent";
import { type ToggleSkill, formatSkillStatus } from "./index.js";

interface DisplayItem {
  name: string;
  description: string;
  filePath: string;
  disabled: boolean;
}

export interface ToggleSkillSelectorResult {
  /** Skills with their final toggle states. */
  skills: ToggleSkill[];
  /** If true, the user cancelled and changes should not be written. */
  cancelled: boolean;
}

export class ToggleSkillSelectorComponent implements Component {
  private theme: Theme;
  private done: (result: ToggleSkillSelectorResult) => void;

  // All skill items (immutable original list)
  private allItems: DisplayItem[] = [];

  // Current in-memory toggle states (keyed by filePath)
  private disabledMap: Map<string, boolean> = new Map();

  // UI state
  private lastWidth = 80;
  private filteredItems: DisplayItem[] = [];
  private selectedIndex = 0;
  private maxVisible = 10;
  private searchInput: Input;
  private listContainer: Container;
  private footerText: Text;
  private hasChanges = false;
  private originalSkills: ToggleSkill[] = [];

  // Focusable
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    theme: Theme,
    skills: ToggleSkill[],
    done: (result: ToggleSkillSelectorResult) => void,
  ) {
    this.theme = theme;
    this.done = done;
    this.originalSkills = skills;

    // Build display items and initial state map
    for (const skill of skills) {
      this.allItems.push({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        disabled: skill.disabled,
      });
      this.disabledMap.set(skill.filePath, skill.disabled);
    }
    this.filteredItems = [...this.allItems];

    this.searchInput = new Input();
    this.listContainer = new Container();
    this.footerText = new Text(this.getFooterText(), 0, 0);

    this.searchInput.onSubmit = () => {
      if (this.filteredItems[this.selectedIndex]) {
        this.toggleItem(this.filteredItems[this.selectedIndex]);
      }
    };

    this.updateList();
  }

  render(width: number): string[] {
    if (this.lastWidth !== width) {
      this.lastWidth = width;
      this.updateList();
    }
    const lines: string[] = [];

    lines.push(...new DynamicBorder((s) => this.theme.fg("accent", s)).render(width));
    lines.push("");
    lines.push(this.theme.fg("accent", this.theme.bold("Toggle Skill Visibility")));
    lines.push(
      this.theme.fg(
        "muted",
        `Toggle disable-model-invocation on skills. Hidden skills won't appear in the system prompt.`,
      ),
    );
    lines.push("");
    lines.push(...this.searchInput.render(width));
    lines.push("");
    lines.push(...this.listContainer.render(width));
    lines.push("");
    lines.push(...this.footerText.render(width));
    lines.push(...new DynamicBorder((s) => this.theme.fg("accent", s)).render(width));

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredItems.length - 1
          : this.selectedIndex - 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredItems.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.updateList();
      return;
    }

    // Enter — toggle selected item
    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) {
        this.toggleItem(item);
      }
      return;
    }

    // Ctrl+A — disable all (filtered if search active)
    if (matchesKey(data, Key.ctrl("a"))) {
      const targets = this.getFilterTargets();
      this.disableSkills(targets);
      this.hasChanges = true;
      this.refresh();
      return;
    }

    // Ctrl+D — enable all (filtered if search active)
    if (matchesKey(data, Key.ctrl("d"))) {
      const targets = this.getFilterTargets();
      this.enableSkills(targets);
      this.hasChanges = true;
      this.refresh();
      return;
    }

    // Ctrl+S — save and close
    if (matchesKey(data, Key.ctrl("s"))) {
      this.finish(false);
      return;
    }

    // Escape — cancel
    if (matchesKey(data, Key.escape)) {
      this.finish(true);
      return;
    }

    // Ctrl+C — clear search or cancel if empty
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.refresh();
      } else {
        this.finish(true);
      }
      return;
    }

    // Pass everything else to search input
    this.searchInput.handleInput(data);
    this.refresh();
  }

  invalidate(): void {
    this.searchInput.invalidate();
    this.listContainer.invalidate();
    this.footerText.invalidate();
  }

  // Internal helpers

  private getFilterTargets(): DisplayItem[] {
    const query = this.searchInput.getValue();
    return query ? this.filteredItems : this.allItems;
  }

  private getFooterText(): string {
    const allCount = this.allItems.length;
    const hiddenCount = this.allItems.filter((item) => this.disabledMap.get(item.filePath) ?? item.disabled).length;
    const visibleCount = allCount - hiddenCount;

    const parts: string[] = [
      `${keyText("tui.select.confirm")} toggle`,
      `ctrl+a hide all`,
      `ctrl+d show all`,
      `ctrl+s save & reload`,
      `${visibleCount} visible · ${hiddenCount} hidden`,
    ];

    const text = parts.join(" · ");
    return this.hasChanges
      ? this.theme.fg("dim", `  ${text} `) + this.theme.fg("warning", "(unsaved)")
      : this.theme.fg("dim", `  ${text}`);
  }

  private refresh(): void {
    const query = this.searchInput.getValue();
    this.filteredItems = query
      ? fuzzyFilter(
          this.allItems,
          query,
          (item: DisplayItem) => `${item.name} ${item.description} ${item.filePath}`,
        )
      : [...this.allItems];

    // Update disabled status from the map
    for (const item of this.filteredItems) {
      item.disabled = this.disabledMap.get(item.filePath) ?? item.disabled;
    }

    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredItems.length - 1),
    );
    this.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();

    if (this.filteredItems.length === 0) {
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", "  No matching skills"), 0, 0),
      );
      this.footerText.setText(this.getFooterText());
      return;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.filteredItems.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;

      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? this.theme.fg("accent", "→ ") : "  ";
      const nameText = isSelected
        ? this.theme.fg("accent", item.name)
        : item.name;
      const status = item.disabled
        ? this.theme.fg("dim", " ✗")
        : this.theme.fg("success", " ✓");

      this.listContainer.addChild(
        new Text(`${prefix}${nameText}${status}`, 0, 0),
      );
    }

    // Scroll indicator
    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      this.listContainer.addChild(
        new Text(
          this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`),
          0,
          0,
        ),
      );
    }

    // Detail area for the selected item
    if (this.filteredItems.length > 0) {
      const selected = this.filteredItems[this.selectedIndex];
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(
          this.theme.fg("dim", `  Source: ${selected.filePath}`),
          0,
          0,
        ),
      );
      const descLines = this.wrapDescription(selected.description);
      for (let i = 0; i < descLines.length; i++) {
        const prefix = i === 0 ? "  Description: " : "               ";
        this.listContainer.addChild(
          new Text(this.theme.fg("muted", `${prefix}${descLines[i]}`), 0, 0),
        );
      }
    }

    this.footerText.setText(this.getFooterText());
  }

  /** Toggle a single item between disabled and enabled. */
  private toggleItem(item: DisplayItem): void {
    const current = this.disabledMap.get(item.filePath) ?? item.disabled;
    this.disabledMap.set(item.filePath, !current);
    this.hasChanges = this.hasChanges || current !== this.getOriginalState(item.filePath);
    // Recompute hasChanges against originals
    this.recheckHasChanges();
    this.refresh();
  }

  /** Disable all given items. */
  private disableSkills(items: DisplayItem[]): void {
    for (const item of items) {
      this.disabledMap.set(item.filePath, true);
    }
    this.recheckHasChanges();
    this.refresh();
  }

  /** Enable all given items. */
  private enableSkills(items: DisplayItem[]): void {
    for (const item of items) {
      this.disabledMap.set(item.filePath, false);
    }
    this.recheckHasChanges();
    this.refresh();
  }

  /** Word-wrap a description string, fitting the terminal width. */
  private wrapDescription(text: string): string[] {
    const label = "  Description: ";
    const indent = "               ";
    const firstLineWidth = Math.max(20, this.lastWidth - label.length);
    const contLineWidth = Math.max(20, this.lastWidth - indent.length);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const lineLen = currentLine.length === 0 ? 0 : currentLine.length + 1;
      const limit = lines.length === 0 ? firstLineWidth : contLineWidth;
      if (lineLen + word.length > limit && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }

  /** Check if any item's state differs from its original. */
  private getOriginalState(filePath: string): boolean {
    return this.originalSkills.find((s) => s.filePath === filePath)?.disabled ?? false;
  }

  private recheckHasChanges(): void {
    this.hasChanges = this.allItems.some((item) => {
      const current = this.disabledMap.get(item.filePath) ?? item.disabled;
      return current !== this.getOriginalState(item.filePath);
    });
  }

  /** Build final skill list from current toggle states and close. */
  private finish(cancelled: boolean): void {
    if (cancelled) {
      this.done({ skills: this.originalSkills, cancelled: true });
      return;
    }

    // Build updated skills from original + current toggle states
    const updatedSkills: ToggleSkill[] = this.originalSkills.map((skill) => ({
      ...skill,
      disabled: this.disabledMap.get(skill.filePath) ?? skill.disabled,
    }));

    this.done({ skills: updatedSkills, cancelled: false });
  }
}
