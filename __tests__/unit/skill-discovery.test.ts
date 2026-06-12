import {
  discoverSkills,
  toggleSkillInvocation,
  parseFrontmatter,
  applyChanges,
  type SkillDir,
} from "../../src/skill-discovery.js";
import { type ToggleSkill, DISABLE_MODEL_INVOCATION_KEY } from "../../src/index.js";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Test fixture helpers

const TEST_DIR = join(tmpdir(), "pi-toggle-skills-test");

function setupTestDir(structure: Record<string, string>): string {
  const dir = join(TEST_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });

  for (const [relativePath, content] of Object.entries(structure)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }

  return dir;
}

/** Create a SkillDir pointing at .pi/skills/ under the test cwd. */
function projectSkillDir(cwd: string): SkillDir {
  return { path: join(cwd, ".pi", "skills"), source: "project-pi" as const };
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// parseFrontmatter

describe("parseFrontmatter", () => {
  it("parses simple frontmatter", () => {
    const input = "---\nname: my-skill\ndescription: Does stuff\n---\n\n# Body";
    const { data, content } = parseFrontmatter(input);
    expect(data.name).toBe("my-skill");
    expect(data.description).toBe("Does stuff");
    expect(content.trim()).toBe("# Body");
  });

  it("parses frontmatter with disable-model-invocation", () => {
    const input = "---\nname: hidden-skill\ndescription: Shh\ndisable-model-invocation: true\n---\n\n# Body";
    const { data } = parseFrontmatter(input);
    expect(data[DISABLE_MODEL_INVOCATION_KEY]).toBe(true);
  });

  it("handles files with no frontmatter", () => {
    const input = "# Just a markdown file\n\nNo frontmatter here.";
    const { data, content } = parseFrontmatter(input);
    expect(Object.keys(data)).toHaveLength(0);
    expect(content.trim()).toBe("# Just a markdown file\n\nNo frontmatter here.");
  });
});

// toggleSkillInvocation

describe("toggleSkillInvocation", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(TEST_DIR, `toggle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("adds disable-model-invocation: true when disabling", () => {
    const skillPath = join(testDir, "SKILL.md");
    writeFileSync(skillPath, "---\nname: my-skill\ndescription: A test skill\n---\n\n# Body", "utf8");

    const result = toggleSkillInvocation(skillPath, true);
    expect(result).toBe(true);

    const { data } = parseFrontmatter(readFileSync(skillPath, "utf8"));
    expect(data[DISABLE_MODEL_INVOCATION_KEY]).toBe(true);
    expect(data.name).toBe("my-skill");
    expect(data.description).toBe("A test skill");
  });

  it("removes disable-model-invocation when enabling", () => {
    const skillPath = join(testDir, "SKILL.md");
    writeFileSync(
      skillPath,
      "---\nname: my-skill\ndescription: A test skill\ndisable-model-invocation: true\n---\n\n# Body",
      "utf8",
    );

    const result = toggleSkillInvocation(skillPath, false);
    expect(result).toBe(true);

    const { data } = parseFrontmatter(readFileSync(skillPath, "utf8"));
    expect(data[DISABLE_MODEL_INVOCATION_KEY]).toBeUndefined();
    expect(data.name).toBe("my-skill");
  });

  it("preserves other frontmatter fields", () => {
    const skillPath = join(testDir, "SKILL.md");
    writeFileSync(
      skillPath,
      "---\nname: my-skill\ndescription: A test\nmetadata:\n  author: someone\nlicense: MIT\n---\n\n# Body",
      "utf8",
    );

    toggleSkillInvocation(skillPath, true);
    const { data } = parseFrontmatter(readFileSync(skillPath, "utf8"));
    expect(data[DISABLE_MODEL_INVOCATION_KEY]).toBe(true);
    expect(data.name).toBe("my-skill");
    expect(data.metadata).toEqual({ author: "someone" });
    expect(data.license).toBe("MIT");
  });

  it("preserves body content exactly", () => {
    const skillPath = join(testDir, "SKILL.md");
    const body = "# My Skill\n\n```bash\n./script.sh --flag\n```";
    writeFileSync(
      skillPath,
      `---\nname: my-skill\ndescription: A test\n---\n\n${body}`,
      "utf8",
    );

    toggleSkillInvocation(skillPath, true);
    const { content } = parseFrontmatter(readFileSync(skillPath, "utf8"));
    expect(content.trim()).toBe(body);
  });

  it("returns false for non-existent file", () => {
    const result = toggleSkillInvocation("/nonexistent/path/SKILL.md", true);
    expect(result).toBe(false);
  });
});

// discoverSkills

describe("discoverSkills", () => {
  afterEach(() => {
    cleanup();
  });

  it("discovers skills from .pi/skills/ directory", () => {
    const cwd = setupTestDir({
      ".pi/skills/test-skill/SKILL.md": "---\nname: test-skill\ndescription: A test skill\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("test-skill");
    expect(skills[0].disabled).toBe(false);
  });

  it("discovers disabled skills", () => {
    const cwd = setupTestDir({
      ".pi/skills/hidden-skill/SKILL.md": "---\nname: hidden-skill\ndescription: Shh\ndisable-model-invocation: true\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toHaveLength(1);
    expect(skills[0].disabled).toBe(true);
  });

  it("discovers root .md files in .pi/skills/", () => {
    const cwd = setupTestDir({
      ".pi/skills/my-standalone.md": "---\nname: standalone\ndescription: A standalone skill\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("standalone");
  });

  it("skills skills without description", () => {
    const cwd = setupTestDir({
      ".pi/skills/no-desc/SKILL.md": "---\nname: no-desc\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toHaveLength(0);
  });

  it("returns empty array when no skill directories exist", () => {
    const cwd = setupTestDir({});
    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toEqual([]);
  });

  it("uses parent directory name as fallback when name is absent", () => {
    const cwd = setupTestDir({
      ".pi/skills/my-cool-skill/SKILL.md": "---\ndescription: No name provided\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-cool-skill");
  });

  it("returns the correct filePath and baseDir", () => {
    const cwd = setupTestDir({
      ".pi/skills/test-skill/SKILL.md": "---\nname: test-skill\ndescription: A test\n---\n\n# Body",
    });

    const skills = discoverSkills(cwd, { skillDirs: [projectSkillDir(cwd)] });
    expect(skills[0].filePath).toContain("test-skill/SKILL.md");
    expect(skills[0].baseDir).toContain("test-skill");
  });
});

// applyChanges

describe("applyChanges", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(TEST_DIR, `apply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("applies a batch of disable changes", () => {
    const skill1Path = join(testDir, "skill1", "SKILL.md");
    const skill2Path = join(testDir, "skill2", "SKILL.md");

    mkdirSync(join(testDir, "skill1"), { recursive: true });
    mkdirSync(join(testDir, "skill2"), { recursive: true });

    writeFileSync(skill1Path, "---\nname: skill-1\ndescription: First\n---\n\n# 1", "utf8");
    writeFileSync(skill2Path, "---\nname: skill-2\ndescription: Second\ndisable-model-invocation: true\n---\n\n# 2", "utf8");

    const skills: ToggleSkill[] = [
      { name: "skill-1", description: "First", filePath: skill1Path, baseDir: join(testDir, "skill1"), disabled: false },
      { name: "skill-2", description: "Second", filePath: skill2Path, baseDir: join(testDir, "skill2"), disabled: true },
    ];

    const changes = [
      { filePath: skill1Path, newDisabled: true },
      { filePath: skill2Path, newDisabled: false },
    ];

    const written = applyChanges(skills, changes);
    expect(written).toHaveLength(2);

    const { data: data1 } = parseFrontmatter(readFileSync(skill1Path, "utf8"));
    const { data: data2 } = parseFrontmatter(readFileSync(skill2Path, "utf8"));
    expect(data1[DISABLE_MODEL_INVOCATION_KEY]).toBe(true);
    expect(data2[DISABLE_MODEL_INVOCATION_KEY]).toBeUndefined();
  });

  it("skips changes where the state already matches", () => {
    const skillPath = join(testDir, "skill1", "SKILL.md");
    mkdirSync(join(testDir, "skill1"), { recursive: true });
    writeFileSync(skillPath, "---\nname: skill-1\ndescription: First\ndisable-model-invocation: true\n---\n\n# 1", "utf8");

    const skills: ToggleSkill[] = [
      { name: "skill-1", description: "First", filePath: skillPath, baseDir: join(testDir, "skill1"), disabled: true },
    ];

    const changes = [{ filePath: skillPath, newDisabled: true }];
    const written = applyChanges(skills, changes);
    expect(written).toHaveLength(0);
  });
});

// Symlink deduplication
describe("symlink deduplication", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not count skills twice when skill dirs are symlinked", () => {
    // Set up real skill directory at .pi/skills/test-skill/SKILL.md
    const cwd = setupTestDir({
      ".pi/skills/test-skill/SKILL.md": "---\nname: test-skill\ndescription: A test skill\n---\n\n# Body",
    });

    // Symlink .agents/skills → .pi/skills so both paths lead to the same files
    const agentsSkillsDir = join(cwd, ".agents", "skills");
    const piSkillsDir = join(cwd, ".pi", "skills");
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    symlinkSync(piSkillsDir, agentsSkillsDir, "junction");

    // Scan both directories
    const skillDirs: SkillDir[] = [
      { path: piSkillsDir, source: "project-pi" },
      { path: agentsSkillsDir, source: "project-agents" },
    ];

    const skills = discoverSkills(cwd, { skillDirs });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("test-skill");
  });

  it("resolves filePath to real path so dedup works across symlinks", () => {
    const cwd = setupTestDir({
      ".pi/skills/symlinked-skill/SKILL.md": "---\nname: symlinked-skill\ndescription: Real path\n---\n\n# Body",
    });

    // Symlink .agents/skills → .pi/skills
    const agentsSkillsDir = join(cwd, ".agents", "skills");
    const piSkillsDir = join(cwd, ".pi", "skills");
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    symlinkSync(piSkillsDir, agentsSkillsDir, "junction");

    // Scan only the symlinked directory
    const skillDirs: SkillDir[] = [
      { path: agentsSkillsDir, source: "project-agents" },
    ];

    const skills = discoverSkills(cwd, { skillDirs });
    expect(skills).toHaveLength(1);
    // filePath should be the real path, not the symlinked path
    expect(skills[0].filePath).not.toContain(".agents");
    expect(skills[0].filePath).toContain(".pi");
  });

  it("deduplicates by real path when both symlinked and real dirs are scanned", () => {
    const cwd = setupTestDir({
      ".pi/skills/a/SKILL.md": "---\nname: skill-a\ndescription: Skill A\n---\n\n# A",
      ".pi/skills/b/SKILL.md": "---\nname: skill-b\ndescription: Skill B\n---\n\n# B",
    });

    // Symlink .agents/skills → .pi/skills
    const agentsSkillsDir = join(cwd, ".agents", "skills");
    const piSkillsDir = join(cwd, ".pi", "skills");
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    symlinkSync(piSkillsDir, agentsSkillsDir, "junction");

    const skillDirs: SkillDir[] = [
      { path: piSkillsDir, source: "project-pi" },
      { path: agentsSkillsDir, source: "project-agents" },
    ];

    const skills = discoverSkills(cwd, { skillDirs });
    // Should find exactly 2 skills, not 4
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-a", "skill-b"]);
  });
});
