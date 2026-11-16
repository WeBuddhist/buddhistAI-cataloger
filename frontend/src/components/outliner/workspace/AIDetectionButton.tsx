import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActions, useDocument } from '@/features/outliner/contexts'
import { useOutlinerDocument } from '@/hooks/useOutlinerDocument'
import type { OutlineDetector } from '@/api/outliner'
import { ChevronDown, Loader2, Sparkles, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function AIDetectionButton() {
  const { t } = useTranslation();
  const { aiTextEndingLoading } = useDocument()
  const { documentId, isBusy: isLoadingOrSaving } = useOutlinerDocument();

  const {
    onAIDetectTextEndings,
    onAITextEndingStop,
  } = useActions()
  const disableAIButton = isLoadingOrSaving || aiTextEndingLoading || !documentId;

  const runDetection = (detector: OutlineDetector) => {
    onAIDetectTextEndings(detector)
  }

  return (
    <div className="flex items-center gap-2">
      {aiTextEndingLoading && (
        <Button
          variant="outline"
          onClick={onAITextEndingStop}
          className="px-3 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
          title={t('outliner.workspace.stopDetection')}
        >
          <Square className="w-4 h-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disableAIButton}
            title={t('outliner.workspace.aiOutlineTitle')}
            className="flex items-center gap-1.5"
          >
            {aiTextEndingLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('outliner.workspace.detecting')}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => runDetection('rule')}>
            {t('outliner.workspace.detectorRule')}
          </DropdownMenuItem>
          {/* Disabled: the Modal endpoint backing mmBERT has been suspended. */}
          <DropdownMenuItem disabled onClick={() => runDetection('mmbert')}>
            {t('outliner.workspace.detectorMmbert')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default AIDetectionButton
