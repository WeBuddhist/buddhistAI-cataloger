// SAMPLE DATA: one report, so the Duplicates page has something to show. The two persons are real
// BDRC records with the same name; nobody has checked whether they are the same person.
import type { DuplicateReport } from '../types';

export const SAMPLE_REPORT: DuplicateReport = {
  id: 'sample-report',
  persons: [
    { id: 'P10278', nameBo: 'འགྱུར་མེད་རྡོ་རྗེ', matchedName: null, dates: 'དུས་རབས་༢༠' },
    { id: 'P1KG11864', nameBo: 'འགྱུར་མེད་རྡོ་རྗེ', matchedName: null, dates: 'དུས་རབས་༢༠' },
  ],
  reason: 'Sample report: same name and same century, and neither has dates. Could be one person entered twice.',
  text: { id: 'sample-6', title: 'ཐུགས་ཐིག་བུམ་སྒྲུབ་ངག་བསྒྲིགས་བཞུགས།' },
  reportedBy: 'Sample annotator',
  reportedAt: '2026-11-24T06:00:00.000Z',
  decision: null,
};
