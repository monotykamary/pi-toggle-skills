import {
  isDisabled,
  formatSkillStatus,
  formatSkillLine,
  deduplicateSkills,
  computeChanges,
  validateSkillName,
  DISABLE_MODEL_INVOCATION_KEY,
  type ToggleSkill,
} from "../../src/index.js";

// isDisabled

describe("isDisabled", () => {
  it("returns true when disable-model-invocation is true", () => {
    expect(isDisabled({ [DISABLE_MODEL_INVOCATION_KEY]: true })).toBe(true);
  });

  it("returns false when disable-model-invocation is false", () => {
    expect(isDisabled({ [DISABLE_MODEL_INVOCATION_KEY]: false })).toBe(false);
  });

  it("returns false when disable-model-invocation is absent", () => {
    expect(isDisabled({ name: "my-skill" })).toBe(false);
  });

  it("returns false when disable-model-invocation is a truthy non-boolean", () => {
    expect(isDisabled({ [DISABLE_MODEL_INVOCATION_KEY]: "yes" })).toBe(false);
  });

  it("returns false for empty frontmatter", () => {
    expect(isDisabled({})).toBe(false);
  });
});

// formatSkillStatus

describe("formatSkillStatus", () => {
  it("shows hidden for disabled skill", () => {
    const skill: ToggleSkill = {
      name: "test-skill",
      description: "A test",
      filePath: "/path/to/SKILL.md",
      baseDir: "/path/to",
      disabled: true,
    };
    expect(formatSkillStatus(skill)).toBe("✗ hidden");
  });

  it("shows visible for enabled skill", () => {
    const skill: ToggleSkill = {
      name: "test-skill",
      description: "A test",
      filePath: "/path/to/SKILL.md",
      baseDir: "/path/to",
      disabled: false,
    };
    expect(formatSkillStatus(skill)).toBe("✓ visible");
  });
});

// formatSkillLine

describe("formatSkillLine", () => {
  it("formats a visible skill", () => {
    const skill: ToggleSkill = {
      name: "my-skill",
      description: "Some description that might be long",
      filePath: "/a/SKILL.md",
      baseDir: "/a",
      disabled: false,
    };
    expect(formatSkillLine(skill)).toBe("my-skill [visible] — Some description that might be long");
  });

  it("formats a hidden skill", () => {
    const skill: ToggleSkill = {
      name: "hidden-skill",
      description: "A hidden one",
      filePath: "/b/SKILL.md",
      baseDir: "/b",
      disabled: true,
    };
    expect(formatSkillLine(skill)).toBe("hidden-skill [hidden] — A hidden one");
  });

  it("shows the full description without truncation", () => {
    const longDesc = "A".repeat(200);
    const skill: ToggleSkill = {
      name: "long-skill",
      description: longDesc,
      filePath: "/c/SKILL.md",
      baseDir: "/c",
      disabled: false,
    };
    const line = formatSkillLine(skill);
    const descPart = line.split(" — ")[1];
    expect(descPart).toBe(longDesc);
  });
});

// deduplicateSkills

describe("deduplicateSkills", () => {
  const base: ToggleSkill = {
    name: "skill-a",
    description: "desc",
    filePath: "/a/SKILL.md",
    baseDir: "/a",
    disabled: false,
  };

  it("removes duplicate skills by filePath", () => {
    const skills: ToggleSkill[] = [
      { ...base },
      { ...base, name: "other-name" }, // same filePath
    ];
    expect(deduplicateSkills(skills)).toHaveLength(1);
  });

  it("keeps skills with different filePaths", () => {
    const skills: ToggleSkill[] = [
      { ...base },
      { ...base, filePath: "/b/SKILL.md", name: "skill-b" },
    ];
    expect(deduplicateSkills(skills)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateSkills([])).toEqual([]);
  });

  it("keeps the first occurrence when duplicating", () => {
    const skills: ToggleSkill[] = [
      { ...base, name: "first" },
      { ...base, name: "second" },
    ];
    const result = deduplicateSkills(skills);
    expect(result[0].name).toBe("first");
  });
});

// computeChanges

describe("computeChanges", () => {
  it("detects a single toggle change", () => {
    const originals: ToggleSkill[] = [
      {
        name: "skill-a",
        description: "desc",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        disabled: false,
      },
    ];
    const current: ToggleSkill[] = [
      {
        name: "skill-a",
        description: "desc",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        disabled: true,
      },
    ];

    const changes = computeChanges(originals, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].filePath).toBe("/a/SKILL.md");
    expect(changes[0].originalDisabled).toBe(false);
    expect(changes[0].newDisabled).toBe(true);
  });

  it("returns empty when no changes", () => {
    const skills: ToggleSkill[] = [
      {
        name: "skill-a",
        description: "desc",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        disabled: false,
      },
    ];
    expect(computeChanges(skills, skills)).toHaveLength(0);
  });

  it("detects multiple changes", () => {
    const originals: ToggleSkill[] = [
      {
        name: "skill-a",
        description: "desc",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        disabled: false,
      },
      {
        name: "skill-b",
        description: "desc",
        filePath: "/b/SKILL.md",
        baseDir: "/b",
        disabled: true,
      },
    ];
    const current: ToggleSkill[] = [
      { ...originals[0], disabled: true },
      { ...originals[1], disabled: false },
    ];

    const changes = computeChanges(originals, current);
    expect(changes).toHaveLength(2);
  });

  it("ignores skills present in originals but missing from current", () => {
    const originals: ToggleSkill[] = [
      {
        name: "skill-a",
        description: "desc",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        disabled: false,
      },
    ];
    const current: ToggleSkill[] = [];

    expect(computeChanges(originals, current)).toHaveLength(0);
  });
});

// validateSkillName

describe("validateSkillName", () => {
  it("validates a correct name", () => {
    expect(validateSkillName("my-skill")).toEqual([]);
    expect(validateSkillName("pdf-processing")).toEqual([]);
    expect(validateSkillName("skill123")).toEqual([]);
  });

  it("rejects names exceeding 64 characters", () => {
    const longName = "a".repeat(65);
    const errors = validateSkillName(longName);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("64 characters");
  });

  it("rejects names with uppercase letters", () => {
    expect(validateSkillName("My-Skill")).toHaveLength(1);
  });

  it("rejects names starting with a hyphen", () => {
    const errors = validateSkillName("-skill");
    expect(errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("rejects names ending with a hyphen", () => {
    const errors = validateSkillName("skill-");
    expect(errors.some((e) => e.includes("start or end"))).toBe(true);
  });

  it("rejects names with consecutive hyphens", () => {
    const errors = validateSkillName("skill--name");
    expect(errors.some((e) => e.includes("consecutive"))).toBe(true);
  });

  it("rejects names with spaces", () => {
    expect(validateSkillName("my skill")).toHaveLength(1);
  });

  it("rejects names with underscores", () => {
    expect(validateSkillName("my_skill")).toHaveLength(1);
  });
});
