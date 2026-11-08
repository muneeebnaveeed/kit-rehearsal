import { describe, expect, it } from "vitest";
import {
  addIssueRef,
  beforeScissors,
  branchFromRebase,
  hooksPathAction,
  issueFromBranch,
  parsePushUpdates,
  planPush,
} from "./lib/hooks.mjs";

describe("issueFromBranch", () => {
  it("reads the issue number from a work branch", () => {
    expect(issueFromBranch("team-2/14-add-login")).toBe(14);
    expect(issueFromBranch("platform/152-git-hooks")).toBe(152);
    expect(issueFromBranch("team-instructor/3-x")).toBe(3);
  });
  it("returns null for anything else", () => {
    for (const b of ["main", "prod", "feature/team-2", "HEAD", "my-branch", "team-9/1-x"])
      expect(issueFromBranch(b)).toBeNull();
  });
});

describe("addIssueRef", () => {
  const branch = "team-2/14-add-login";

  it("adds Refs #N as its own paragraph when the message has none", () => {
    expect(addIssueRef("feat(team-2): add login\n", branch)).toBe("feat(team-2): add login\n\nRefs #14\n");
    expect(addIssueRef("feat(team-2): add login\n\nPlayers need accounts.\n", branch)).toBe(
      "feat(team-2): add login\n\nPlayers need accounts.\n\nRefs #14\n",
    );
  });

  it("leaves a message that already references an issue alone", () => {
    for (const msg of ["feat: x\n\nRefs #3\n", "fix: y\n\nCloses #14\n", "fix: y\n\nFixes #2\n"])
      expect(addIssueRef(msg, branch)).toBe(msg);
  });

  it("leaves merges, reverts, fixups and empty messages alone", () => {
    for (const msg of [
      "Merge branch 'main' into team-2/14-add-login\n",
      'Revert "feat: x"\n',
      "fixup! feat: x\n",
      "squash! feat: x\n",
      "",
      "# only a comment\n",
    ])
      expect(addIssueRef(msg, branch)).toBe(msg);
  });

  it("does nothing off a work branch", () => {
    expect(addIssueRef("feat: x\n", "main")).toBe("feat: x\n");
  });

  it("keeps trailers last, after the reference", () => {
    expect(addIssueRef("feat: x\n\nBody.\n\nCo-Authored-By: A <a@b.c>\n", branch)).toBe(
      "feat: x\n\nBody.\n\nRefs #14\n\nCo-Authored-By: A <a@b.c>\n",
    );
    expect(addIssueRef("feat: x\n\nCo-Authored-By: A <a@b.c>\nSigned-off-by: B <b@c.d>\n", branch)).toBe(
      "feat: x\n\nRefs #14\n\nCo-Authored-By: A <a@b.c>\nSigned-off-by: B <b@c.d>\n",
    );
  });

  it("puts the reference before git's comment lines, so the editor template still works", () => {
    const edited =
      "feat: x\n\n# Please enter the commit message for your changes.\n# On branch team-2/14-add-login\n";
    expect(addIssueRef(edited, branch)).toBe(
      "feat: x\n\nRefs #14\n\n# Please enter the commit message for your changes.\n# On branch team-2/14-add-login\n",
    );
  });

  it("keeps CRLF messages working", () => {
    expect(addIssueRef("feat: x\r\n", branch)).toBe("feat: x\n\nRefs #14\n");
  });

  it("leaves the git commit -v diff below the scissors line where it is", () => {
    const scissors = "# ------------------------ >8 ------------------------";
    const verbose = [
      "feat: x",
      "",
      "# Please enter the commit message for your changes.",
      scissors,
      "# Do not modify or remove the line above.",
      "# Everything below it will be ignored.",
      "diff --git a/a b/a",
      "+Refs #99",
      "",
    ].join("\n");
    const out = addIssueRef(verbose, branch);
    expect(out).toBe(verbose.replace("feat: x\n", "feat: x\n\nRefs #14\n"));
    expect(beforeScissors(out)).not.toContain("diff --git");
    // A reference in the diff doesn't count as the message's own.
    expect(out).toContain("Refs #14");
  });

  it("fills in the bare Refs # placeholder from .gitmessage instead of adding a second one", () => {
    const template = "feat(team-2): add login\n\nWhy.\n\nRefs #\n# Format: type(scope): subject\n";
    expect(addIssueRef(template, branch)).toBe(
      "feat(team-2): add login\n\nWhy.\n\nRefs #14\n# Format: type(scope): subject\n",
    );
  });

  it("keeps # lines inside the message where they are", () => {
    expect(addIssueRef("fix: x\n\n# not a comment\nBody.\n", branch)).toBe(
      "fix: x\n\n# not a comment\nBody.\n\nRefs #14\n",
    );
  });
});

