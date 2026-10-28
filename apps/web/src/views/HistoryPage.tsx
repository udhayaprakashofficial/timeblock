'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiCareerSummaryDto,
  AiCareerSummaryScope,
  AiHomerInterviewFormat,
  AiHomerRefineAction,
  AiHomerSavePolicy,
  HomerEvidenceItemDto,
  StoredHomerGenerationDto,
  StoredHomerGenerationsDto,
  WorkHistoryDto,
  WorkHistoryItemDto,
} from '@timeblock/shared-types';
import { HOMER_MIN_TASK_NOTES } from '@timeblock/shared-types';
import { api, shiftDateISO, todayISO } from '../api';
import { HintMark } from '../components/ui-hints';
import { refreshAiCreditsBadge } from '../components/ai/AiCreditsBadge';
import { useAppUserOptional } from '../user-context';
import { downloadHomerPdf } from './homerDownloadPdf';

function formatMinutes(m: number): string {
  const n = Math.max(0, Math.round(m || 0));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const mins = n % 60;
  return mins ? `${h}h ${mins}m` : `${h}h`;
}

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type CareerDraft = {
  notes: string;
  careerProject: string;
  careerResponsibility: string;
  careerAchievement: string;
  careerContribution: string;
  careerOutcome: string;
};

function taskHasNotes(item: WorkHistoryItemDto): boolean {
  return Boolean(
    item.notes?.trim() ||
      item.careerResponsibility?.trim() ||
      item.careerAchievement?.trim() ||
      item.careerContribution?.trim() ||
      item.careerOutcome?.trim(),
  );
}

type HomerFeature = 'notes' | 'appraisal' | 'interview';

const HOMER_FEATURES: {
  id: HomerFeature;
  label: string;
  lede: string;
  title: string;
  placeholder: string;
  days: number;
}[] = [
  {
    id: 'appraisal',
    label: 'Appraisal prep',
    lede: 'A manager-ready summary of the projects you worked on — grounded in your task notes.',
    title: 'Appraisal prep',
    placeholder:
      'Generate a narrative summary of key projects from finished tasks in this range.',
    days: 90,
  },
  {
    id: 'interview',
    label: 'Interview pitch',
    lede: 'A spoken answer built from what you actually shipped.',
    title: 'Interview pitch',
    placeholder: 'Generate a pitch from finished tasks in this range.',
    days: 90,
  },
  {
    id: 'notes',
    label: 'Work notes',
    lede: 'Add notes on finished tasks — especially ones you spent the most time on. Homer needs 20 noted tasks to unlock.',
    title: 'Work notes',
    placeholder: '',
    days: 90,
  },
];

function parseFeature(raw: string | null): HomerFeature {
  if (raw === 'notes' || raw === 'interview') return raw;
  return 'appraisal';
}

function draftFromItem(item: WorkHistoryItemDto): CareerDraft {
  return {
    notes: item.notes ?? '',
    careerProject: item.careerProject ?? '',
    careerResponsibility: item.careerResponsibility ?? '',
    careerAchievement: item.careerAchievement ?? '',
    careerContribution: item.careerContribution ?? '',
    careerOutcome: item.careerOutcome ?? '',
  };
}

function hasCareerDetails(item: WorkHistoryItemDto): boolean {
  return taskHasNotes(item) || Boolean(item.careerProject?.trim());
}

type HomerWriteUp = Pick<
  AiCareerSummaryDto,
  | 'headline'
  | 'summary'
  | 'tip'
  | 'responsibilities'
  | 'projects'
  | 'achievements'
  | 'from'
  | 'to'
  | 'taskCount'
  | 'scope'
  | 'project'
  | 'mode'
  | 'format'
  | 'gaps'
  | 'evidence'
  | 'duplicateOfId'
  | 'version'
> & { id?: string | null; createdAt?: string | null };

