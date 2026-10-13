import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type CommitResult, type PushResult } from "@/lib/api";
import {
  clearUnpushedCommit,
  getUnpushedCommit,
  pushErrorMessage,
  recordCommitResult,
  unpushedCommitMessage,
  usePushBranch,
  useUnpushedCommit,
} from "./use-git";

const WS = "ws-test";

function commit(overrides: Partial<CommitResult> = {}): CommitResult {
  return {
    sha: "abcdef1234567890",
    message: "msg",
    branch: "main",
    github_url: "https://github.com/o/r/commit/abcdef1234567890",
    timestamp: "2026-01-01T00:00:00Z",
    push_ok: true,
    push_error: null,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  clearUnpushedCommit(WS);
  vi.restoreAllMocks();
});

describe("unpushed commit state", () => {
  it("is derived from the commit response", () => {
    const failed = recordCommitResult(WS, commit({ push_ok: false, push_error: "Add a GitHub token." }));
    expect(failed).toEqual({ sha: "abcdef1234567890", branch: "main", error: "Add a GitHub token." });
    expect(getUnpushedCommit(WS)).toEqual(failed);
    expect(unpushedCommitMessage(failed!)).toBe(
      "Commit abcdef1 is saved in the workspace but is not on the remote yet. Add a GitHub token.",
    );

    // A later successful commit+push sends the whole branch.
    expect(recordCommitResult(WS, commit())).toBeNull();
    expect(getUnpushedCommit(WS)).toBeNull();
  });

  it("treats a response without push_ok (older backend) as pushed", () => {
    const legacy = commit();
    delete (legacy as Partial<CommitResult>).push_ok;
    expect(recordCommitResult(WS, legacy)).toBeNull();
  });

  it("is per workspace and re-renders subscribers", () => {
    const { result } = renderHook(() => useUnpushedCommit(WS));
    const other = renderHook(() => useUnpushedCommit("another-workspace"));
    expect(result.current).toBeNull();

    act(() => {
      recordCommitResult(WS, commit({ push_ok: false, push_error: "nope" }));
    });
    expect(result.current?.sha).toBe("abcdef1234567890");
    expect(other.result.current).toBeNull();

    act(() => clearUnpushedCommit(WS));
    expect(result.current).toBeNull();
  });
});

describe("usePushBranch", () => {
  it("calls the push endpoint and clears the unpushed commit on success", async () => {
    const pushed: PushResult = {
      workspace_id: WS,
      branch: "main",
      sha: "abcdef1234567890",
      github_url: "https://github.com/o/r/commit/abcdef1234567890",
      pushed: true,
      up_to_date: false,
      message: "Pushed abcdef1 to main.",
    };
    const spy = vi.spyOn(api, "pushBranch").mockResolvedValue(pushed);
    recordCommitResult(WS, commit({ push_ok: false, push_error: "nope" }));

    const { result } = renderHook(() => usePushBranch(), { wrapper });
    let response: PushResult | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({ workspace_id: WS, branch: "main" });
    });

    expect(spy).toHaveBeenCalledWith({ workspace_id: WS, branch: "main" });
    expect(response?.message).toBe("Pushed abcdef1 to main.");
    expect(getUnpushedCommit(WS)).toBeNull();
  });

  it("keeps the unpushed commit and stores the server's message on failure", async () => {
    const detail = "GitHub needs a token to accept this push and none is available.";
    vi.spyOn(api, "pushBranch").mockRejectedValue({ response: { status: 400, data: { detail } } });
    recordCommitResult(WS, commit({ push_ok: false, push_error: "old reason" }));

    const { result } = renderHook(() => usePushBranch(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ workspace_id: WS, branch: "main" })).rejects.toBeTruthy();
    });

    await waitFor(() => expect(getUnpushedCommit(WS)?.error).toBe(detail));
    expect(getUnpushedCommit(WS)?.sha).toBe("abcdef1234567890");
  });
});

describe("pushErrorMessage", () => {
  it("never yields raw JSON or [object Object]", () => {
    const structured = { response: { status: 422, data: { detail: [{ loc: ["body", "branch"], msg: "Field required" }] } } };
    const text = pushErrorMessage(structured);
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("{");
    expect(pushErrorMessage({ response: { status: 502, data: { detail: { code: 7 } } } })).toBe(
      "The push failed. Try again.",
    );
    expect(pushErrorMessage({ response: { status: 502, data: { detail: "Push failed: remote hung up" } } })).toBe(
      "Push failed: remote hung up",
    );
  });
});
