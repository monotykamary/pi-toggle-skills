import { expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import extension from "../../toggle-skills.js";

it("forwards custom-screen focus to the native Input across resize and invalidation", async () => {
  const root = resolve(".tmp/pi99-focus");
  const skill = root + "/.pi/skills/pi99/SKILL.md";
  mkdirSync(root + "/.pi/skills/pi99", { recursive: true });
  writeFileSync(skill, "---\nname: pi99\ndescription: Unicode 界 skill\n---\nInstructions\n");
  vi.stubEnv("PI_CODING_AGENT_DIR", root + "/agent");
  const handlers = new Map<string, any>(); let command: any;
  const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s };
  const ctx = { cwd: root, mode: "tui", ui: { notify() {}, custom: async (factory: any) => {
    const component = factory({ requestRender() {} }, theme, {}, () => {});
    component.focused = true;
    expect(component.focused).toBe(true);
    expect(component.render(40).join("\n")).toContain(CURSOR_MARKER);
    component.handleInput("界"); component.invalidate();
    for (const width of [20, 80]) for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    component.focused = false;
    expect(component.render(40).join("\n")).not.toContain(CURSOR_MARKER);
    return { cancelled: true };
  } } };
  try {
    extension({ on: (n: string, f: any) => handlers.set(n, f), registerCommand: (_: string, c: any) => { command = c; } } as any);
    await handlers.get("session_start")({}, ctx);
    await command.handler("", ctx);
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
});
