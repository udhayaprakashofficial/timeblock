'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type {
  AiBrandPlatform,
  AiBrandRange,
  AiBrandSummaryDto,
  AiTaskPostDto,
  TaskDto,
} from '@timeblock/shared-types';
import { api, todayISO } from '../../api';
import { openAiHub, withAiAccess } from '../ai/ai-events';
import { formatHm } from './shareFormat';

const RANGES: Array<{ id: AiBrandRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const PLATFORMS: Array<{ id: AiBrandPlatform; label: string }> = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X' },
];

type Mode = 'period' | 'task';

type Props = {
  timeZone?: string | null;
  /** Prefer week / report anchor when Share opens from Report */
  anchorDate?: string | null;
};

export function AiBrandPanel({ timeZone, anchorDate }: Props) {
  const defaultDate = anchorDate?.slice(0, 10) || todayISO(timeZone);
  const [mode, setMode] = useState<Mode>('task');
  const [range, setRange] = useState<AiBrandRange>('week');
  const [platform, setPlatform] = useState<AiBrandPlatform>('linkedin');
  const [date, setDate] = useState(defaultDate);
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [periodResult, setPeriodResult] = useState<AiBrandSummaryDto | null>(
    null,
  );
  const [taskResult, setTaskResult] = useState<AiTaskPostDto | null>(null);
  const [copied, setCopied] = useState(false);

  const tasksQuery = useQuery({
    queryKey: ['ai-tasks', date],
    queryFn: () => api.get<TaskDto[]>(`/api/tasks?date=${date.slice(0, 10)}`),
    enabled: mode === 'task',
  });

  const tasks = useMemo(
    () => (tasksQuery.data ?? []).filter((t) => !t.inBacklog),
    [tasksQuery.data],
  );

  const selected = tasks.find((t) => t.id === taskId) ?? null;

  useEffect(() => {
    if (!tasks.length) {
      setTaskId('');
      return;
    }
    if (!taskId || !tasks.some((t) => t.id === taskId)) {
      const withNotes = tasks.find((t) => t.notes?.trim());
      setTaskId((withNotes ?? tasks[0]).id);
    }
  }, [tasks, taskId]);

  const onGeneratePeriod = async () => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    setTaskResult(null);
    try {
      const allowed = await withAiAccess(async () => {
        const data = await api.post<AiBrandSummaryDto>(
          '/api/ai/brand-summary',
          {
            date: date.slice(0, 10),
            range,
            platform,
          },
        );
        setPeriodResult(data);
      }, { tab: 'content' });
      if (!allowed) return;
    } catch (e) {
      setPeriodResult(null);
      const msg = e instanceof Error ? e.message : 'Could not generate summary';
      if (/pro|upgrade|not available|forbidden/i.test(msg)) {
        openAiHub({ tab: 'content' });
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const onGenerateTask = async () => {
    if (!taskId) {
      setErr('Pick a task first.');
      return;
    }
    if (!selected?.notes?.trim()) {
      setErr('Add notes or comments on this task before generating a post.');
      return;
    }
    setBusy(true);
    setErr(null);
    setCopied(false);
    setPeriodResult(null);
    try {
      const allowed = await withAiAccess(async () => {
        const data = await api.post<AiTaskPostDto>('/api/ai/task-post', {
          taskId,
          platform,
        });
        setTaskResult(data);
      }, { tab: 'content' });
      if (!allowed) return;
    } catch (e) {
      setTaskResult(null);
      const msg = e instanceof Error ? e.message : 'Could not generate post';
      if (/pro|upgrade|not available|forbidden/i.test(msg)) {
        openAiHub({ tab: 'content' });
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const summary = mode === 'task' ? taskResult?.summary : periodResult?.summary;

  const onCopy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setErr('Could not copy — select the text manually.');
    }
  };

  return (
    <div className="share-ai">
      <div className="share-ai-mode" role="tablist" aria-label="Post source">
        <button
          type="button"
          role="tab"
          className={mode === 'task' ? 'is-active' : ''}
          aria-selected={mode === 'task'}
          onClick={() => setMode('task')}
        >
          By task
        </button>
        <button
          type="button"
          role="tab"
          className={mode === 'period' ? 'is-active' : ''}
          aria-selected={mode === 'period'}
          onClick={() => setMode('period')}
        >
          By period
        </button>
      </div>

      {mode === 'task' ? (
        <>
          <div className="share-ai-controls share-ai-controls-task">
            <label className="share-ai-field">
              <span>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="share-ai-field share-ai-field-wide">
              <span>Task</span>
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                disabled={!tasks.length}
              >
                {!tasks.length ? (
                  <option value="">No tasks this day</option>
                ) : (
                  tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.notes?.trim() ? '● ' : '○ '}
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="share-ai-field">
              <span>Platform</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as AiBrandPlatform)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary share-ai-gen"
              disabled={busy || !taskId || !selected?.notes?.trim()}
              onClick={() => void onGenerateTask()}
            >
              {busy ? 'Writing…' : 'Generate Spotlight'}
            </button>
          </div>
          {selected && !selected.notes?.trim() ? (
            <p className="share-ai-empty">
              This task has no notes yet. Open it on Today, add comments, save,
              then generate a LinkedIn or X post.
            </p>
          ) : null}
        </>
      ) : (
        <div className="share-ai-controls">
          <label className="share-ai-field">
            <span>Range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as AiBrandRange)}
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="share-ai-field">
            <span>Anchor date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="share-ai-field">
            <span>Platform</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as AiBrandPlatform)}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary share-ai-gen"
            disabled={busy}
            onClick={() => void onGeneratePeriod()}
          >
            {busy ? 'Writing…' : 'Generate Spotlight'}
          </button>
        </div>
      )}

      {err ? <p className="share-err share-ai-err">{err}</p> : null}

      {mode === 'period' && periodResult ? (
        <div className="share-ai-result">
          <div className="share-ai-facts">
            <p className="share-eyebrow">{periodResult.label}</p>
            <ul>
              <li>
                <strong>{periodResult.facts.completed}</strong>
                <span>shipped</span>
              </li>
              <li>
                <strong>{formatHm(periodResult.facts.actualMinutes)}</strong>
                <span>logged</span>
              </li>
              <li>
                <strong>{periodResult.facts.completionPercent}%</strong>
                <span>done</span>
              </li>
            </ul>
          </div>
          <textarea
            className="share-ai-copy"
            readOnly
            value={periodResult.summary}
            rows={platform === 'x' ? 5 : 10}
            aria-label="Generated post"
          />
          <div className="share-ai-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onCopy()}
            >
              {copied ? 'Copied' : 'Copy post'}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'task' && taskResult ? (
        <div className="share-ai-result">
          <div className="share-ai-facts">
            <p className="share-eyebrow">{taskResult.taskName}</p>
            <ul>
              <li>
                <strong>{formatHm(taskResult.facts.actualMinutes)}</strong>
                <span>logged</span>
              </li>
              <li>
                <strong>{formatHm(taskResult.facts.estimatedMinutes)}</strong>
                <span>planned</span>
              </li>
              <li>
                <strong>{taskResult.facts.status}</strong>
                <span>status</span>
              </li>
            </ul>
          </div>
          <textarea
            className="share-ai-copy"
            readOnly
            value={taskResult.summary}
            rows={platform === 'x' ? 5 : 10}
            aria-label="Generated post"
          />
          <div className="share-ai-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onCopy()}
            >
              {copied ? 'Copied' : 'Copy post'}
            </button>
            <Link
              href={`/spotlight?taskId=${encodeURIComponent(taskResult.taskId)}`}
              className="btn btn-ghost"
            >
              View in Spotlight
            </Link>
          </div>
        </div>
      ) : null}

      {mode === 'period' && !periodResult ? (
        <p className="share-ai-empty">
          Pick a range and generate a LinkedIn or X post from your real Cupkey
          minutes — notes on tasks are used when available.
        </p>
      ) : null}
    </div>
  );
}