describe("beforeScissors", () => {
  it("cuts at git's scissors line and leaves other messages whole", () => {
    expect(beforeScissors("feat: x\n# ---- >8 ----\ndiff")).toBe("feat: x");
    expect(beforeScissors("feat: x\n\nRefs #1\n")).toBe("feat: x\n\nRefs #1\n");
  });
});

describe("branchFromRebase", () => {
  it("reads the branch from rebase-merge/head-name", () => {
    expect(branchFromRebase("refs/heads/team-2/14-add-login\n")).toBe("team-2/14-add-login");
    expect(branchFromRebase("detached HEAD")).toBe("");
    expect(branchFromRebase(null)).toBe("");
  });
});

describe("planPush", () => {
  const head = "a".repeat(40);
  const zero = "0".repeat(40);
  const line = (localRef: string, localSha: string, remoteRef: string) =>
    `${localRef} ${localSha} ${remoteRef} ${"b".repeat(40)}`;
  const plan = (...lines: string[]) =>
    planPush({ updates: parsePushUpdates(lines.join("\n")), headSha: head });

  it("runs the checks when the checked-out commit is pushed", () => {
    expect(plan(line("refs/heads/team-2/14-x", head, "refs/heads/team-2/14-x"))).toEqual({ run: true });
    expect(plan(line("HEAD", head, "refs/heads/team-2/14-x"))).toEqual({ run: true });
  });

  it("skips deletions and tags", () => {
    expect(plan(line("(delete)", zero, "refs/heads/old"))).toMatchObject({ run: false });
    expect(plan(line("refs/tags/v1", "c".repeat(40), "refs/tags/v1"))).toMatchObject({ run: false });
    expect(plan()).toEqual({ run: false, reason: "nothing new to push, nothing to check." });
  });

  it("skips another branch than the one checked out, and says why", () => {
    const p = plan(line("refs/heads/other", "c".repeat(40), "refs/heads/other"));
    expect(p).toMatchObject({ run: false });
    expect("reason" in p && p.reason).toContain("other");
  });

  it("skips when one of several pushed branches is not the checked-out commit", () => {
    expect(
      plan(line("refs/heads/a", head, "refs/heads/a"), line("refs/heads/b", "c".repeat(40), "refs/heads/b")),
    ).toMatchObject({ run: false });
  });
});

describe("hooksPathAction", () => {
  it("sets the path when it's unset or already ours", () => {
    expect(hooksPathAction({ isGitCheckout: true, current: null, ci: false })).toBe("set");
    expect(hooksPathAction({ isGitCheckout: true, current: ".githooks", ci: false })).toBe("already");
  });
  it("never overrides someone else's hooks path", () => {
    expect(hooksPathAction({ isGitCheckout: true, current: "~/.my-hooks", ci: false })).toBe("foreign");
  });
  it("skips outside a git checkout (e.g. a Railway build) and in CI", () => {
    expect(hooksPathAction({ isGitCheckout: false, current: null, ci: false })).toBe("skip");
    expect(hooksPathAction({ isGitCheckout: true, current: null, ci: true })).toBe("skip");
  });
});
