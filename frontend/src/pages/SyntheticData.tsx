import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Link } from "react-router-dom";
import { FileIcon } from "@/components/FileIcon";
import { Download, Loader2 } from "lucide-react";
import { useSyntheticDatasets, useGenerateSyntheticData } from "@/hooks/use-synthetic-data";
import { useRequirements } from "@/hooks/use-requirements";
import { type SyntheticDataset } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { Panel } from "@/components/imcc/Panel";
import { cn } from "@/lib/utils";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined) return "—";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "float" && typeof value === "number") return value.toFixed(2);
  if (type === "datetime" && typeof value === "string") {
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }
  return String(value);
}

type DataRow = { index: number; values: SyntheticDataset["rows"][number] };

const NUMERIC_TYPES = new Set(["integer", "int", "float", "number", "decimal"]);

function sortableValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function rowColumns(dataset: SyntheticDataset): DataTableColumn<DataRow>[] {
  return [
    {
      id: "#",
      header: "#",
      align: "right",
      width: "w-14",
      cell: (r) => <span className="text-xs text-ink-quaternary">{r.index + 1}</span>,
      sortValue: (r) => r.index,
    },
    ...dataset.schema_fields.map(
      (field): DataTableColumn<DataRow> => ({
        id: `field:${field.name}`,
        header: field.name,
        mono: true,
        align: NUMERIC_TYPES.has(field.type) ? "right" : "left",
        cell: (r) => formatCell(r.values[field.name], field.type),
        sortValue: (r) => sortableValue(r.values[field.name]),
      }),
    ),
  ];
}

// ── export (client-side only; uses the rows already loaded) ──────────────────

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(dataset: SyntheticDataset): string {
  const names = dataset.schema_fields.map((f) => f.name);
  const lines = [names.map(csvCell).join(",")];
  for (const row of dataset.rows) lines.push(names.map((n) => csvCell(row[n])).join(","));
  return lines.join("\r\n");
}

function downloadFile(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── main component ────────────────────────────────────────────────────────────

const SyntheticData = () => {
  const [selectedReqId, setSelectedReqId] = useState("");
  const [countText, setCountText] = useState("20");
  // Typed freely; clamped to the allowed range only when used or when the field is left.
  const count = Math.min(100, Math.max(5, Math.round(Number(countText)) || 20));
  const [activeDataset, setActiveDataset] = useState<SyntheticDataset | null>(null);

  const { data: requirements = [], isLoading: reqLoading } = useRequirements();
  const { data: datasets = [], isLoading: dsLoading } = useSyntheticDatasets(10);
  const generateMutation = useGenerateSyntheticData();

  const handleGenerate = () => {
    if (!selectedReqId) return;
    setCountText(String(count));
    generateMutation.mutate(
      { requirement_id: selectedReqId, count },
      {
        onSuccess: (newDataset) => {
          setActiveDataset(newDataset);
        },
      }
    );
  };

  const displayDataset = activeDataset ?? (datasets.length > 0 ? datasets[0] : null);

  return (
    <PageShell>
      <PageHeader
        title="Test Data"
        description="Generates a field schema and sample rows for a requirement using the configured model. The rows are invented test data, not records from any system."
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="synth-requirement" className={fieldLabel}>
              Requirement
            </label>
            <select
              id="synth-requirement"
              value={selectedReqId}
              onChange={(e) => setSelectedReqId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
            >
              <option value="">{reqLoading ? "Loading requirements…" : "Select a requirement"}</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text.slice(0, 90)}{r.text.length > 90 ? "…" : ""}
                </option>
              ))}
            </select>
            {!reqLoading && requirements.length === 0 && (
              <p className="mt-1.5 text-xs text-ink-tertiary">
                No requirements yet.{" "}
                <Link to="/requirements" className="font-medium text-ink underline underline-offset-2">
                  Submit one
                </Link>{" "}
                to generate data for it.
              </p>
            )}
          </div>

          <div className="w-28">
            <label htmlFor="synth-rows" className={fieldLabel}>
              Rows <span className="font-normal text-ink-quaternary">(5–100)</span>
            </label>
            <Input
              id="synth-rows"
              type="number"
              min={5}
              max={100}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              onBlur={() => setCountText(String(count))}
              className="tabular-nums"
            />
          </div>

          <Button onClick={handleGenerate} disabled={!selectedReqId || generateMutation.isPending} className="gap-2">
            {generateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {generateMutation.isPending ? "Generating" : "Generate"}
          </Button>
        </div>

        {generateMutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {(generateMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
              ?? (generateMutation.error as Error)?.message
              ?? "Generation failed. Check the backend logs."}
          </p>
        )}
      </Panel>

      {datasets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(eyebrow, "mr-1")}>Datasets</span>
          {datasets.map((ds, i) => (
            <button
              key={ds.id}
              type="button"
              onClick={() => setActiveDataset(ds)}
              aria-pressed={displayDataset?.id === ds.id}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                displayDataset?.id === ds.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-ink-secondary hover:bg-raised",
              )}
            >
              #{i + 1} · {ds.requirement_text.slice(0, 40)}{ds.requirement_text.length > 40 ? "…" : ""}{" "}
              <span className="ml-1 tabular-nums opacity-70">{ds.count} rows</span>
            </button>
          ))}
        </div>
      )}

      {dsLoading && (
        <Panel>
          <EmptyState kind="loading">Loading datasets…</EmptyState>
        </Panel>
      )}

      {!dsLoading && !displayDataset && !generateMutation.isPending && (
        <Panel>
          <EmptyState kind="noRequirements">
            No datasets yet. Select a requirement above and generate one.
          </EmptyState>
        </Panel>
      )}

      {generateMutation.isPending && (
        <Panel>
          <EmptyState kind="loading">Generating the schema and rows…</EmptyState>
        </Panel>
      )}

      {displayDataset && !generateMutation.isPending && (
        <>
          <Panel padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-stroke-muted px-4 py-3">
              <h2 className={eyebrow}>Schema</h2>
              <span className="text-xs tabular-nums text-ink-tertiary">{displayDataset.schema_fields.length} fields</span>
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              {displayDataset.schema_fields.map((f) => (
                <span
                  key={f.name}
                  title={f.description}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-xs text-ink-secondary"
                >
                  {f.name}
                  <span className="text-ink-quaternary">{f.type}</span>
                </span>
              ))}
            </div>
          </Panel>

          <DataTable
            caption="Rows"
            columns={rowColumns(displayDataset)}
            rows={displayDataset.rows.map((values, index) => ({ index, values }))}
            rowKey={(r) => String(r.index)}
            searchText={(r) => Object.values(r.values).map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" ")}
            searchPlaceholder="Filter rows"
            pageSize={25}
            empty="This dataset has no rows."
            toolbar={
              <>
                <span className="text-xs tabular-nums text-ink-tertiary">
                  {displayDataset.rows.length} rows · {new Date(displayDataset.generated_at).toLocaleString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    downloadFile(`synthetic-data-${displayDataset.id}.csv`, toCsv(displayDataset), "text/csv;charset=utf-8")
                  }
                >
                  <FileIcon name="data.csv" size={16} />
                  Download CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    downloadFile(
                      `synthetic-data-${displayDataset.id}.json`,
                      JSON.stringify(displayDataset.rows, null, 2),
                      "application/json",
                    )
                  }
                >
                  <FileIcon name="data.json" size={16} />
                  Download JSON
                </Button>
              </>
            }
          />
        </>
      )}
    </PageShell>
  );
};

export default SyntheticData;
