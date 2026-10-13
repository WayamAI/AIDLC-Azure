import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  id: string;
  name: string;
  score: number | null;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", score: 20 },
  { id: "b", name: "Bravo", score: 90 },
  { id: "c", name: "Charlie", score: null },
  { id: "d", name: "Delta", score: 55 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { id: "score", header: "Score", align: "right", cell: (r) => r.score ?? "–", sortValue: (r) => r.score },
];

/** First-column text of every body row, in DOM order. */
function names(): string[] {
  const body = screen.getByRole("table").querySelectorAll("tbody tr");
  return Array.from(body).map((tr) => tr.querySelector("td")?.textContent ?? "");
}

describe("DataTable", () => {
  it("renders real table semantics in the order given", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Items" />);
    expect(screen.getByRole("heading", { name: "Items" })).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    headers.forEach((th) => expect(th).toHaveAttribute("scope", "col"));
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("sorts descending, then ascending, then back to the original order, with empty values last", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const header = screen.getByRole("columnheader", { name: /score/i });
    const button = within(header).getByRole("button");
    expect(header).toHaveAttribute("aria-sort", "none");

    fireEvent.click(button);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]);

    fireEvent.click(button);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["Alpha", "Delta", "Bravo", "Charlie"]);

    fireEvent.click(button);
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("sorts a text column A to Z first, then Z to A", () => {
    render(<DataTable columns={COLUMNS} rows={[ROWS[3], ROWS[0], ROWS[2], ROWS[1]]} rowKey={(r) => r.id} />);
    const header = screen.getByRole("columnheader", { name: /name/i });
    const button = within(header).getByRole("button");
    fireEvent.click(button);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    fireEvent.click(button);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("does not mark unsortable columns with aria-sort", () => {
    const columns: DataTableColumn<Row>[] = [{ id: "name", header: "Name", cell: (r) => r.name }];
    render(<DataTable columns={columns} rows={ROWS} rowKey={(r) => r.id} />);
    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(header).queryByRole("button")).toBeNull();
  });

  it("paginates with a range label and prev/next", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} pageSize={3} />);
    expect(screen.getByText("Showing 1–3 of 4")).toBeInTheDocument();
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    const prev = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(prev).toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText("Showing 4–4 of 4")).toBeInTheDocument();
    expect(names()).toEqual(["Delta"]);
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("hides the pager when everything fits on one page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} pageSize={10} />);
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it("shows the empty state instead of a table", () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty="No runs yet." />);
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows skeleton rows while loading, not the empty state", () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty="No runs yet." loading loadingRows={3} />);
    expect(screen.queryByText("No runs yet.")).toBeNull();
    expect(screen.getAllByTestId("datatable-skeleton-row")).toHaveLength(3);
  });

  it("expands and collapses a detail row", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderExpanded={(r) => <p>Detail for {r.name}</p>}
        defaultExpanded={(r) => r.id === "d"}
      />,
    );
    // defaultExpanded opens Delta up front.
    expect(screen.getByText("Detail for Delta")).toBeInTheDocument();
    expect(screen.queryByText("Detail for Alpha")).toBeNull();

    const toggles = screen.getAllByRole("button", { name: /details/i });
    expect(toggles).toHaveLength(4);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggles[0]);
    expect(screen.getByText("Detail for Alpha")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /details/i })[0]).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[0]);
    expect(screen.queryByText("Detail for Alpha")).toBeNull();

    // The user's toggle overrides the default.
    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[3]);
    expect(screen.queryByText("Detail for Delta")).toBeNull();
  });

  it("leaves expansion to the page when expandedKeys is given", () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderExpanded={(r) => <p>Detail for {r.name}</p>}
        expandedKeys={new Set(["b"])}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(screen.getByText("Detail for Bravo")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[0]);
    expect(onExpandedChange).toHaveBeenCalledWith("a", true);
    // Nothing opens until the page passes the new set back.
    expect(screen.queryByText("Detail for Alpha")).toBeNull();

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderExpanded={(r) => <p>Detail for {r.name}</p>}
        expandedKeys={new Set(["a", "b"])}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(screen.getByText("Detail for Alpha")).toBeInTheDocument();
  });

  it("only offers expansion for rows that can expand", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderExpanded={(r) => <p>Detail for {r.name}</p>}
        canExpand={(r) => r.score !== null}
      />,
    );
    expect(screen.getAllByRole("button", { name: /details/i })).toHaveLength(3);
  });

  it("activates a clickable row by mouse and keyboard, but not from a control inside it", () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    const columns: DataTableColumn<Row>[] = [
      ...COLUMNS,
      { id: "act", header: "", label: "Actions", cell: (r) => <button onClick={() => onAction(r.id)}>Open {r.name}</button> },
    ];
    render(<DataTable columns={columns} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} />);

    const row = screen.getByText("Bravo").closest("tr")!;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);

    fireEvent.click(screen.getByRole("button", { name: "Open Bravo" }));
    expect(onAction).toHaveBeenCalledWith("b");
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("filters rows with the built-in text filter", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} searchText={(r) => r.name} searchPlaceholder="Filter items" />);
    const input = screen.getByPlaceholderText("Filter items");
    fireEvent.change(input, { target: { value: "ha" } });
    expect(names()).toEqual(["Alpha", "Charlie"]);
    expect(screen.getByText("2 of 4")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No rows match this filter.")).toBeInTheDocument();
  });

  it("puts a title on truncated plain-text cells and none on wrapping ones", () => {
    const columns: DataTableColumn<Row>[] = [
      { id: "name", header: "Name", cell: (r) => r.name },
      { id: "wrapped", header: "Wrapped", wrap: true, cell: (r) => `long ${r.name}` },
    ];
    render(<DataTable columns={columns} rows={ROWS.slice(0, 1)} rowKey={(r) => r.id} />);
    expect(screen.getByText("Alpha")).toHaveAttribute("title", "Alpha");
    expect(screen.getByText("long Alpha")).not.toHaveAttribute("title");
  });
});
