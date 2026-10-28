'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AiAccessDto,
  AiBrainDumpDto,
  AiCoachDto,
  AiDailyPlanDto,
  AiEstimateDto,
  AiFocusDto,
  AiPrioritizeDto,
  AiProposedTaskDto,
  AiRecoverDto,
  AiRecoveryMoveDto,
  TaskDto,
} from '@timeblock/shared-types';
import { api, todayISO } from '../../api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  createTaskOptimistic,
  fetchTasks,
  moveToBacklogOptimistic,
  reorderTasksOptimistic,
  updateTaskOptimistic,
} from '../../store/tasksSlice';
import { ShareStudio } from '../share/ShareStudio';
import { applyAiEstimate, type AiHubTab } from './ai-events';
import { AI_JOB } from './ai-copy';
import { AiUpgradePanel } from './AiUpgradePanel';
import { refreshAiCreditsBadge } from './AiCreditsBadge';
import './ai-hub.css';

type Props = {
  open: boolean;
  onClose: () => void;
  timeZone?: string | null;
  initialTab?: AiHubTab;
  /** Hide tab catalog — show one problem + solution */
  singleJob?: boolean;
  seedEstimateName?: string;
  seedDumpText?: string;
  seedGoals?: string;
};

function newTempId() {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AiHub({
  open,
  onClose,
  timeZone,
  initialTab = 'plan',
  singleJob = true,
  seedEstimateName,
  seedDumpText,
  seedGoals,
}: Props) {
  const dispatch = useAppDispatch();
  const date = todayISO(timeZone);
  const dayTasks = useAppSelector((s) => s.tasks.byDate[date] ?? []);
  const [tab, setTab] = useState<AiHubTab>(initialTab);
  const [access, setAccess] = useState<AiAccessDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Plan / dump proposals
  const [goals, setGoals] = useState('');
  const [dump, setDump] = useState('');
  const [planSummary, setPlanSummary] = useState('');
  const [proposed, setProposed] = useState<AiProposedTaskDto[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Estimate
  const [estName, setEstName] = useState('');
  const [estimate, setEstimate] = useState<AiEstimateDto | null>(null);

  // Prioritize / recover
  const [prio, setPrio] = useState<AiPrioritizeDto | null>(null);
  const [recover, setRecover] = useState<AiRecoverDto | null>(null);
  const [recoverNote, setRecoverNote] = useState('');
  const [selectedMoves, setSelectedMoves] = useState<Set<string>>(new Set());

  // Coach / focus
  const [coach, setCoach] = useState<AiCoachDto | null>(null);
  const [focus, setFocus] = useState<AiFocusDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    if (seedEstimateName?.trim()) setEstName(seedEstimateName.trim());
    if (seedDumpText != null) setDump(seedDumpText);
    if (seedGoals != null) setGoals(seedGoals);
    setErr(null);
    setOk(null);
  }, [open, initialTab, seedEstimateName, seedDumpText, seedGoals]);

  useEffect(() => {
    if (!open) return;
    setAccess(null);
    void api
      .get<AiAccessDto>('/api/ai/access')
      .then(setAccess)
      .catch(() =>
        setAccess({
          enabled: true,
          requirePro: true,
          hasAccess: false,
          reason:
            'Could not check AI credits. Try again, or upgrade on the pricing page.',
          creditsRemaining: 0,
          creditsLimit: 50,
          creditsUsed: 0,
          creditsMonth: '',
          isPro: false,
          refillLabel: 'next month',
          freeCreditsMonthly: 50,
          proCreditsMonthly: 50,
        }),
      );
  }, [open]);

  const accessPending = open && access === null;
  const blocked = Boolean(access && !access.hasAccess);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await fn();
      refreshAiCreditsBadge();
      void api.get<AiAccessDto>('/api/ai/access').then(setAccess).catch(() => null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI request failed';
      setErr(msg);
      if (/credit|upgrade|refill|forbidden/i.test(msg)) {
        void api.get<AiAccessDto>('/api/ai/access').then(setAccess).catch(() => null);
        refreshAiCreditsBadge();
      }
    } finally {
      setBusy(false);
    }
  };

  const onProposePlan = () =>
    void run(async () => {
      const data = await api.post<AiDailyPlanDto>('/api/ai/daily-plan', {
        date,
        goals: goals.trim() || undefined,
      });
      setPlanSummary(data.summary);
      setProposed(data.proposedTasks);
      setSelectedKeys(new Set(data.proposedTasks.map((t) => t.key)));
    });

  const onBrainDump = () =>
    void run(async () => {
      const data = await api.post<AiBrainDumpDto>('/api/ai/brain-dump', {
        date,
        text: dump,
      });
      setPlanSummary('From your brain dump — edit, then apply.');
      setProposed(data.proposedTasks);
      setSelectedKeys(new Set(data.proposedTasks.map((t) => t.key)));
    });

  const onApplyProposed = () =>
    void run(async () => {
      const picks = proposed.filter((t) => selectedKeys.has(t.key));
      if (!picks.length) {
        setErr('Select at least one task to apply.');
        return;
      }
      for (const t of picks) {
        const tempId = newTempId();
        await dispatch(
          createTaskOptimistic({
            date,
            name: t.name,
            estimatedMinutes: t.estimatedMinutes,
            ...(t.startTime && t.endTime
              ? { startTime: t.startTime, endTime: t.endTime }
              : {}),
            tempId,
          }),
        );
      }
      await dispatch(fetchTasks({ date, force: true }));
      setOk(`Added ${picks.length} task${picks.length === 1 ? '' : 's'}.`);
      setProposed([]);
      setSelectedKeys(new Set());
    });

  const onEstimate = () =>
    void run(async () => {
      const data = await api.post<AiEstimateDto>('/api/ai/estimate', {
        name: estName,
        date,
      });
      setEstimate(data);
    });

  const onPrioritize = () =>
    void run(async () => {
      const data = await api.post<AiPrioritizeDto>('/api/ai/prioritize', {
        date,
      });
      setPrio(data);
    });

  const onApplyPrioritize = () =>
    void run(async () => {
      if (!prio?.orderedTaskIds.length) return;
      await dispatch(
        reorderTasksOptimistic({
          date,
          taskIds: prio.orderedTaskIds,
          previous: dayTasks,
        }),
      );
      await dispatch(fetchTasks({ date, force: true }));
      setOk('Queue reordered.');
      setPrio(null);
    });

  const onRecover = () =>
    void run(async () => {
      const data = await api.post<AiRecoverDto>('/api/ai/recover', {
        date,
        note: recoverNote.trim() || undefined,
      });
      setRecover(data);
      setSelectedMoves(new Set(data.moves.map((m) => m.taskId)));
    });

  const onApplyRecover = () =>
    void run(async () => {
      if (!recover) return;
      const moves = recover.moves.filter((m) => selectedMoves.has(m.taskId));
      for (const m of moves) {
        if (m.action === 'keep') continue;
        if (m.action === 'backlog') {
          await dispatch(
            moveToBacklogOptimistic({ taskId: m.taskId, date }),
          );
          continue;
        }
        const body: {
          estimatedMinutes?: number;
          startTime?: string;
          endTime?: string;
        } = {};
        if (m.action === 'shorten' && m.estimatedMinutes) {
          body.estimatedMinutes = m.estimatedMinutes;
        }
        if (m.action === 'reschedule' && m.startTime) {
          const task = dayTasks.find((t) => t.id === m.taskId);
          const mins = m.estimatedMinutes || task?.estimatedMinutes || 30;
          const [h, mi] = m.startTime.split(':').map(Number);
          const start = h * 60 + mi;
          const end = start + mins;
          body.startTime = m.startTime;
          body.endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
          if (m.estimatedMinutes) body.estimatedMinutes = m.estimatedMinutes;
        }
        if (Object.keys(body).length) {
          await dispatch(
            updateTaskOptimistic({ taskId: m.taskId, date, body }),
          );
        }
      }
      await dispatch(fetchTasks({ date, force: true }));
      setOk('Recovery moves applied.');
      setRecover(null);
    });

  const onCoach = () =>
    void run(async () => {
      setCoach(await api.post<AiCoachDto>('/api/ai/coach', { date }));
    });

  const onFocus = () =>
    void run(async () => {
      const live = dayTasks.find((t) => t.activeEntryId);
      setFocus(
        await api.post<AiFocusDto>('/api/ai/focus', {
          date,
          taskId: live?.id,
        }),
      );
    });

  const prioNames = useMemo(() => {
    if (!prio) return [];
    const map = new Map(dayTasks.map((t: TaskDto) => [t.id, t.name]));
    return prio.orderedTaskIds.map((id) => map.get(id) || id);
  }, [prio, dayTasks]);

  const job = AI_JOB[tab];

  if (!open) return null;

  return (
    <div
      className="ai-hub"
      role="dialog"
      aria-modal="true"
      aria-label={blocked ? 'Upgrade for Cupkey AI' : job.title}
    >
      <button type="button" className="ai-hub-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`ai-hub-panel${singleJob || blocked ? ' is-single' : ''}${
          blocked ? ' is-upgrade' : ''
        }`}
      >
        <header className="ai-hub-head">
          <div>
            <p className="ai-hub-kicker">
              <span className="ai-hub-mark" aria-hidden>
                ✦
              </span>{' '}
              Cupkey AI
            </p>
            <h2>
              {blocked
                ? access?.isPro
                  ? 'AI credits used up'
                  : 'Upgrade for more AI credits'
                : job.title}
            </h2>
            {!blocked && access ? (
              <p className="ai-hub-credits-meta">
                {access.creditsRemaining}/{access.creditsLimit} credits left
                this month
              </p>
            ) : null}
          </div>
          <button type="button" className="ai-hub-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="ai-hub-body">
          {accessPending ? (
            <p className="ai-hub-meta">Checking AI credits…</p>
          ) : null}

          {blocked ? (
            <AiUpgradePanel
              access={access}
              reason={access?.reason}
              onClose={onClose}
            />
          ) : null}

          {!blocked && !accessPending && tab === 'plan' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <textarea
                rows={3}
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="What’s important today? (optional)"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onProposePlan}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {planSummary && proposed.length ? (
                <ProposalList
                  summary={planSummary}
                  proposed={proposed}
                  selected={selectedKeys}
                  onChangeProposed={setProposed}
                  onToggle={(key) =>
                    setSelectedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  onApply={onApplyProposed}
                  busy={busy}
                />
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'dump' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <textarea
                rows={6}
                value={dump}
                onChange={(e) => setDump(e.target.value)}
                placeholder="Paste notes, bullets, or a messy list…"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || dump.trim().length < 3}
                onClick={onBrainDump}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {proposed.length ? (
                <ProposalList
                  summary={planSummary || 'Review before applying'}
                  proposed={proposed}
                  selected={selectedKeys}
                  onChangeProposed={setProposed}
                  onToggle={(key) =>
                    setSelectedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  onApply={onApplyProposed}
                  busy={busy}
                />
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'estimate' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <input
                value={estName}
                onChange={(e) => setEstName(e.target.value)}
                placeholder="Task name…"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !estName.trim()}
                onClick={onEstimate}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {estimate ? (
                <div className="ai-hub-card">
                  <strong>{estimate.estimatedMinutes} minutes</strong>
                  <p>{estimate.rationale}</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      applyAiEstimate(estimate.estimatedMinutes);
                      onClose();
                    }}
                  >
                    Use this time
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'prioritize' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onPrioritize}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {prio ? (
                <div className="ai-hub-card">
                  <p>{prio.rationale}</p>
                  <ol className="ai-hub-order">
                    {prioNames.map((n, i) => (
                      <li key={`${n}-${i}`}>{n}</li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={onApplyPrioritize}
                  >
                    Apply order
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'recover' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <input
                value={recoverNote}
                onChange={(e) => setRecoverNote(e.target.value)}
                placeholder="What went wrong? (optional)"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onRecover}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {recover ? (
                <div className="ai-hub-card">
                  <p>{recover.summary}</p>
                  <ul className="ai-hub-moves">
                    {recover.moves.map((m) => (
                      <RecoveryRow
                        key={m.taskId}
                        move={m}
                        checked={selectedMoves.has(m.taskId)}
                        onToggle={() =>
                          setSelectedMoves((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.taskId)) next.delete(m.taskId);
                            else next.add(m.taskId);
                            return next;
                          })
                        }
                      />
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !selectedMoves.size}
                    onClick={onApplyRecover}
                  >
                    Apply selected
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'coach' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onCoach}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {coach ? (
                <div className="ai-hub-card">
                  <strong>{coach.title}</strong>
                  <p>{coach.body}</p>
                  <ul>
                    {coach.tips.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'focus' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onFocus}
              >
                {busy ? 'Working…' : job.cta}
              </button>
              {focus ? (
                <div className="ai-hub-card">
                  {focus.taskName ? (
                    <p className="ai-hub-meta">On: {focus.taskName}</p>
                  ) : null}
                  <strong>{focus.message}</strong>
                  <p>{focus.suggestion}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {!blocked && !accessPending && tab === 'content' ? (
            <section className="ai-hub-section">
              <p className="ai-hub-lede">{job.problem}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShareOpen(true)}
              >
                {job.cta}
              </button>
            </section>
          ) : null}

          {err ? <p className="ai-hub-err">{err}</p> : null}
          {ok ? <p className="ai-hub-ok">{ok}</p> : null}
        </div>
      </div>

      <ShareStudio
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        week={null}
        initialTab="ai"
        timeZone={timeZone}
      />
    </div>
  );
}

function ProposalList({
  summary,
  proposed,
  selected,
  onChangeProposed,
  onToggle,
  onApply,
  busy,
}: {
  summary: string;
  proposed: AiProposedTaskDto[];
  selected: Set<string>;
  onChangeProposed: (next: AiProposedTaskDto[]) => void;
  onToggle: (key: string) => void;
  onApply: () => void;
  busy: boolean;
}) {
  return (
    <div className="ai-hub-card">
      <p>{summary}</p>
      <p className="ai-hub-meta">Edit freely — apply only saves what you select.</p>
      <ul className="ai-hub-proposals">
        {proposed.map((t, idx) => (
          <li key={t.key}>
            <label className="ai-hub-check">
              <input
                type="checkbox"
                checked={selected.has(t.key)}
                onChange={() => onToggle(t.key)}
              />
              <span />
            </label>
            <input
              className="ai-hub-name"
              value={t.name}
              onChange={(e) => {
                const next = [...proposed];
                next[idx] = { ...t, name: e.target.value };
                onChangeProposed(next);
              }}
            />
            <input
              className="ai-hub-mins"
              type="number"
              min={15}
              step={5}
              value={t.estimatedMinutes}
              onChange={(e) => {
                const next = [...proposed];
                next[idx] = {
                  ...t,
                  estimatedMinutes: Math.max(15, Number(e.target.value) || 30),
                };
                onChangeProposed(next);
              }}
            />
            <span className="ai-hub-mins-label">m</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !selected.size}
        onClick={onApply}
      >
        Apply selected
      </button>
    </div>
  );
}

function RecoveryRow({
  move,
  checked,
  onToggle,
}: {
  move: AiRecoveryMoveDto;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="ai-hub-check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span />
      </label>
      <div>
        <strong>{move.taskName}</strong>
        <em>
          {move.action}
          {move.startTime ? ` @ ${move.startTime}` : ''}
          {move.estimatedMinutes ? ` · ${move.estimatedMinutes}m` : ''}
        </em>
        <p>{move.reason}</p>
      </div>
    </li>
  );
}
