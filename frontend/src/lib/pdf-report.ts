import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { LiveRunStatus, RepoAnalysisResult, RunSummaryItem } from "./api";
import { BRAND_NAME } from "./brand";

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  dark:   [15,  15,  20]  as [number, number, number],
  accent: [99,  102, 241] as [number, number, number],
  white:  [255, 255, 255] as [number, number, number],
  gray:   [130, 130, 145] as [number, number, number],
  green:  [74,  222, 128] as [number, number, number],
  red:    [248, 113, 113] as [number, number, number],
  yellow: [250, 204, 21]  as [number, number, number],
  altRow: [248, 248, 252] as [number, number, number],
  cardBg: [30,  30,  40]  as [number, number, number],
  text:   [35,  35,  50]  as [number, number, number],
};

type DocWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } };

function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  meta: string[],
  pageW: number,
) {
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, pageW, 54, "F");

  // Accent bar on left edge
  doc.setFillColor(...C.accent);
  doc.rect(0, 0, 3, 54, "F");

  doc.setTextColor(...C.white);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(title, 16, 20);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.gray);
  doc.text(subtitle, 16, 29);

  meta.forEach((line, i) => {
    doc.text(line, 16, 37 + i * 7);
  });
}

function drawStatCards(
  doc: jsPDF,
  cards: { label: string; value: string; color: [number, number, number] }[],
  startY: number,
  pageW: number,
): number {
  const gap = 4;
  const cardW = (pageW - 28 - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + gap);
    doc.setFillColor(...C.cardBg);
    doc.roundedRect(x, startY, cardW, 22, 2, 2, "F");

    doc.setTextColor(...card.color);
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.text(card.value, x + cardW / 2, startY + 12, { align: "center" });

    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.gray);
    doc.text(card.label, x + cardW / 2, startY + 19, { align: "center" });
  });
  return startY + 28;
}

function drawSectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.text);
  doc.text(text, 14, y);
  return y + 6;
}

function addFooters(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.dark);
    doc.rect(0, pageH - 12, pageW, 12, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.gray);
    doc.text(BRAND_NAME, 14, pageH - 4.5);
    doc.text(`Page ${i} of ${pageCount}`, pageW - 14, pageH - 4.5, { align: "right" });
  }
}

