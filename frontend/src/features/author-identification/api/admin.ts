// The admins' overview: how far each batch is (BDRC's counts and ours), and each person's work.
import { request } from './tasks';

export interface BatchProgress {
  batch_id: string;
  note: string | null;
  created_at: string | null;
  /** From BDRC: texts in the batch, and those answered there. */
  total: number;
  done: number;
  /** Texts this tool has handed out of it. */
  handed_out: number;
  /** The batch "Assign work" hands texts out from. */
  current: boolean;
}

export interface PersonProgress {
  user_id: string;
  name: string | null;
  email: string;
  picture: string | null;
  role: string;
  given: number;
  in_progress: number;
  answered: number;
  skipped: number;
  minutes: number;
  last_activity: string | null;
}

export interface Overview {
  /** Oldest first; empty, with batch_error, when BDRC can't be reached. */
  batches: BatchProgress[];
  /** Current answers skipped: author_unknown, text_not_clean, text_not_cropped. */
  skipped_by_reason: Record<string, number>;
  /** Duplicate reports: to_check, same, different. */
  duplicates: { to_check: number; same: number; different: number };
  batch_error: string | null;
  totals: { handed_out: number; in_progress: number; answered: number; skipped: number; minutes: number };
  people: PersonProgress[];
}

export const fetchOverview = () => request<Overview>('/admin/overview');
