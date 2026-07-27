import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ToggleSkillSelectorComponent } from "../../src/skill-selector.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

describe("ToggleSkillSelectorComponent", () => {
  it.each([20, 40, 60])("never renders wider than %i columns", (width) => {
    const component = new ToggleSkillSelectorComponent(
      theme,
      [{
        name: "skill-with-a-long-name",
        description: "A long skill description that must wrap safely on narrow terminals.",
        filePath: "/a/very/long/path/to/the/skill/SKILL.md",
        baseDir: "/a/very/long/path/to/the/skill",
        disabled: false,
      }],
      () => {},
    );

    for (const line of component.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