// ── Full live-run report ───────────────────────────────────────────────────────
export function downloadLiveTestReport(
  runStatus: LiveRunStatus,
  analysis?: RepoAnalysisResult | null,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date();

  const total = runStatus.total;
  const passed = runStatus.passed;
  const failed = runStatus.failed;
  const successRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  let durationSec: string | null = null;
  if (runStatus.started_at && runStatus.completed_at) {
    const ms =
      new Date(runStatus.completed_at).getTime() -
      new Date(runStatus.started_at).getTime();
    durationSec = (ms / 1000).toFixed(1) + "s";
  }

  // Header
  const meta = [
    `Run ID: ${runStatus.run_id}`,
    `Generated: ${now.toLocaleString()}`,
  ];
  if (analysis) {
    // Guard the nested arrays, not just the object: a partially-populated
    // analysis (e.g. from the spec-upload flow) has no pages/tests, and
    // `analysis.pages.length` then throws inside the click handler.
    const pageCount = analysis.pages?.length ?? 0;
    const testCount = analysis.tests?.length ?? 0;
    meta.push(`Tech Stack: ${analysis.tech_stack ?? "unknown"}  |  Pages: ${pageCount}  |  Tests: ${testCount}`);
  }
  drawHeader(doc, "AI Test Execution Report", "Live Playwright Test Run", meta, pageW);

  let y = 62;

  // Stat cards
  const statusColor =
    successRate >= 80 ? C.green : successRate >= 50 ? C.yellow : C.red;
  const cards = [
    { label: "Total Tests", value: String(total), color: C.white },
    { label: "Passed", value: String(passed), color: C.green },
    { label: "Failed", value: String(failed), color: C.red },
    { label: "Success Rate", value: `${successRate}%`, color: statusColor },
    ...(durationSec
      ? [{ label: "Duration", value: durationSec, color: C.white }]
      : []),
  ];
  y = drawStatCards(doc, cards, y, pageW);

  // Analysis summary box
  if (analysis?.summary) {
    doc.setFillColor(240, 242, 255);
    const summaryLines = doc.splitTextToSize(analysis.summary, pageW - 32);
    const boxH = summaryLines.length * 5 + 10;
    doc.roundedRect(14, y, pageW - 28, boxH, 2, 2, "F");
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 90);
    summaryLines.forEach((line: string, i: number) => {
      doc.text(line, 18, y + 8 + i * 5);
    });
    y += boxH + 6;
  }

  // Run metadata row
  if (runStatus.started_at) {
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(`Started: ${new Date(runStatus.started_at).toLocaleString()}`, 14, y);
    if (runStatus.completed_at) {
      doc.text(
        `Completed: ${new Date(runStatus.completed_at).toLocaleString()}`,
        pageW / 2,
        y,
      );
    }
    y += 7;
  }

  // Test results table
  const results = runStatus.results ?? [];
  y = drawSectionTitle(doc, `Test Results  (${results.length})`, y);

  autoTable(doc, {
    startY: y,
    head: [["#", "Test Name", "Status", "Duration", "Steps", "Error / Notes"]],
    body: results.map((r, i) => [
      String(i + 1),
      r.test_name,
      r.status.charAt(0).toUpperCase() + r.status.slice(1),
      r.duration_ms != null ? (r.duration_ms / 1000).toFixed(2) + "s" : "—",
      `${r.steps_completed} / ${r.total_steps}`,
      r.error ? r.error.slice(0, 80) + (r.error.length > 80 ? "…" : "") : "—",
    ]),
    theme: "grid",
    headStyles: {
      fillColor: C.accent,
      textColor: C.white,
      fontSize: 8.5,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 8, textColor: C.text },
    columnStyles: {
      0: { cellWidth: 8,  halign: "center" },
      2: { cellWidth: 20, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        const v = (data.cell.raw as string).toLowerCase();
        if (v === "passed") data.cell.styles.textColor = C.green;
        else if (v === "failed") data.cell.styles.textColor = C.red;
      }
    },
    alternateRowStyles: { fillColor: C.altRow },
    margin: { left: 14, right: 14 },
  });

  // Failed test detail section (if any)
  const failed_results = results.filter((r) => r.status === "failed" && r.error);
  if (failed_results.length > 0) {
    const finalY = (doc as DocWithAutoTable).lastAutoTable.finalY + 8;
    doc.addPage();
    let fy = 16;
    fy = drawSectionTitle(doc, "Failed Test Details", fy);

    failed_results.forEach((r) => {
      // Check if we need a new page
      if (fy > 260) {
        doc.addPage();
        fy = 16;
      }

      doc.setFillColor(255, 240, 240);
      const errText = r.error ?? "Unknown error";
      const lines = doc.splitTextToSize(errText, pageW - 40);
      const boxH = lines.length * 5 + 16;
      doc.roundedRect(14, fy, pageW - 28, boxH, 2, 2, "F");

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.red);
      doc.text(r.test_name, 18, fy + 8);

      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 40, 40);
      lines.forEach((line: string, i: number) => {
        doc.text(line, 18, fy + 14 + i * 5);
      });
      fy += boxH + 5;
      void finalY; // suppress unused variable
    });
  }

  addFooters(doc);

  const filename = `test-report-${runStatus.run_id.slice(0, 8)}-${now.toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}

// ── Historical run report (RunSummaryItem) ────────────────────────────────────
export function downloadRunSummaryReport(run: RunSummaryItem) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date();

  const rate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  let durationSec: string | null = null;
  if (run.started_at && run.completed_at) {
    const ms =
      new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
    durationSec = (ms / 1000).toFixed(1) + "s";
  }

  const meta = [`Run ID: ${run.run_id}`, `Generated: ${now.toLocaleString()}`];
  if (run.started_at)
    meta.push(`Started: ${new Date(run.started_at).toLocaleString()}`);

  drawHeader(doc, "Test Run Report", "Saved Test Run", meta, pageW);

  let y = 62;

  const rateColor = rate >= 80 ? C.green : rate >= 50 ? C.yellow : C.red;
  const cards = [
    { label: "Total Tests", value: String(run.total), color: C.white },
    { label: "Passed", value: String(run.passed), color: C.green },
    { label: "Failed", value: String(run.failed), color: C.red },
    { label: "Success Rate", value: `${rate}%`, color: rateColor },
    ...(durationSec
      ? [{ label: "Duration", value: durationSec, color: C.white }]
      : []),
  ];
  y = drawStatCards(doc, cards, y, pageW);

  if (run.results && run.results.length > 0) {
    y = drawSectionTitle(doc, `Test Results  (${run.results.length})`, y);

    autoTable(doc, {
      startY: y,
      head: [["#", "Test Name", "Status", "Duration"]],
      body: run.results.map((r, i) => [
        String(i + 1),
        r.test_name,
        r.status.charAt(0).toUpperCase() + r.status.slice(1),
        r.duration_ms != null ? (r.duration_ms / 1000).toFixed(2) + "s" : "—",
      ]),
      theme: "grid",
      headStyles: {
        fillColor: C.accent,
        textColor: C.white,
        fontSize: 9,
        fontStyle: "bold",
      },
      bodyStyles: { fontSize: 9, textColor: C.text },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        2: { cellWidth: 26, halign: "center" },
        3: { cellWidth: 24, halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const v = (data.cell.raw as string).toLowerCase();
          if (v === "passed") data.cell.styles.textColor = C.green;
          else if (v === "failed") data.cell.styles.textColor = C.red;
        }
      },
      alternateRowStyles: { fillColor: C.altRow },
      margin: { left: 14, right: 14 },
    });
  } else {
    doc.setFontSize(9);
    doc.setTextColor(...C.gray);
    doc.text("No detailed results available for this run.", 14, y + 8);
  }

  addFooters(doc);

  const filename = `run-report-${run.run_id.slice(0, 8)}-${now.toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}
