import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BookOpen, EllipsisVertical, Undo } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ExpandAllButton from "../ExpandAllButton";
import InstructionsDrawer from "../Instructions";
import { useActions, useDocument } from "../contexts";
import SkipMenuItem from "./SkipMenuItem";

function WorkSpaceHeaderMenu() {
    const { t } = useTranslation();
    const {onResetSegments,isAllSegmentsExpanded, toggleExpandAllSegments} = useActions();
    const { isReadOnly } = useDocument();
    const [instructionsOpen, setInstructionsOpen] = useState(false);
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <EllipsisVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setInstructionsOpen(true)}>
              <BookOpen />
              Instructions
            </DropdownMenuItem>
            {!isReadOnly && <SkipMenuItem />}
            {onResetSegments && (
              <DropdownMenuItem
                onClick={onResetSegments}
                className="text-red-600 hover:bg-red-50"
              >
                <Undo />
                {t('outliner.workspace.resetAllSegments')}
              </DropdownMenuItem>
            )}

            <ExpandAllButton isAllExpanded={isAllSegmentsExpanded} onToggleExpandAll={toggleExpandAllSegments}/>
          </DropdownMenuContent>
        </DropdownMenu>
        <InstructionsDrawer open={instructionsOpen} onOpenChange={setInstructionsOpen} />
      </>
    );
  }


export default WorkSpaceHeaderMenu;  