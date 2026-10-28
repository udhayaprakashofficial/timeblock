'use client';

import { useEffect, useState } from 'react';
import { AiHub } from './AiHub';
import {
  OPEN_AI_HUB_EVENT,
  type AiHubTab,
  type OpenAiHubDetail,
} from './ai-events';

type Props = {
  timeZone?: string | null;
};

/** Single app-level host — opened via openAiHub() from product flows. */
export function AiHubHost({ timeZone }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AiHubTab>('plan');
  const [seed, setSeed] = useState<OpenAiHubDetail>({});

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenAiHubDetail>).detail ?? {};
      setTab(detail.tab ?? 'plan');
      setSeed(detail);
      setOpen(true);
    };
    window.addEventListener(OPEN_AI_HUB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_AI_HUB_EVENT, onOpen);
  }, []);

  return (
    <AiHub
      open={open}
      onClose={() => {
        setOpen(false);
        setSeed({});
      }}
      timeZone={timeZone}
      initialTab={tab}
      /** Always one job when opened from product flow — not a feature catalog */
      singleJob
      seedEstimateName={seed.estimateName}
      seedDumpText={seed.dumpText}
      seedGoals={seed.goals}
    />
  );
}
