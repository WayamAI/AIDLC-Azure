export type ActiveRepo = {
  owner: string;
  repo: string;
  repoUrl: string;
  branch: string;
};

export function parseGithubRepo(raw: string, branch = "main"): ActiveRepo | null {
  const input = raw.trim().replace(/\.git$/, "");
  if (!input) return null;

  const noProtocol = input
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^github\.com\//, "");

  const parts = noProtocol.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) return null;

  return {
    owner: parts[0],
    repo: parts[1],
    repoUrl: `https://github.com/${parts[0]}/${parts[1]}`,
    branch: branch.trim() || "main",
  };
}
