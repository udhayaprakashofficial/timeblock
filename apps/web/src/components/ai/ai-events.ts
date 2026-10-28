/** Open Cupkey AI from natural product surfaces (composer, queue, focus). */

import type { AiAccessDto } from '@timeblock/shared-types';
import { api } from '../../api';

export type AiHubTab =
  | 'plan'
  | 'dump'
  | 'estimate'
  | 'prioritize'
  | 'recover'
  | 'coach'
  | 'focus'
  | 'content';

export type OpenAiHubDetail = {
  tab?: AiHubTab;
  /** Prefill estimate tab */
  estimateName?: string;
  /** Prefill brain dump */
  dumpText?: string;
  /** Prefill planner goals */
  goals?: string;
};

export const OPEN_AI_HUB_EVENT = 'tb:open-ai';
export const AI_ESTIMATE_EVENT = 'tb:ai-estimate';

export function openAiHub(detail: OpenAiHubDetail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_AI_HUB_EVENT, { detail }));
}

/** Push an AI estimate into the Today composer duration field. */
export function applyAiEstimate(minutes: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(AI_ESTIMATE_EVENT, { detail: { minutes } }),
  );
}

let accessCache: { at: number; value: AiAccessDto } | null = null;

/** Drop cached access after a successful (or failed credit) AI call. */
export function invalidateAiAccessCache() {
  accessCache = null;
}

/** Fresh enough for button clicks; avoids spamming /access. */
async function fetchAiAccess(): Promise<AiAccessDto> {
  const now = Date.now();
  if (accessCache && now - accessCache.at < 8_000) return accessCache.value;
  const value = await api.get<AiAccessDto>('/api/ai/access');
  accessCache = { at: now, value };
  return value;
}

/**
 * Run an AI action only if credits remain.
 * Out of credits → opens AiHub upgrade / refill panel.
 */
export async function withAiAccess(
  onAllowed: () => void | Promise<void>,
  hubDetail: OpenAiHubDetail = {},
): Promise<boolean> {
  try {
    invalidateAiAccessCache();
    const access = await fetchAiAccess();
    if (!access.hasAccess) {
      openAiHub(hubDetail);
      return false;
    }
  } catch {
    openAiHub(hubDetail);
    return false;
  }
  await onAllowed();
  invalidateAiAccessCache();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tb:ai-credits-refresh'));
  }
  return true;
}
