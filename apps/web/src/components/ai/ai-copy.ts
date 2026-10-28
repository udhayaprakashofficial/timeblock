import type { AiHubTab } from './ai-events';

/** Problem-first copy — users should see the job, not a feature catalog. */
export const AI_JOB: Record<
  AiHubTab,
  { title: string; problem: string; cta: string }
> = {
  plan: {
    title: 'Build today’s plan',
    problem:
      'Empty queue or vague goals? AI suggests a realistic task list. You edit and approve before anything is saved.',
    cta: 'Suggest a plan',
  },
  dump: {
    title: 'Turn a messy list into tasks',
    problem:
      'Paste notes or a brain dump. AI splits them into clear tasks with times — nothing is added until you apply.',
    cta: 'Turn into tasks',
  },
  estimate: {
    title: 'How long will this take?',
    problem:
      'AI estimates minutes from your defaults and today’s history, then you can drop it into Add task.',
    cta: 'Get estimate',
  },
  prioritize: {
    title: 'Reorder your queue',
    problem:
      'Too many open tasks? AI suggests an impact-first order. Your queue only changes if you apply.',
    cta: 'Suggest order',
  },
  recover: {
    title: 'Get the day back on track',
    problem:
      'Running behind? AI proposes park, shorten, or reschedule moves. You pick which ones to apply.',
    cta: 'Suggest recovery',
  },
  coach: {
    title: 'Coaching from today’s evidence',
    problem:
      'A short, honest note grounded in what you planned vs logged — not generic hustle advice.',
    cta: 'Get coaching note',
  },
  focus: {
    title: 'What should I do next?',
    problem:
      'One focus line for your current block so you start instead of scrolling the queue.',
    cta: 'Get focus tip',
  },
  content: {
    title: 'Turn finished work into a post',
    problem:
      'Spotlight turns finished tasks into LinkedIn and X posts from your notes and minutes.',
    cta: 'Open Spotlight',
  },
};
