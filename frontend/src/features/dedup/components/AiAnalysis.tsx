import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LlmAnalysis } from '../api/review';
import { pct, verdictLabel } from '../utils';

// BDRC's AI reading of a pair (`evidence.llm_analysis`, newer batches only), shown under
// the shared-wording score to help the annotator. The summary comes in Tibetan and English:
// Tibetan first (English only when there is no Tibetan), with a button for the other;
// each model's reasoning is folded away.
export default function AiAnalysis({ analysis }: Readonly<{ analysis: LlmAnalysis }>) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<'bo' | 'en'>(analysis.summary_bo ? 'bo' : 'en');
  const summary = lang === 'bo' ? analysis.summary_bo : analysis.summary_en;
  const other = lang === 'bo' ? 'en' : 'bo';
  const hasOther = Boolean(other === 'bo' ? analysis.summary_bo : analysis.summary_en);
  const models = analysis.models ?? [];

  return (
    <div className="min-w-0 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-3 shadow-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Sparkles className="h-4 w-4 text-sky-700" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-sky-800">{t('dedup.evidence.ai.title')}</span>
        {analysis.verdict && (
          <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-sm font-medium text-gray-900">
            {verdictLabel(analysis.verdict)}
          </span>
        )}
        {analysis.agreement && (
          <span className="text-xs text-gray-600">
            {t(`dedup.evidence.ai.agreement.${analysis.agreement}`, { defaultValue: analysis.agreement })}
          </span>
        )}
        {hasOther && (
          <button
            type="button"
            onClick={() => setLang(other)}
            className="ml-auto cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
          >
            {t(`dedup.evidence.ai.showIn.${other}`)}
          </button>
        )}
      </div>

      {summary && (
        <p className={`mt-2 whitespace-pre-wrap break-words text-gray-800 ${lang === 'bo' ? 'font-monlam text-base leading-relaxed' : 'text-sm'}`}>
          {summary}
        </p>
      )}

      {models.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-sky-800 hover:text-sky-950">
            {t('dedup.evidence.ai.models', { count: models.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {models.map((m, i) => (
              <li key={`${m.model}-${i}`} className="min-w-0 break-words rounded bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-gray-500">{m.model}</span>
                  {m.label && <span className="font-medium text-gray-900">{verdictLabel(m.label)}</span>}
                  {m.confidence != null && (
                    <span className="text-xs tabular-nums text-gray-500">
                      {t('dedup.evidence.ai.confidence', { pct: pct(m.confidence) })}
                    </span>
                  )}
                  {m.rule && <span className="break-all font-mono text-[11px] text-gray-400">{m.rule}</span>}
                </div>
                {m.explanation && <p className="mt-1 text-gray-700">{m.explanation}</p>}
                {m.key_evidence && m.key_evidence.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-600 [overflow-wrap:anywhere]">
                    {m.key_evidence.map((e, k) => (
                      <li key={k}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
