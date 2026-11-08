// Tests for the field parser (lib/template.mjs): issue and PR templates and bodies are "**Label**: value" fields.
import { describe, expect, it } from "vitest";
import { renderField } from "./lib/pr-body.mjs";
import { fieldLabelsOf, fieldsOf } from "./lib/template.mjs";

describe("fieldsOf", () => {
  it("reads one-line fields and ignores the guidance comment before them", () => {
    const md = "<!--\nTitle: x\n-->\n**Linked issue**: Closes #12\n**Team**: <!-- hint -->\n";
    expect(fieldsOf(md)).toEqual([
      { heading: "Linked issue", body: "Closes #12" },
      { heading: "Team", body: "" },
    ]);
  });

  it("keeps a value that runs over several lines, lists included, until the next field", () => {
    const md =
      "**Summary**: Players lose progress.\nLogging in keeps it.\n\n**How to test**:\n1. Log in\n2. Reload\n";
    expect(fieldsOf(md)).toEqual([
      { heading: "Summary", body: "Players lose progress.\nLogging in keeps it." },
      { heading: "How to test", body: "1. Log in\n2. Reload" },
    ]);
  });

  it("does not take a bold word mid-sentence, or a field-looking line in a code fence, as a field", () => {
    const md = "**Summary**: This is **important**: really.\n```\n**Fake**: no\n```\n**Screenshots**: None";
    expect(fieldLabelsOf(md)).toEqual(["Summary", "Screenshots"]);
    expect(fieldsOf(md)[0]?.body).toContain("**Fake**: no");
  });

  it("gives a checklist field its items", () => {
    const md = "**Checklist**:\n- [x] one\n- [ ] two\n";
    expect(fieldsOf(md)).toEqual([{ heading: "Checklist", body: "- [x] one\n- [ ] two" }]);
  });

  it("reads back what renderField writes", () => {
    const md = [renderField("Summary", "why"), renderField("How to test", "1. a\n2. b")].join("\n");
    expect(fieldsOf(md)).toEqual([
      { heading: "Summary", body: "why" },
      { heading: "How to test", body: "1. a\n2. b" },
    ]);
  });

  it("reads fields with no blank line between them, and a multi-paragraph value as one field", () => {
    const md = [
      renderField("Summary", "First paragraph.\n\nSecond paragraph.\n\nIncluded pull requests:\n\n- #1 a"),
      renderField("Screenshots", "None, nothing visible"),
      renderField("Checklist", "- [x] one"),
    ].join("\n");
    expect(md).not.toMatch(/\n\n\*\*/);
    expect(fieldsOf(md)).toEqual([
      {
        heading: "Summary",
        body: "First paragraph.\n\nSecond paragraph.\n\nIncluded pull requests:\n\n- #1 a",
      },
      { heading: "Screenshots", body: "None, nothing visible" },
      { heading: "Checklist", body: "- [x] one" },
    ]);
  });

  it("reads an issue template's fields after its front matter", () => {
    const md =
      "---\nname: Bug\n---\n\n<!--\nTitle: x\n-->\n**Goal**: <!-- hint -->\n**Done when**: <!-- hint -->\n- [ ]\n";
    expect(fieldsOf(md)).toEqual([
      { heading: "Goal", body: "" },
      { heading: "Done when", body: "- [ ]" },
    ]);
  });
});
