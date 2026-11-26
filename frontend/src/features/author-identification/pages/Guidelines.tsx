import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import RequireAccess from '../access/RequireAccess';
import { CONFIDENCE, skipLabel, SKIP_REASONS } from '../guidelines';
import { Trans } from 'react-i18next';
import { useT } from '../i18n';

const ROOT = '/author-identification';

/** The text the guidelines were opened from, if it is one of this tool's pages. */
function useFrom(): string | null {
  const [params] = useSearchParams();
  const from = params.get('from');
  return from?.startsWith(`${ROOT}/`) && !from.startsWith('//') ? from : null;
}

/**
 * The annotation guideline (Kaldan, 25 Nov 2026), as written, in the same order. Opened in
 * its own tab from a text; "Back to the text" closes that tab so the text is as it was left.
 */
export default function Guidelines() {
  const t = useT();
  const from = useFrom();
  // Opened from the tool in a new tab: closing it returns to the text, as it was left.
  const canClose = from != null && window.opener != null;
  return (
    <RequireAccess>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {canClose ? (
          <button type="button" onClick={() => window.close()} className="inline-flex cursor-pointer items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> {t('guide.backToText')}
          </button>
        ) : (
          <Link to={from ?? ROOT} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> {t(from ? 'guide.backToText' : 'common.myTexts')}
          </Link>
        )}
        <h1 className="mt-3 text-2xl font-semibold text-gray-900">{t('guide.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('guide.byline')}</p>

        <Section title={t('guide.section.who')}>
          <Rule n={1}>
            <Trans t={t} i18nKey="guide.r1" components={{ b: <b /> }} />
          </Rule>
          <Rule n={2}>
            <Trans t={t} i18nKey="guide.r2" components={{ b: <b /> }} />
          </Rule>
          <Rule n={3}>
            <Trans t={t} i18nKey="guide.r3" components={{ b: <b /> }} />
          </Rule>
          <Rule n={4}>
            <Trans t={t} i18nKey="guide.r4" components={{ b: <b /> }} />
            <Phrase>This person is named as the transcriber.</Phrase>
          </Rule>
          <Rule n={5}>{t('guide.r5')}</Rule>
          <Rule n={6}>
            <Trans t={t} i18nKey="guide.r6" components={{ b: <b /> }} />
            <Phrase>Duplicate of this author: [person ID]</Phrase>
          </Rule>
          <Rule n={7}>
            <Trans t={t} i18nKey="guide.r7" components={{ b: <b /> }} />
          </Rule>
          <Rule n={8}>
            <Trans t={t} i18nKey="guide.r8" components={{ b: <b /> }} />
          </Rule>
        </Section>

        <Section title={t('guide.section.confidence')}>
          <Rule n={9}>
            <Trans t={t} i18nKey="guide.r9" components={{ b: <b /> }} />
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {[
                { level: t('guide.high'), value: 5, text: t('guide.highText') },
                { level: t('guide.medium'), value: 3, text: t('guide.mediumText') },
                { level: t('guide.low'), value: 1, text: t('guide.lowText') },
              ].map((c) => (
                <div key={c.level} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-xs font-semibold text-white">{c.value}</span>
                    <span className="text-sm font-semibold text-gray-900">{c.level}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{c.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">{t('guide.between', { count: CONFIDENCE.length })}</p>
          </Rule>
          <Rule n={10}>{t('guide.r10')}</Rule>
        </Section>

        <Section title={t('guide.section.skip')}>
          <Rule n={11}>
            <Trans t={t} i18nKey="guide.r11" components={{ b: <b /> }} />
            <ul className="mt-2 space-y-1">
              {SKIP_REASONS.map((r) => (
                <li key={r.id} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800">
                  {skipLabel(r.id)}
                </li>
              ))}
            </ul>
          </Rule>
        </Section>
      </div>
    </RequireAccess>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <ol className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60">{children}</ol>
    </section>
  );
}

function Rule({ n, children }: Readonly<{ n: number; children: ReactNode }>) {
  return (
    <li className="flex gap-3 px-4 py-3 text-[15px] leading-relaxed text-gray-800">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-600 ring-1 ring-gray-200">
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

/** A note wording to use as is, with a button to copy it. */
function Phrase({ children }: Readonly<{ children: string }>) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the text can still be selected by hand */
    }
  };
  return (
    <span className="mt-1.5 flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5">
      <span className="min-w-0 flex-1 font-medium text-gray-900">{children}</span>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {t(copied ? 'common.copied' : 'common.copy')}
      </button>
    </span>
  );
}
