'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type {
  AiBrandPlatform,
  StoredTaskAiPostDto,
  StoredTaskAiPostsDto,
} from '@timeblock/shared-types';
import { api } from '../api';
import { HintMark } from '../components/ui-hints';
import { LinkedInIcon, XPlatformIcon } from '../components/share/ShareIcons';

function platformLabel(p: AiBrandPlatform): string {
  return p === 'x' ? 'X' : 'LinkedIn';
}

function PlatformGlyph({ platform }: { platform: AiBrandPlatform }) {
  return platform === 'x' ? (
    <XPlatformIcon size={13} />
  ) : (
    <LinkedInIcon size={14} />
  );
}

function formatWhen(iso: string, timeZone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  });
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

export function PostsPage({ timeZone }: { timeZone?: string | null }) {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const filterTaskId = searchParams.get('taskId')?.trim() || '';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<'all' | AiBrandPlatform>(
    'all',
  );
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const postsQ = useQuery({
    queryKey: ['task-ai-posts', filterTaskId || 'all'],
    queryFn: () => {
      const q = filterTaskId
        ? `?taskId=${encodeURIComponent(filterTaskId)}`
        : '';
      return api.get<StoredTaskAiPostsDto>(`/api/ai/task-posts${q}`);
    },
  });

  const allItems = postsQ.data?.items ?? [];
  const items = useMemo(
    () =>
      platformFilter === 'all'
        ? allItems
        : allItems.filter((p) => p.platform === platformFilter),
    [allItems, platformFilter],
  );

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId && items.some((p) => p.id === selectedId)) return;
    setSelectedId(items[0]!.id);
  }, [items, selectedId]);

  const selected = useMemo(
    () => items.find((p) => p.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setEditing(false);
    setSaveErr(null);
    setDraft(selected?.summary ?? '');
  }, [selected?.id, selected?.summary]);

  const groups = useMemo(() => {
    const map = new Map<string, StoredTaskAiPostDto[]>();
    for (const item of items) {
      const key = item.taskId;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([taskId, posts]) => ({
      taskId,
      taskName: posts[0]!.taskName,
      date: posts[0]!.date,
      posts,
    }));
  }, [items]);

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true }>(`/api/ai/task-posts/${id}`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['task-ai-posts'] });
      if (selectedId === id) setSelectedId(null);
    },
  });

  const save = useMutation({
    mutationFn: (payload: { id: string; summary: string }) =>
      api.patch<StoredTaskAiPostDto>(`/api/ai/task-posts/${payload.id}`, {
        summary: payload.summary,
      }),
    onSuccess: () => {
      setEditing(false);
      setSaveErr(null);
      void qc.invalidateQueries({ queryKey: ['task-ai-posts'] });
    },
    onError: (e) => {
      setSaveErr(e instanceof Error ? e.message : 'Could not save');
    },
  });

  const onCopy = async () => {
    const text = editing ? draft : selected?.summary;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const startEdit = () => {
    if (!selected) return;
    setDraft(selected.summary);
    setSaveErr(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(selected?.summary ?? '');
    setSaveErr(null);
    setEditing(false);
  };

  return (
    <div className="posts-page">
      <header className="posts-head">
        <div>
          <h1>
            Spotlight
            <HintMark id="nav.posts" />
          </h1>
          <p className="posts-lede">
            Tasks turned into LinkedIn and X posts — open one to copy or remove.
          </p>
        </div>
        <div className="posts-head-tools">
          <div
            className="posts-platform-toggle"
            role="group"
            aria-label="Filter by platform"
          >
            {(
              [
                { id: 'all' as const, label: 'All' },
                { id: 'linkedin' as const, label: 'LinkedIn' },
                { id: 'x' as const, label: 'X' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`posts-platform-opt${opt.id !== 'all' ? ' is-icon' : ''}${
                  platformFilter === opt.id ? ' is-active' : ''
                }`}
                aria-label={opt.label}
                aria-pressed={platformFilter === opt.id}
                title={opt.label}
                onClick={() => setPlatformFilter(opt.id)}
              >
                {opt.id === 'all' ? (
                  opt.label
                ) : (
                  <span className="posts-platform-toggle-icon" aria-hidden>
                    <PlatformGlyph platform={opt.id} />
                  </span>
                )}
              </button>
            ))}
          </div>
          {filterTaskId ? (
            <a className="posts-clear-filter" href="/spotlight">
              Show all tasks
            </a>
          ) : null}
        </div>
      </header>

      {postsQ.isLoading ? (
        <p className="posts-status">Loading Spotlight…</p>
      ) : null}

      {postsQ.isError ? (
        <p className="posts-status is-error">
          {postsQ.error instanceof Error
            ? postsQ.error.message
            : 'Could not load Spotlight drafts.'}
        </p>
      ) : null}

      {!postsQ.isLoading && !postsQ.isError && items.length === 0 ? (
        <div className="posts-empty">
          <strong>
            {allItems.length === 0
              ? 'No Spotlight drafts yet'
              : `No ${platformFilter === 'x' ? 'X' : 'LinkedIn'} drafts`}
          </strong>
          <p>
            {allItems.length === 0
              ? 'Generate a LinkedIn or X post from a task’s notes — it will show up here in Spotlight.'
              : 'Try All, or generate a draft for this platform from a task.'}
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="posts-layout">
          <div className="posts-list" role="list">
            {groups.map((g) => (
              <section key={g.taskId} className="posts-group">
                <header className="posts-group-head">
                  <strong>{g.taskName}</strong>
                  <span>{formatDay(g.date)}</span>
                </header>
                <ul>
                  {g.posts.map((p) => {
                    const active = p.id === selectedId;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={`posts-row${active ? ' is-active' : ''}`}
                          onClick={() => setSelectedId(p.id)}
                          aria-current={active ? 'true' : undefined}
                        >
                          <span className="posts-row-platform" aria-hidden>
                            <PlatformGlyph platform={p.platform} />
                          </span>
                          <span className="posts-row-body">
                            <em>{platformLabel(p.platform)}</em>
                            <span>
                              {p.summary.slice(0, 96)}
                              {p.summary.length > 96 ? '…' : ''}
                            </span>
                          </span>
                          <time dateTime={p.createdAt}>
                            {formatWhen(p.createdAt, timeZone)}
                          </time>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <aside className="posts-panel" aria-label="Selected post">
            {selected ? (
              <>
                <div className="posts-panel-head">
                  <div>
                    <span className="posts-panel-platform">
                      <PlatformGlyph platform={selected.platform} />
                      {platformLabel(selected.platform)}
                    </span>
                    <h2>{selected.taskName}</h2>
                    <p>
                      {formatDay(selected.date)} ·{' '}
                      {formatWhen(selected.createdAt, timeZone)}
                    </p>
                  </div>
                  <div className="posts-panel-actions">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={
                            save.isPending || !draft.trim()
                          }
                          onClick={() =>
                            save.mutate({
                              id: selected.id,
                              summary: draft,
                            })
                          }
                        >
                          {save.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={save.isPending}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={startEdit}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void onCopy()}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm('Remove this saved post?')
                            ) {
                              remove.mutate(selected.id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <textarea
                  className={`posts-panel-copy${editing ? ' is-editing' : ''}`}
                  readOnly={!editing}
                  value={editing ? draft : selected.summary}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={16}
                  aria-label={
                    editing ? 'Edit post copy' : 'Saved post copy'
                  }
                />
                {saveErr ? (
                  <p className="posts-panel-err">{saveErr}</p>
                ) : null}
              </>
            ) : (
              <p className="posts-panel-empty">Select a post to read it.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
