import { HOMER_MIN_TASK_NOTES } from '@timeblock/shared-types';

/** Finished task has usable notes for Homer (comments or career notes). */
export function taskHasHomerNotes(t: {
  notes?: string | null;
  careerResponsibility?: string | null;
  careerAchievement?: string | null;
  careerContribution?: string | null;
  careerOutcome?: string | null;
}): boolean {
  return Boolean(
    (t.notes ?? '').trim() ||
      (t.careerResponsibility ?? '').trim() ||
      (t.careerAchievement ?? '').trim() ||
      (t.careerContribution ?? '').trim() ||
      (t.careerOutcome ?? '').trim(),
  );
}

export { HOMER_MIN_TASK_NOTES };
