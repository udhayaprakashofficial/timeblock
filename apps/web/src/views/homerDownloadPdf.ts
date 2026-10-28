import { jsPDF } from 'jspdf';
import type {
  AiHomerInterviewFormat,
  AiHomerMode,
  HomerEvidenceItemDto,
} from '@timeblock/shared-types';

export type HomerPdfInput = {
  /** Person this document is about (the downloader) */
  personName: string;
  headline: string;
  summary: string;
  tip: string | null;
  achievements: string[];
  projects?: string[];
  gaps?: string[];
  evidence: HomerEvidenceItemDto[];
  from: string;
  to: string;
  taskCount: number;
  scope: 'all' | 'project';
  project: string | null;
  mode: AiHomerMode;
  format: AiHomerInterviewFormat | null;
};

const INK = '#1c1917';
const MUTED = '#57534e';
const RULE = '#e7e5e4';
const PAPER = '#fafaf9';
const ACCENT = '#ff5722';
const ACCENT_SOFT = '#fff1eb';
const BAND = '#1c1917';

function docTitle(mode: AiHomerMode): string {
  if (mode === 'appraisal') return 'Appraisal summary';
  if (mode === 'interview') return 'Interview preparation brief';
  return 'Work summary';
}

function formatLabel(format: AiHomerInterviewFormat | null): string | null {
  if (format === '30s') return '30-second pitch';
  if (format === '60s') return '60-second answer';
  if (format === 'star') return 'STAR answer';
  return null;
}

function formatMinutes(m: number): string {
  const n = Math.max(0, Math.round(m || 0));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const mins = n % 60;
  return mins ? `${h}h ${mins}m` : `${h}h`;
}

function formatPeriod(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  };
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  const left = Number.isNaN(a.getTime())
    ? from
    : a.toLocaleDateString(undefined, opts);
  const right = Number.isNaN(b.getTime())
    ? to
    : b.toLocaleDateString(undefined, opts);
  return `${left} → ${right}`;
}

function safeName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'summary'
  );
}

/**
 * Manager-ready PDF about the named person — contributions + supporting work.
 * Grounded in finished tasks only; no invented metrics.
 */
