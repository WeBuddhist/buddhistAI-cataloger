import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eye, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Progress } from '../ui/progress';
import { useOutlinerDocument } from '@/hooks/useOutlinerDocument';
import {  useDocument } from './contexts';

import WorkSpaceHeaderMenu from './workspace/WorkSpaceHeaderMenu';
import AIDetectionButton from './workspace/AIDetectionButton';
import ActionButton from './workspace/ActionButton';
import SanityCheckButton from './workspace/SanityCheckButton';




interface WorkspaceHeaderProps {
  /** Show / hide the right panel (images + table of contents). */
  tocPanel: {
    visible: boolean;
    onToggle: () => void;
  } | null;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  tocPanel,
}) => {
  const { t } = useTranslation();
  const { rejectedSegmentsCount,checked_percentage,checkedSegmentsCount,segmentsCount, isReadOnly } = useDocument();
  const { isBusy:isLoadingOrSaving} = useOutlinerDocument();

  return (
    <>
      {isReadOnly && (
        <div
          className="flex shrink-0 items-start gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 sm:px-6"
        >
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">{t('outliner.workspace.viewOnlyTitle')}</span>{' '}
            {t('outliner.workspace.viewOnlyHint')}
          </p>
        </div>
      )}
      <div className="bg-white border-b py-2 border-gray-200 px-3 sm:px-6 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
        <div className="flex items-center justify-between gap-3 min-w-max sm:min-w-0">
        <div className="shrink-0">
          <div className="flex items-center gap-2">
            {isLoadingOrSaving && (
              <span className="text-sm text-gray-600">{t('outliner.workspace.saving')}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {checkedSegmentsCount > 0 && (
              <>
                <Progress value={checked_percentage} title={t('outliner.workspace.savedSegmentsTitle', { count: checkedSegmentsCount })} className="w-32 sm:w-40 shrink-0"/>
                <span className="tabular-nums whitespace-nowrap">
                  {t('outliner.workspace.progressLabel', { percent: Math.round(checked_percentage), checked: checkedSegmentsCount, total: segmentsCount })}
                </span>
              </>
            )}
            {rejectedSegmentsCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 whitespace-nowrap">
                {t('outliner.workspace.revisionBadge', { count: rejectedSegmentsCount })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {!isReadOnly && <AIDetectionButton/>}
        <WorkSpaceHeaderMenu/>
        <SanityCheckButton/>
        {!isReadOnly && <ActionButton/>}
          {tocPanel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 px-2"
              onClick={tocPanel.onToggle}
              aria-pressed={tocPanel.visible}
              aria-label={
                tocPanel.visible
                  ? t('outliner.workspace.hideSidePanel')
                  : t('outliner.workspace.showSidePanel')
              }
              title={
                tocPanel.visible
                  ? t('outliner.workspace.hideSidePanel')
                  : t('outliner.workspace.showSidePanel')
              }
            >
              {tocPanel.visible ? (
                <PanelRightClose className="h-4 w-4" aria-hidden />
              ) : (
                <PanelRightOpen className="h-4 w-4" aria-hidden />
              )}
            </Button>
          )}
        </div>
        </div>
      </div>
    </>
  );
};
