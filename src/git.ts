import { execFileSync } from "node:child_process";

export interface GitContext {
  branch: string | null;
  commit: string | null;
  commitShort: string | null;
  repoRoot: string | null;
}

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

let isGitRepo: boolean | null = null;

export function checkGitRepo(): boolean {
  if (isGitRepo === null) {
    isGitRepo = git("rev-parse", "--is-inside-work-tree") === "true";
    if (isGitRepo) {
      console.log(`Git repo detected: ${git("rev-parse", "--show-toplevel")}`);
    }
  }
  return isGitRepo;
}

export function getGitContext(): GitContext {
  if (!checkGitRepo()) {
    return { branch: null, commit: null, commitShort: null, repoRoot: null };
  }

  return {
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    commit: git("rev-parse", "HEAD"),
    commitShort: git("rev-parse", "--short", "HEAD"),
    repoRoot: git("rev-parse", "--show-toplevel"),
  };
}