export async function downloadHomerPdf(input: HomerPdfInput): Promise<void> {
  const person =
    String(input.personName ?? '')
      .trim()
      .replace(/\s+/g, ' ') || 'Team member';
  const forManager = input.mode === 'appraisal';
  const title = docTitle(input.mode);
  const period = formatPeriod(input.from, input.to);
  const focus =
    input.scope === 'project' && input.project
      ? input.project
      : 'All completed work';

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const contentW = pageW - marginX * 2;
  const bottomSafe = pageH - 56;
  let y = 0;

  const ensureSpace = (need: number) => {
    if (y + need <= bottomSafe) return;
    doc.addPage();
    drawPageChrome(false);
    y = 72;
  };

  const drawPageChrome = (first: boolean) => {
    doc.setFillColor(PAPER);
    doc.rect(0, 0, pageW, pageH, 'F');
    if (first) {
      doc.setFillColor(BAND);
      doc.rect(0, 0, pageW, 72, 'F');
      doc.setFillColor(ACCENT);
      doc.rect(0, 72, pageW, 4, 'F');
    } else {
      doc.setFillColor(ACCENT);
      doc.rect(0, 0, pageW, 4, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(`${title} · ${person}`, marginX, 28);
    }
  };

  const sectionLabel = (label: string) => {
    ensureSpace(36);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(ACCENT);
    doc.text(label.toUpperCase(), marginX, y);
    y += 6;
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.8);
    doc.line(marginX, y, marginX + contentW, y);
    y += 16;
  };

  const bodyText = (text: string, opts?: { size?: number; color?: string }) => {
    const size = opts?.size ?? 11;
    const color = opts?.color ?? INK;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(16);
      doc.text(line, marginX, y);
      y += size + 4;
    }
  };

  const metaRow = (label: string, value: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(label, marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(value, contentW - 110) as string[];
    doc.text(lines[0] ?? value, marginX + 110, y);
    y += 14;
    for (let i = 1; i < lines.length; i++) {
      ensureSpace(14);
      doc.text(lines[i]!, marginX + 110, y);
      y += 14;
    }
  };

  const bullet = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(text, contentW - 16) as string[];
    ensureSpace(lines.length * 14 + 4);
    doc.setFillColor(ACCENT);
    doc.circle(marginX + 3, y - 3, 2.2, 'F');
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i]!, marginX + 14, y);
      y += 14;
    }
    y += 4;
  };

  drawPageChrome(true);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor('#a8a29e');
  doc.text('Homer · Cupkey', marginX, 28);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor('#ffffff');
  doc.text(title, marginX, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor('#d6d3d1');
  doc.text(period, pageW - marginX, 40, { align: 'right' });
  doc.text(`${input.taskCount} completed tasks`, pageW - marginX, 54, {
    align: 'right',
  });

  y = 104;

  // Person block — who this document is about
  doc.setFillColor(ACCENT_SOFT);
  ensureSpace(78);
  doc.roundedRect(marginX, y - 14, contentW, 70, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(ACCENT);
  doc.text(forManager ? 'PREPARED FOR REVIEW' : 'PREPARED BY', marginX + 14, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(INK);
  doc.text(person, marginX + 14, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(MUTED);
  const aboutLine = forManager
    ? `Contribution summary for ${person}, based on completed work in Cupkey.`
    : `Interview brief for ${person}, based on completed work in Cupkey.`;
  const aboutLines = doc.splitTextToSize(aboutLine, contentW - 28) as string[];
  doc.text(aboutLines[0] ?? aboutLine, marginX + 14, y + 40);
  y += 72;

  sectionLabel('Document details');
  metaRow('Name', person);
  metaRow('Period', period);
  metaRow('Focus', focus);
  if (input.mode === 'interview' && formatLabel(input.format)) {
    metaRow('Format', formatLabel(input.format)!);
  }
  y += 8;

  // Headline as theme of the period
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(INK);
  const headlineLines = doc.splitTextToSize(
    input.headline || `${person} — work summary`,
    contentW,
  ) as string[];
  for (const line of headlineLines) {
    ensureSpace(20);
    doc.text(line, marginX, y);
    y += 20;
  }
  y += 10;

  sectionLabel(forManager ? 'Summary of work' : 'Spoken answer');
  bodyText(
    forManager
      ? `The following is ${person.split(/\s+/)[0] || person}'s account of completed work in this period.`
      : `${person}'s prepared answer, grounded in finished tasks.`,
    { size: 9.5, color: MUTED },
  );
  y += 6;
  bodyText(input.summary || 'No summary available yet.', { size: 11.5 });
  y += 10;

  if (forManager && input.projects?.length) {
    sectionLabel('Key projects');
    bodyText(`Projects and themes ${person} covered in this period:`, {
      size: 9.5,
      color: MUTED,
    });
    y += 6;
    for (const p of input.projects.slice(0, 8)) {
      bullet(p);
    }
    y += 6;
  } else if (!forManager && input.achievements?.length) {
    sectionLabel('Highlights from completed work');
    bodyText(`Points ${person} can lead with:`, {
      size: 9.5,
      color: MUTED,
    });
    y += 6;
    for (const win of input.achievements.slice(0, 8)) {
      bullet(win);
    }
    y += 6;
  }

  if (input.evidence?.length) {
    sectionLabel(
      forManager ? 'Supporting work record' : 'Source activities',
    );
    bodyText(
      forManager
        ? `Completed tasks that support this summary (name, date, and logged time).`
        : `Finished tasks used to prepare this brief.`,
      { size: 9.5, color: MUTED },
    );
    y += 10;

    const rows = input.evidence.slice(0, 18);
    for (const e of rows) {
      const taskTitle = e.name || 'Task';
      const meta = [e.date, formatMinutes(e.actualMinutes), e.project || null]
        .filter(Boolean)
        .join('  ·  ');
      const titleLines = doc.splitTextToSize(taskTitle, contentW - 8) as string[];
      ensureSpace(titleLines.length * 12 + 18);

      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      doc.line(marginX, y - 8, marginX + contentW, y - 8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(INK);
      for (const line of titleLines) {
        doc.text(line, marginX, y);
        y += 12;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED);
      doc.text(meta, marginX, y);
      y += 16;
    }
    if (input.evidence.length > rows.length) {
      bodyText(
        `+ ${input.evidence.length - rows.length} additional completed tasks on record`,
        { size: 9, color: MUTED },
      );
    }
  }

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.6);
    doc.line(marginX, pageH - 36, marginX + contentW, pageH - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(
      `${person}  ·  Cupkey Homer  ·  Based on logged work only`,
      marginX,
      pageH - 22,
    );
    doc.text(`${i} / ${pages}`, pageW - marginX, pageH - 22, {
      align: 'right',
    });
  }

  const file = `${safeName(person)}-${safeName(title)}-${input.from}_${input.to}.pdf`;
  doc.save(file);
}