function HomerProgressStrip({
  noted,
  min,
  ready,
}: {
  noted: number;
  min: number;
  ready: boolean;
}) {
  const pct = Math.min(100, Math.round((noted / Math.max(1, min)) * 100));
  return (
    <div
      className={`homer-progress${ready ? ' is-ready' : ''}`}
      aria-live="polite"
    >
      <div className="homer-progress-top">
        <span className="homer-progress-label">
          {ready ? 'Ready to generate' : 'Unlock Homer'}
        </span>
        <span className="homer-progress-count">
          {noted}
          <em>/{min}</em>
        </span>
      </div>
      <div
        className="homer-progress-bar"
        role="progressbar"
        aria-valuenow={noted}
        aria-valuemin={0}
        aria-valuemax={min}
        aria-label={`${noted} of ${min} finished tasks with notes`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="homer-progress-hint">
        {ready
          ? `${noted} finished tasks have notes — generate anytime.`
          : `Add notes on ${Math.max(0, min - noted)} more finished task${
              min - noted === 1 ? '' : 's'
            } to unlock appraisal and interview.`}
      </p>
    </div>
  );
}

function HomerKeyTasksList({
  tasks,
  onOpen,
  onOpenAll,
  mode,
}: {
  tasks: WorkHistoryItemDto[];
  onOpen: (id: string) => void;
  onOpenAll: () => void;
  mode: 'locked' | 'boost';
}) {
  if (!tasks.length) return null;
  return (
    <div
      className={`homer-key-tasks${mode === 'boost' ? ' is-boost' : ''}`}
      role="region"
      aria-label={
        mode === 'locked'
          ? 'Tasks that need notes to unlock Homer'
          : 'Tasks that still need notes'
      }
    >
      <header className="homer-key-tasks-head">
        <div>
          <h3>
            {mode === 'locked'
              ? 'Start with your heaviest work'
              : 'Still missing notes'}
          </h3>
          <p>
            {mode === 'locked'
              ? 'Tap a task, add what you did, then come back to generate.'
              : 'A few more notes make the summary sharper.'}
          </p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onOpenAll}>
          Work notes
        </button>
      </header>
      <ul className="homer-key-tasks-list">
        {tasks.map((t, i) => (
          <li key={t.id}>
            <button
              type="button"
              className="homer-key-task"
              onClick={() => onOpen(t.id)}
            >
              <span className="homer-key-task-rank" aria-hidden>
                {i + 1}
              </span>
              <span className="homer-key-task-body">
                <strong>{t.name}</strong>
                <em>
                  {formatDay(t.date)}
                  {t.careerProject ? ` · ${t.careerProject}` : ''}
                </em>
              </span>
              <span className="homer-key-task-meta">
                <span className="homer-key-task-time">
                  {formatMinutes(t.actualMinutes)}
                </span>
                <span className="homer-key-task-cta">Add notes</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const INTERVIEW_FORMATS: {
  id: AiHomerInterviewFormat;
  label: string;
}[] = [
  { id: '30s', label: '30s pitch' },
  { id: '60s', label: '60s answer' },
  { id: 'star', label: 'STAR' },
];

const REFINE_ACTIONS: { id: AiHomerRefineAction; label: string }[] = [
  { id: 'regenerate', label: 'Regenerate' },
  { id: 'concise', label: 'Make concise' },
  { id: 'evidence', label: 'Add supporting evidence' },
  { id: 'natural', label: 'Make more natural' },
  { id: 'professional', label: 'Change tone' },
];

function writeUpToText(s: HomerWriteUp): string {
  const lines = [s.headline, '', s.summary, ''];
  if (s.tip) lines.push(`Tip: ${s.tip}`, '');
  if (s.projects?.length) {
    lines.push('Key projects', ...s.projects.map((x) => `• ${x}`), '');
  }
  if (s.achievements?.length && s.mode !== 'appraisal') {
    lines.push('Wins', ...s.achievements.map((x) => `• ${x}`), '');
  }
  if (s.gaps?.length) {
    lines.push('Gaps', ...s.gaps.map((x) => `• ${x}`), '');
  }
  if (s.evidence?.length) {
    lines.push(
      'Evidence',
      ...s.evidence.map(
        (e) =>
          `• ${e.date}: ${e.name} (${e.actualMinutes}m${
            e.project ? ` · ${e.project}` : ''
          })`,
      ),
      '',
    );
  }
  lines.push(`Period: ${s.from} → ${s.to} · ${s.taskCount} finished tasks`);
  return lines.join('\n');
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function storedToWriteUp(g: StoredHomerGenerationDto): HomerWriteUp {
  return {
    ...g,
    format: g.format ?? null,
    gaps: g.gaps ?? [],
    evidence: g.evidence ?? [],
    duplicateOfId: null,
    version: g.version ?? 1,
  };
}

type RangePreset = '7' | '30' | '90' | '365' | '1825';

const RANGE_PRESETS: { days: RangePreset; label: string }[] = [
  { days: '7', label: '7d' },
  { days: '30', label: '30d' },
  { days: '90', label: '90d' },
  { days: '365', label: '1y' },
  { days: '1825', label: 'All' },
];

export function HistoryPage({ timeZone }: { timeZone?: string | null }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAppUserOptional();
  const feature = parseFeature(searchParams.get('f'));
  const today = todayISO(timeZone);
  const [from, setFrom] = useState(() => shiftDateISO(today, -90));
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q.trim());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CareerDraft | null>(null);
  const [summary, setSummary] = useState<HomerWriteUp | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [summaryScope, setSummaryScope] =
    useState<AiCareerSummaryScope>('all');
  const [summaryProject, setSummaryProject] = useState('');
  const [interviewFormat, setInterviewFormat] =
    useState<AiHomerInterviewFormat>('60s');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [pendingDup, setPendingDup] = useState<HomerWriteUp | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const active =
    HOMER_FEATURES.find((f) => f.id === feature) ?? HOMER_FEATURES[0]!;
  const coachMode =
    feature === 'appraisal' || feature === 'interview' ? feature : null;

  useEffect(() => {
    setSummary(null);
    setSummaryErr(null);
    setCopiedId(null);
    setPendingDup(null);
    setEvidenceOpen(false);
    setTo(today);
    setFrom(shiftDateISO(today, -active.days));
  }, [feature, active.days, today]);

  const selectFeature = (next: HomerFeature) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'appraisal') params.delete('f');
    else params.set('f', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const history = useQuery({
    queryKey: ['work-history', from, to, deferredQ],
    queryFn: () => {
      const params = new URLSearchParams({ from, to });
      if (deferredQ) params.set('q', deferredQ);
      return api.get<WorkHistoryDto>(`/api/tasks/history?${params}`);
    },
  });

  const savedGens = useQuery({
    queryKey: ['homer-generations', coachMode],
    enabled: Boolean(coachMode),
    queryFn: () =>
      api.get<StoredHomerGenerationsDto>(
        `/api/ai/homer-generations?mode=${coachMode}`,
      ),
  });

  const savedItems = savedGens.data?.items ?? [];
  const items = history.data?.items ?? [];
  /** False only after we know the user is on Free (Pro gets full searchable archive). */
  const historyIsPro = history.data?.hasAccess !== false;
  const historyGateNote =
    history.data?.hasAccess === false ? history.data.reason : null;

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    if (selectedId && items.some((i) => i.id === selectedId)) return;
    setSelectedId(items[0]!.id);
  }, [items, selectedId]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setDraft(selected ? draftFromItem(selected) : null);
    setJustSaved(false);
  }, [selected?.id]);

  const groups = useMemo(() => {
    const byDate = new Map<string, WorkHistoryItemDto[]>();
    for (const item of items) {
      const list = byDate.get(item.date) ?? [];
      list.push(item);
      byDate.set(item.date, list);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const enrichedCount = useMemo(
    () => items.filter(hasCareerDetails).length,
    [items],
  );

  const notedTaskCount =
    history.data?.notedTaskCount ?? items.filter(taskHasNotes).length;
  const homerMinNotes = history.data?.homerMinNotes ?? HOMER_MIN_TASK_NOTES;
  const homerReady =
    history.data?.homerReady ?? notedTaskCount >= homerMinNotes;

  /** Heaviest finished tasks still missing notes — prompt the user. */
  const keyTasksNeedingNotes = useMemo(() => {
    return [...items]
      .filter((t) => !taskHasNotes(t))
      .sort((a, b) => (b.actualMinutes || 0) - (a.actualMinutes || 0))
      .slice(0, 5);
  }, [items]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const p = item.careerProject?.trim();
      if (p) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  useEffect(() => {
    if (!projectOptions.length) {
      if (summaryScope === 'project') setSummaryScope('all');
      setSummaryProject('');
      return;
    }
    if (
      summaryProject &&
      !projectOptions.some(
        (p) => p.toLowerCase() === summaryProject.toLowerCase(),
      )
    ) {
      setSummaryProject(projectOptions[0]!);
    } else if (!summaryProject) {
      setSummaryProject(projectOptions[0]!);
    }
  }, [projectOptions, summaryProject, summaryScope]);

  const scopedItems = useMemo(() => {
    if (summaryScope !== 'project' || !summaryProject.trim()) return items;
    const needle = summaryProject.trim().toLowerCase();
    return items.filter((t) => {
      const p = (t.careerProject ?? '').trim().toLowerCase();
      const name = (t.name ?? '').toLowerCase();
      return p === needle || name.includes(needle);
    });
  }, [items, summaryScope, summaryProject]);

  const scopedCount = scopedItems.length;

  const applyPreset = (days: RangePreset) => {
    setTo(today);
    setFrom(shiftDateISO(today, -Number(days)));
    setSummary(null);
    setSummaryErr(null);
    setPendingDup(null);
  };

  const setRangeFrom = (value: string) => {
    const next = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    setFrom(next > to ? to : next);
    setSummary(null);
    setPendingDup(null);
  };

  const setRangeTo = (value: string) => {
    const next = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    const capped = next > today ? today : next;
    setTo(capped < from ? from : capped);
    setSummary(null);
    setPendingDup(null);
  };

  const saveCareer = useMutation({
    mutationFn: (payload: { id: string } & CareerDraft) =>
      api.patch(`/api/tasks/${payload.id}`, {
        notes: payload.notes || null,
        careerProject: payload.careerProject || null,
        careerResponsibility: payload.careerResponsibility || null,
        careerAchievement: payload.careerAchievement || null,
        careerContribution: payload.careerContribution || null,
        careerOutcome: payload.careerOutcome || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['work-history'] });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1600);
    },
  });

  type GenOpts = {
    refine?: AiHomerRefineAction;
    savePolicy?: AiHomerSavePolicy;
    replaceId?: string;
    base?: HomerWriteUp | null;
  };

  const generateSummary = useMutation({
    mutationFn: (opts: GenOpts = {}) => {
      if (!coachMode) {
        return Promise.reject(new Error('Pick a Homer feature to generate.'));
      }
      if (!homerReady) {
        return Promise.reject(
          new Error(
            `Homer unlocks after notes on ${homerMinNotes} finished tasks (${notedTaskCount} so far). Add notes on your heaviest tasks first.`,
          ),
        );
      }
      if (summaryScope === 'project' && !summaryProject.trim()) {
        return Promise.reject(
          new Error('Pick a project or product, or choose All.'),
        );
      }
      if (from > to) {
        return Promise.reject(new Error('From date must be on or before To.'));
      }
      const base = opts.base ?? summary;
      return api.post<AiCareerSummaryDto>('/api/ai/career-summary', {
        from,
        to,
        q: deferredQ || undefined,
        scope: summaryScope,
        project:
          summaryScope === 'project' ? summaryProject.trim() : undefined,
        mode: coachMode,
        format: coachMode === 'interview' ? interviewFormat : undefined,
        refine: opts.refine,
        baseSummary: opts.refine ? base?.summary : undefined,
        baseHeadline: opts.refine ? base?.headline : undefined,
        savePolicy: opts.savePolicy,
        replaceId: opts.replaceId,
      });
    },
    onSuccess: (result) => {
      setSummaryErr(null);
      refreshAiCreditsBadge();
      if (result.duplicateOfId && !result.id) {
        setPendingDup(result);
        setSummary(result);
        return;
      }
      setPendingDup(null);
      setSummary(result);
      setEvidenceOpen(Boolean(result.evidence?.length));
      void qc.invalidateQueries({ queryKey: ['homer-generations'] });
    },
    onError: (e) => {
      setSummaryErr(
        e instanceof Error ? e.message : 'Could not generate that.',
      );
    },
  });

  const deleteSaved = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true }>(`/api/ai/homer-generations/${id}`),
    onSuccess: (_data, id) => {
      if (summary?.id === id) setSummary(null);
      void qc.invalidateQueries({ queryKey: ['homer-generations'] });
    },
  });

  const persistDraft = useMutation({
    mutationFn: (opts: {
      savePolicy: AiHomerSavePolicy;
      replaceId?: string;
      draft: HomerWriteUp;
    }) => {
      const d = opts.draft;
      return api.post<AiCareerSummaryDto>('/api/ai/homer-generations', {
        savePolicy: opts.savePolicy,
        replaceId: opts.replaceId,
        draft: {
          from: d.from,
          to: d.to,
          query: deferredQ || '',
          scope: d.scope,
          project: d.project,
          mode: d.mode === 'appraisal' || d.mode === 'interview' ? d.mode : coachMode,
          format: d.format,
          headline: d.headline,
          summary: d.summary,
          responsibilities: d.responsibilities ?? [],
          projects: d.projects ?? [],
          achievements: d.achievements ?? [],
          tip: d.tip,
          gaps: d.gaps ?? [],
          evidence: d.evidence ?? [],
          taskCount: d.taskCount,
        },
      });
    },
    onSuccess: (result) => {
      setSummaryErr(null);
      setPendingDup(null);
      setSummary(result);
      setEvidenceOpen(Boolean(result.evidence?.length));
      void qc.invalidateQueries({ queryKey: ['homer-generations'] });
    },
    onError: (e) => {
      setSummaryErr(
        e instanceof Error ? e.message : 'Could not save that story.',
      );
    },
  });

  const confirmDelete = (id: string, title: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete “${title}”? This cannot be undone.`)
    ) {
      return;
    }
    deleteSaved.mutate(id);
  };

  const busy =
    generateSummary.isPending ||
    persistDraft.isPending ||
    deleteSaved.isPending;

  const runGenerate = (opts?: GenOpts) => {
    if (busy) return;
    generateSummary.mutate(opts ?? {});
  };

  const resolveDuplicate = (policy: AiHomerSavePolicy) => {
    if (!pendingDup || busy) return;
    persistDraft.mutate({
      savePolicy: policy,
      replaceId:
        policy === 'replace'
          ? pendingDup.duplicateOfId ?? undefined
          : undefined,
      draft: pendingDup,
    });
  };

  const copyWriteUp = async (writeUp: HomerWriteUp, key: string) => {
    try {
      await navigator.clipboard.writeText(writeUpToText(writeUp));
      setCopiedId(key);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setSummaryErr('Could not copy — try download instead.');
    }
  };

  const downloadWriteUp = async (writeUp: HomerWriteUp, key: string) => {
    if (pdfBusyId) return;
    setPdfBusyId(key);
    setSummaryErr(null);
    try {
      await downloadHomerPdf({
        personName: user?.name?.trim() || 'Team member',
        headline: writeUp.headline,
        summary: writeUp.summary,
        tip: writeUp.tip,
        achievements: writeUp.achievements ?? [],
        projects: writeUp.projects ?? [],
        gaps: writeUp.gaps ?? [],
        evidence: writeUp.evidence ?? [],
        from: writeUp.from,
        to: writeUp.to,
        taskCount: writeUp.taskCount,
        scope: writeUp.scope,
        project: writeUp.project,
        mode: writeUp.mode,
        format: writeUp.format,
      });
    } catch {
      setSummaryErr('Could not build the PDF — try again.');
    } finally {
      setPdfBusyId(null);
    }
  };

  const dirty =
    selected &&
    draft &&
    (draft.notes !== (selected.notes ?? '') ||
      draft.careerProject !== (selected.careerProject ?? '') ||
      draft.careerResponsibility !== (selected.careerResponsibility ?? '') ||
      draft.careerAchievement !== (selected.careerAchievement ?? '') ||
      draft.careerContribution !== (selected.careerContribution ?? '') ||
      draft.careerOutcome !== (selected.careerOutcome ?? ''));

  const openNotesForTask = (taskId: string) => {
    setSelectedId(taskId);
    selectFeature('notes');
  };

  const showNotes = feature === 'notes';
  const showCoach = feature !== 'notes';

  return (
    <div className="career-page">
      <header className="career-head">
        <div className="homer-brand">
          <img
            className="homer-bust"
            src="/homer-bust.webp"
            alt=""
            width={56}
            height={56}
          />
          <div>
            <h1>
              Homer
              <HintMark id="nav.history" />
            </h1>
            <p className="career-lede">{active.lede}</p>
          </div>
        </div>

        <div className="career-tabs" role="tablist" aria-label="Homer features">
          {HOMER_FEATURES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={feature === f.id}
              className={feature === f.id ? 'is-on' : ''}
              onClick={() => selectFeature(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="career-toolbar">
        <div className="career-presets" role="group" aria-label="Date range">
          {RANGE_PRESETS.map(({ days, label }) => {
            const on =
              from === shiftDateISO(today, -Number(days)) && to === today;
            const needsPro = !historyIsPro && Number(days) > 90;
            return (
              <button
                key={days}
                type="button"
                className={on ? 'is-on' : ''}
                onClick={() => applyPreset(days)}
                title={
                  needsPro
                    ? 'Full archive search is Pro'
                    : days === '1825'
                      ? 'Whole role — up to five years'
                      : undefined
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          className="career-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            historyIsPro ? 'Search…' : 'Search (Pro)'
          }
          aria-label="Search finished tasks"
          disabled={history.data?.hasAccess === false}
          title={
            historyIsPro
              ? undefined
              : 'Keyword search across finished work is a Pro feature'
          }
        />
        <label className="career-date">
          <span className="sr-only">From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setRangeFrom(e.target.value)}
          />
        </label>
        <label className="career-date">
          <span className="sr-only">To</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setRangeTo(e.target.value)}
          />
        </label>
      </div>

      {history.isLoading ? (
        <p className="career-status">Loading…</p>
      ) : null}
      {history.isError ? (
        <p className="career-status is-error">
          {history.error instanceof Error
            ? history.error.message
            : 'Could not load finished work.'}
        </p>
      ) : null}
      {historyGateNote ? (
        <p className="career-callout">
          {historyGateNote}{' '}
          <a href="/pricing">See Pro</a>
        </p>
      ) : null}

      {!history.isLoading &&
      !history.isError &&
      items.length === 0 &&
      showNotes ? (
        <div className="career-empty">
          <strong>No finished tasks in this range</strong>
          <p>Complete work on Schedule or Tasks — Homer reads from that.</p>
        </div>
      ) : null}

      {showNotes ? (
        <div className="homer-setup">
          <HomerProgressStrip
            noted={notedTaskCount}
            min={homerMinNotes}
            ready={homerReady}
          />
          <HomerKeyTasksList
            tasks={keyTasksNeedingNotes}
            onOpen={openNotesForTask}
            onOpenAll={() => {
              if (keyTasksNeedingNotes[0]) {
                setSelectedId(keyTasksNeedingNotes[0].id);
              }
            }}
            mode={homerReady ? 'boost' : 'locked'}
          />
        </div>
      ) : null}

      {items.length > 0 && showNotes ? (
        <div className="career-layout">
          <div className="career-list" role="list">
            <p className="career-list-meta">
              {items.filter(taskHasNotes).length}/{items.length} with notes in
              this range · {notedTaskCount}/{homerMinNotes} toward Homer
            </p>
            {groups.map(([date, dayItems]) => (
              <section key={date} className="career-day">
                <h2>{formatDay(date)}</h2>
                <ul>
                  {dayItems.map((item) => {
                    const on = item.id === selectedId;
                    const ready = hasCareerDetails(item);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`career-row${on ? ' is-active' : ''}${
                            ready ? ' is-ready' : ''
                          }`}
                          onClick={() => setSelectedId(item.id)}
                          aria-current={on ? 'true' : undefined}
                        >
                          <span className="career-row-body">
                            <strong>{item.name}</strong>
                            <em>
                              {formatMinutes(item.actualMinutes)}
                              {item.careerProject
                                ? ` · ${item.careerProject}`
                                : ''}
                            </em>
                          </span>
                          <span
                            className={`career-dot${ready ? ' is-on' : ''}`}
                            title={ready ? 'Has notes' : 'No notes'}
                            aria-hidden
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <aside className="career-panel" aria-label="Work notes">
            {selected && draft ? (
              <>
                <div className="career-panel-head">
                  <div>
                    <h2>{selected.name}</h2>
                    <p>
                      {formatDay(selected.date)} ·{' '}
                      {formatMinutes(selected.actualMinutes)} logged
                    </p>
                  </div>
                </div>

                <form
                  className="career-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveCareer.mutate({ id: selected.id, ...draft });
                  }}
                >
                  <label>
                    <span>Notes</span>
                    <textarea
                      rows={4}
                      value={draft.notes}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, notes: e.target.value } : d,
                        )
                      }
                      placeholder="What did you do, own, or learn on this task?"
                    />
                  </label>
                  <label>
                    <span>Project / product</span>
                    <input
                      type="text"
                      value={draft.careerProject}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, careerProject: e.target.value } : d,
                        )
                      }
                      placeholder="Project or product name"
                    />
                  </label>
                  <label>
                    <span>What you owned</span>
                    <textarea
                      rows={3}
                      value={draft.careerResponsibility}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? { ...d, careerResponsibility: e.target.value }
                            : d,
                        )
                      }
                      placeholder="Your responsibility on this work"
                    />
                  </label>
                  <label>
                    <span>What you shipped</span>
                    <textarea
                      rows={3}
                      value={draft.careerAchievement}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? { ...d, careerAchievement: e.target.value }
                            : d,
                        )
                      }
                      placeholder="Result or achievement"
                    />
                  </label>
                  <label>
                    <span>Impact (optional)</span>
                    <textarea
                      rows={2}
                      value={draft.careerOutcome}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? { ...d, careerOutcome: e.target.value }
                            : d,
                        )
                      }
                      placeholder="Who benefited or what changed"
                    />
                  </label>

                  <div className="career-form-actions">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={saveCareer.isPending || !dirty}
                    >
                      {saveCareer.isPending ? 'Saving…' : 'Save notes'}
                    </button>
                    {justSaved && !dirty ? (
                      <span className="career-saved">Saved</span>
                    ) : null}
                    {saveCareer.isError ? (
                      <span className="career-status is-error">
                        {saveCareer.error instanceof Error
                          ? saveCareer.error.message
                          : 'Save failed'}
                      </span>
                    ) : null}
                  </div>
                </form>
              </>
            ) : (
              <p className="career-panel-empty">Select a task to add notes.</p>
            )}
          </aside>
        </div>
      ) : null}

      {showCoach && coachMode ? (
        <>
          <section
            className={`career-summary${homerReady ? '' : ' is-locked'}`}
            aria-label={active.title}
          >
            <div className="career-summary-head">
              <div>
                <h2>{active.title}</h2>
                <p className="career-summary-meta">
                  {scopedCount} finished task{scopedCount === 1 ? '' : 's'} ·{' '}
                  {from} → {to}
                </p>
              </div>
              {homerReady ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    scopedCount === 0 ||
                    (summaryScope === 'project' && !summaryProject.trim())
                  }
                  onClick={() => runGenerate({ refine: 'regenerate' })}
                >
                  {generateSummary.isPending
                    ? 'Generating…'
                    : summary
                      ? 'Regenerate'
                      : 'Generate'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => selectFeature('notes')}
                >
                  Add notes to unlock
                </button>
              )}
            </div>

            {!homerReady ? (
              <div className="homer-setup">
                <HomerProgressStrip
                  noted={notedTaskCount}
                  min={homerMinNotes}
                  ready={false}
                />
                <HomerKeyTasksList
                  tasks={keyTasksNeedingNotes}
                  onOpen={openNotesForTask}
                  onOpenAll={() => selectFeature('notes')}
                  mode="locked"
                />
              </div>
            ) : keyTasksNeedingNotes.length > 0 && !summary ? (
              <HomerKeyTasksList
                tasks={keyTasksNeedingNotes.slice(0, 3)}
                onOpen={openNotesForTask}
                onOpenAll={() => selectFeature('notes')}
                mode="boost"
              />
            ) : null}

            <div
              className="career-scope"
              role="group"
              aria-label="What to include"
              hidden={!homerReady}
            >
              <span className="career-scope-label">From</span>
              <div className="career-scope-toggle">
                <button
                  type="button"
                  className={summaryScope === 'all' ? 'is-on' : ''}
                  aria-pressed={summaryScope === 'all'}
                  onClick={() => {
                    setSummaryScope('all');
                    setSummary(null);
                    setPendingDup(null);
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className={summaryScope === 'project' ? 'is-on' : ''}
                  aria-pressed={summaryScope === 'project'}
                  disabled={!projectOptions.length}
                  title={
                    projectOptions.length
                      ? 'One project or product'
                      : 'Tag a project on Work notes first'
                  }
                  onClick={() => {
                    setSummaryScope('project');
                    setSummary(null);
                    setPendingDup(null);
                    if (!summaryProject && projectOptions[0]) {
                      setSummaryProject(projectOptions[0]);
                    }
                  }}
                >
                  Project / product
                </button>
              </div>
              {summaryScope === 'project' ? (
                <label className="career-scope-select">
                  <span className="sr-only">Project or product</span>
                  <select
                    value={summaryProject}
                    onChange={(e) => {
                      setSummaryProject(e.target.value);
                      setSummary(null);
                      setPendingDup(null);
                    }}
                    disabled={!projectOptions.length}
                  >
                    {!projectOptions.length ? (
                      <option value="">No projects yet</option>
                    ) : (
                      projectOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              ) : null}
            </div>

            {homerReady && coachMode === 'interview' ? (
              <div
                className="career-scope"
                role="group"
                aria-label="Answer format"
              >
                <span className="career-scope-label">Format</span>
                <div className="career-scope-toggle">
                  {INTERVIEW_FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={interviewFormat === f.id ? 'is-on' : ''}
                      aria-pressed={interviewFormat === f.id}
                      onClick={() => {
                        setInterviewFormat(f.id);
                        setSummary(null);
                        setPendingDup(null);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {homerReady && scopedCount === 0 ? (
              <p className="career-callout">
                No finished tasks in this range. Finish work on Schedule or
                Tasks, or widen the dates.
              </p>
            ) : null}

            {summaryErr ? (
              <p className="career-status is-error" role="alert">
                {summaryErr}
              </p>
            ) : null}

            {pendingDup ? (
              <div className="homer-dup" role="status">
                <p>
                  You already have a saved story for this period
                  {pendingDup.project ? ` · ${pendingDup.project}` : ''}. Update
                  it, or keep both.
                </p>
                <div className="homer-dup-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => resolveDuplicate('replace')}
                  >
                    {persistDraft.isPending ? 'Saving…' : 'Update existing'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() => resolveDuplicate('new')}
                  >
                    Save as new version
                  </button>
                </div>
              </div>
            ) : null}

            {summary ? (
              <div className="career-summary-body">
                <h3>{summary.headline}</h3>
                <p className="homer-summary-text">{summary.summary}</p>
                {summary.tip ? (
                  <p className="homer-tip">
                    <strong>Tip</strong> {summary.tip}
                  </p>
                ) : null}
                {summary.projects?.length ? (
                  <div>
                    <strong>Key projects</strong>
                    <ul>
                      {summary.projects.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {summary.achievements?.length &&
                summary.mode !== 'appraisal' ? (
                  <div>
                    <strong>Wins</strong>
                    <ul>
                      {summary.achievements.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {summary.gaps?.length ? (
                  <div className="homer-gaps">
                    <strong>Missing from your records</strong>
                    <ul>
                      {summary.gaps.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <details
                  className="homer-evidence"
                  open={evidenceOpen}
                  onToggle={(e) =>
                    setEvidenceOpen((e.target as HTMLDetailsElement).open)
                  }
                >
                  <summary>
                    Evidence / source activities (
                    {summary.evidence?.length ?? 0})
                  </summary>
                  <ul className="homer-evidence-list">
                    {(summary.evidence ?? []).map((e: HomerEvidenceItemDto) => (
                      <li key={e.taskId}>
                        <a href={e.href || '/homer?f=notes'}>
                          <strong>{e.name}</strong>
                        </a>
                        <span>
                          {e.date} · {e.actualMinutes}m
                          {e.estimatedMinutes
                            ? ` / ${e.estimatedMinutes}m planned`
                            : ''}
                          {e.project ? ` · ${e.project}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>

                <p className="career-summary-focus">
                  {summary.scope === 'project' && summary.project
                    ? summary.project
                    : 'All work'}
                  {summary.format ? ` · ${summary.format}` : ''}
                  {` · ${summary.from} → ${summary.to}`}
                  {summary.id
                    ? ` · Saved${
                        summary.createdAt
                          ? ` ${formatSavedAt(summary.createdAt)}`
                          : ''
                      }`
                    : ' · Not saved yet'}
                </p>

                <div
                  className="career-scope homer-refine"
                  role="group"
                  aria-label="Refine answer"
                >
                  <span className="career-scope-label">Refine</span>
                  <div className="career-scope-toggle">
                    {REFINE_ACTIONS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runGenerate({
                            refine: a.id,
                            savePolicy: summary.id ? 'replace' : undefined,
                            replaceId: summary.id ?? undefined,
                            base: summary,
                          })
                        }
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="career-summary-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() =>
                      void copyWriteUp(summary, summary.id ?? 'current')
                    }
                  >
                    {copiedId === (summary.id ?? 'current')
                      ? 'Copied'
                      : 'Copy'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={pdfBusyId === (summary.id ?? 'current')}
                    onClick={() =>
                      void downloadWriteUp(summary, summary.id ?? 'current')
                    }
                  >
                    {pdfBusyId === (summary.id ?? 'current')
                      ? 'Preparing…'
                      : 'Download PDF'}
                  </button>
                </div>
              </div>
            ) : (
              homerReady ? (
                <div className="career-summary-placeholder">
                  {active.placeholder}
                </div>
              ) : null
            )}
          </section>

          <section className="homer-saved" aria-label="Saved write-ups">
            <div className="homer-saved-head">
              <h2>Saved</h2>
              <p>
                {savedItems.length
                  ? `${savedItems.length} saved — open one anytime to copy or download.`
                  : 'Generate once and it stays here for later.'}
              </p>
            </div>
            {savedGens.isLoading ? (
              <p className="career-status">Loading saved…</p>
            ) : null}
            {savedItems.length === 0 && !savedGens.isLoading ? (
              <p className="homer-saved-empty">Nothing saved yet.</p>
            ) : (
              <ul className="homer-saved-list">
                {savedItems.map((g) => {
                  const on = summary?.id === g.id;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        className={`homer-saved-row${on ? ' is-on' : ''}`}
                        onClick={() => {
                          setPendingDup(null);
                          setSummary(storedToWriteUp(g));
                          setEvidenceOpen(Boolean(g.evidence?.length));
                          if (g.format) setInterviewFormat(g.format);
                        }}
                      >
                        <span className="homer-saved-row-body">
                          <strong>{g.headline || active.title}</strong>
                          <em>
                            {formatSavedAt(g.updatedAt || g.createdAt)}
                            {g.project ? ` · ${g.project}` : ' · All work'}
                            {g.format ? ` · ${g.format}` : ''}
                            {` · ${g.from} → ${g.to}`}
                            {g.version && g.version > 1
                              ? ` · v${g.version}`
                              : ''}
                          </em>
                        </span>
                      </button>
                      <div className="homer-saved-row-actions">
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() =>
                            void copyWriteUp(storedToWriteUp(g), g.id)
                          }
                        >
                          {copiedId === g.id ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          disabled={pdfBusyId === g.id}
                          onClick={() =>
                            void downloadWriteUp(storedToWriteUp(g), g.id)
                          }
                        >
                          {pdfBusyId === g.id ? 'Preparing…' : 'Download PDF'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={deleteSaved.isPending}
                          onClick={() =>
                            confirmDelete(g.id, g.headline || active.title)
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
