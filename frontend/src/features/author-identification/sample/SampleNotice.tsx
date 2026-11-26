import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { clearSampleReports } from '../api/duplicates';
import { clearSampleAnswers } from '../api/tasks';

const KINDS = {
  answers: {
    title: 'Trying out.',
    text: 'The texts are BDRC’s, but your answers stay in this browser for now and are not sent anywhere.',
    clearLabel: 'Clear my answers',
    clear: clearSampleAnswers,
    queryKey: ['author-identification', 'tasks'],
  },
  reports: {
    title: 'Sample reports.',
    text: 'For trying the tool only. You see one sample and the reports made in this browser, not those of other people.',
    clearLabel: 'Clear reports',
    clear: clearSampleReports,
    queryKey: ['author-identification', 'duplicates'],
  },
};

/** Says that the data is a sample, so nobody takes their work here for real work. */
export default function SampleNotice({ kind, canClear }: Readonly<{ kind: keyof typeof KINDS; canClear: boolean }>) {
  const { title, text, clearLabel, clear, queryKey } = KINDS[kind];
  const client = useQueryClient();
  const clearing = useMutation({ mutationFn: clear, onSuccess: () => client.invalidateQueries({ queryKey }) });

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span>
        <span className="font-semibold">{title}</span> {text}
      </span>
      {canClear && (
        <Button variant="outline" size="sm" className="cursor-pointer bg-white" disabled={clearing.isPending} onClick={() => clearing.mutate()}>
          {clearLabel}
        </Button>
      )}
    </div>
  );
}
