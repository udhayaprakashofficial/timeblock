'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { AiBrandPlatform, AiTaskPostDto } from '@timeblock/shared-types';
import { api } from '../../api';
import { openAiHub, withAiAccess } from '../ai/ai-events';
import { LinkedInIcon, XPlatformIcon } from './ShareIcons';

const PLATFORMS: Array<{
  id: AiBrandPlatform;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: <LinkedInIcon size={14} />,
  },
  {
    id: 'x',
    label: 'X',
    icon: <XPlatformIcon size={13} />,
  },
];

type Props = {
  taskId: string;
  /** Latest notes/comments — used to gate Generate */
  notes?: string | null;
  /** Single-row toolbar; expands only when a draft exists */
  compact?: boolean;
};

export function TaskAiPostPanel({ taskId, notes, compact }: Props) {
  const [platform, setPlatform] = useState<AiBrandPlatform>('linkedin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AiTaskPostDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hasNotes = Boolean(notes?.trim());

  useEffect(() => {
    setResult(null);
    setErr(null);
    setCopied(false);
    setExpanded(false);
  }, [taskId]);

  const onGenerate = async () => {
    if (!hasNotes) {
      setErr('Add notes or comments on this task first.');
      return;
    }
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const allowed = await withAiAccess(async () => {
        const data = await api.post<AiTaskPostDto>('/api/ai/task-post', {
          taskId,
          platform,
        });
        setResult(data);
        setExpanded(true);
      }, { tab: 'content' });
      if (!allowed) return;
    } catch (e) {
      setResult(null);
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

  const onCopy = async () => {
    if (!result?.summary) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
    } catch {
      setErr('Could not copy — select the text manually.');
    }
  };

  return (
    <div
      className={[
        'task-ai-post',
        compact ? 'is-compact' : '',
        result && expanded ? 'is-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="task-ai-post-bar">
        <div
          className="task-ai-post-platforms"
          role="group"
          aria-label="Platform"
        >
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={platform === p.id ? 'is-active' : ''}
              aria-label={p.label}
              aria-pressed={platform === p.id}
              title={p.label}
              onClick={() => setPlatform(p.id)}
            >
              {p.icon}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="queue-ai-btn task-ai-post-gen"
          disabled={busy || !hasNotes}
          title={
            hasNotes
              ? `Spotlight · ${platform === 'x' ? 'X' : 'LinkedIn'} from notes`
              : 'Add notes first'
          }
          onClick={() => void onGenerate()}
        >
          {busy ? '✦ Writing…' : '✦ Spotlight'}
        </button>
        {result ? (
          <>
            <button
              type="button"
              className="queue-ai-btn"
              onClick={() => void onCopy()}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="queue-ai-btn task-ai-post-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Hide' : 'Show'}
            </button>
            <Link
              href={`/spotlight?taskId=${encodeURIComponent(taskId)}`}
              className="queue-ai-btn task-ai-post-saved"
              title="Open saved posts for this task"
            >
              Saved
            </Link>
          </>
        ) : null}
      </div>

      {!hasNotes ? (
        <p className="task-ai-post-hint">
          Add notes first — then Spotlight can draft a LinkedIn/X post.
        </p>
      ) : null}

      {err ? <p className="task-ai-post-err">{err}</p> : null}

      {result && expanded ? (
        <textarea
          className="task-ai-post-copy"
          readOnly
          value={result.summary}
          rows={platform === 'x' ? 6 : 10}
          aria-label="Generated social post"
        />
      ) : null}
    </div>
  );
}
