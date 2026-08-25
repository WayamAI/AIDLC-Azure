import { describe, expect, it } from "vitest";
import { parseGithubRepo } from "./github-repo";

describe("parseGithubRepo", () => {
  it("parses owner/repo", () => {
    expect(parseGithubRepo("acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
      repoUrl: "https://github.com/acme/widget",
      branch: "main",
    });
  });

  it("parses https URLs and .git suffix", () => {
    expect(parseGithubRepo("https://github.com/acme/widget.git", "develop")).toMatchObject({
      owner: "acme",
      repo: "widget",
      branch: "develop",
    });
  });

  it("rejects junk", () => {
    expect(parseGithubRepo("not-a-repo")).toBeNull();
    expect(parseGithubRepo("")).toBeNull();
  });
});
