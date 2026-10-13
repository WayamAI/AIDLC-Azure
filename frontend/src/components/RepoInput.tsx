import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/imcc/Panel";
import { parseGithubRepo } from "@/lib/github-repo";

interface RepoInputProps {
  /** Unique id for the input, so the label is associated with it. */
  id: string;
  /** Label of the submit button, e.g. "Load PRs". */
  action: string;
  onSearch: (owner: string, repo: string) => void;
  defaultUrl?: string;
  /** Shows a spinner on the button while the page is loading this repository. */
  busy?: boolean;
}

/**
 * The "GitHub repository" field used by the GitHub-backed pages. It accepts
 * `owner/repo` or a github.com URL and says so when the input is neither,
 * instead of doing nothing.
 */
export function RepoInput({ id, action, onSearch, defaultUrl = "", busy = false }: RepoInputProps) {
  const [input, setInput] = useState(defaultUrl);
  const [invalid, setInvalid] = useState(false);

  // The active repository can arrive after first render (it is restored from storage).
  useEffect(() => {
    setInput((current) => current || defaultUrl);
  }, [defaultUrl]);

  const submit = () => {
    const parsed = parseGithubRepo(input);
    setInvalid(!parsed);
    if (parsed) onSearch(parsed.owner, parsed.repo);
  };

  return (
    <Panel>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-secondary">
        GitHub repository
      </label>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <Input
          id={id}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setInvalid(false);
          }}
          placeholder="https://github.com/owner/repo"
          className="min-w-0 flex-1"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
        <Button type="submit" disabled={!input.trim() || busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {action}
        </Button>
      </form>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-destructive">
          Enter a GitHub repository as owner/repo or its full URL, for example https://github.com/owner/repo.
        </p>
      )}
    </Panel>
  );
}
