import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLibrary, type AppSummary } from "./AppLibrary";
import { apiClient } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiClient: { get: vi.fn(), delete: vi.fn() },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const del = vi.mocked(apiClient.delete);

function app(overrides: Partial<AppSummary> & { workspace_id: string }): AppSummary {
  return {
    name: null,
    idea: null,
    status: "done",
    file_count: 3,
    repo_url: null,
    created_at: null,
    updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function renderLibrary(props: Partial<Parameters<typeof AppLibrary>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpen = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AppLibrary onOpen={onOpen} {...props} />
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe("AppLibrary", () => {
  beforeEach(() => {
    get.mockReset();
    del.mockReset();
  });

  it("renders cards from the API with status, files and the panel count", async () => {
    get.mockResolvedValue({
      data: {
        apps: [
          app({ workspace_id: "w1", name: "Habit tracker", idea: "Track habits", status: "done", file_count: 4, repo_url: "https://github.com/a/b" }),
          app({ workspace_id: "w2", name: "Broken", idea: null, status: "error", file_count: 1, updated_at: null, created_at: null }),
        ],
      },
    });
    renderLibrary();

    expect(await screen.findByRole("heading", { name: /your apps \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Habit tracker" })).toBeInTheDocument();
    expect(screen.getByText("Track habits")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText("4 files")).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.getByText(/Updated about 3 hours ago/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github repository for habit tracker/i })).toHaveAttribute(
      "href",
      "https://github.com/a/b",
    );
    expect(get).toHaveBeenCalledWith("/ai-ide/workspaces");
  });

  it("falls back to the first 60 characters of the idea, then to Untitled app", async () => {
    const longIdea = "x".repeat(80);
    get.mockResolvedValue({
      data: {
        apps: [
          app({ workspace_id: "w1", name: null, idea: longIdea }),
          app({ workspace_id: "w2", name: "   ", idea: null }),
        ],
      },
    });
    renderLibrary();

    expect(await screen.findByRole("heading", { name: "x".repeat(60) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Untitled app" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no apps", async () => {
    get.mockResolvedValue({ data: { apps: [] } });
    renderLibrary();
    expect(await screen.findByText("No apps yet. Describe one above to build your first app.")).toBeInTheDocument();
  });

  it("shows an error with a Retry button that refetches", async () => {
    get.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Database offline" } } });
    get.mockResolvedValueOnce({ data: { apps: [app({ workspace_id: "w1", name: "Recovered" })] } });
    renderLibrary();

    expect(await screen.findByRole("alert")).toHaveTextContent("Database offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Recovered" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("calls onOpen with the app's id, idea and name when Open is clicked", async () => {
    get.mockResolvedValue({ data: { apps: [app({ workspace_id: "w9", name: "Notes", idea: "A notes app" })] } });
    const { onOpen } = renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith({ workspace_id: "w9", idea: "A notes app", name: "Notes" });
  });

  it("marks the current workspace card", async () => {
    get.mockResolvedValue({
      data: { apps: [app({ workspace_id: "w1", name: "One" }), app({ workspace_id: "w2", name: "Two" })] },
    });
    renderLibrary({ currentWorkspaceId: "w2" });

    const card = (await screen.findByRole("heading", { name: "Two" })).closest("li");
    expect(card).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "One" }).closest("li")).not.toHaveAttribute("aria-current");
  });

  it("filters by name or idea only when there are more than 6 apps", async () => {
    const apps = Array.from({ length: 7 }, (_, i) =>
      app({ workspace_id: `w${i}`, name: `App ${i}`, idea: i === 3 ? "a kanban board" : `idea ${i}` }),
    );
    get.mockResolvedValue({ data: { apps } });
    renderLibrary();

    await screen.findByRole("heading", { name: "App 0" });
    const search = screen.getByRole("searchbox", { name: "Search apps" });
    fireEvent.change(search, { target: { value: "kanban" } });

    expect(screen.getByRole("heading", { name: "App 3" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "App 0" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nothing matches" } });
    expect(screen.getByText(/No apps match/)).toBeInTheDocument();
  });

  it("hides the search box with 6 or fewer apps", async () => {
    get.mockResolvedValue({ data: { apps: [app({ workspace_id: "w1", name: "Only" })] } });
    renderLibrary();
    await screen.findByRole("heading", { name: "Only" });
    expect(screen.queryByRole("searchbox", { name: "Search apps" })).not.toBeInTheDocument();
  });

  it("confirms in-app before deleting, then calls DELETE and refreshes the list", async () => {
    get.mockResolvedValue({ data: { apps: [app({ workspace_id: "w1", name: "Doomed" })] } });
    del.mockResolvedValue({ data: { ok: true } });
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: "Delete Doomed" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Doomed?")).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/ai-ide/workspace/w1"));
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    get.mockResolvedValue({ data: { apps: [app({ workspace_id: "w1", name: "Keep" })] } });
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: "Delete Keep" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(del).not.toHaveBeenCalled();
  });
});
