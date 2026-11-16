import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  listOutlinerDocuments,
  assignVolume,
  getAssignVolumeEligibility,
  type OutlinerDocumentListItem,
} from '@/api/outliner';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileText, Calendar, BarChart3, ScatterChart, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SimplePagination } from '@/components/ui/simple-pagination';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/useUser';
import { Progress } from '@/components/ui/progress';
import { formatDistanceToNow } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMyOutlinerGroups } from '@/hooks';

const OutlinerUpload: React.FC = () => {
  const {user}= useUser();
  const hasPermission = user?.permissions?.includes('outliner') && (user.role==='admin' || user.role==='reviewer' || user.role==='annotator');

  const userId = user?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const [titleSearch, setTitleSearch] = useState('');
  const [debouncedTitle, setDebouncedTitle] = useState('');
  const [includeStatuses, setIncludeStatuses] = useState<string[]>([]);
  const LIMIT = 10;
  const skip = (page - 1) * LIMIT;

  const prevDebouncedTitleRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const t = globalThis.setTimeout(() => setDebouncedTitle(titleSearch.trim()), 400);
    return () => globalThis.clearTimeout(t);
  }, [titleSearch]);

  useEffect(() => {
    if (prevDebouncedTitleRef.current === undefined) {
      prevDebouncedTitleRef.current = debouncedTitle;
      return;
    }
    if (prevDebouncedTitleRef.current !== debouncedTitle) {
      prevDebouncedTitleRef.current = debouncedTitle;
      if (page > 1) {
        const params = new URLSearchParams(searchParams);
        params.set('page', '1');
        setSearchParams(params);
      }
    }
  }, [debouncedTitle, page, searchParams, setSearchParams]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setSearchParams(params=>{
        params.set('page', String(newPage));
        return params;
      });
    },
    [ setSearchParams]
  );

  const { data: documents = [], isLoading: isLoadingDocuments } = useQuery<OutlinerDocumentListItem[]>({
    queryKey: ['outliner-documents', userId, page, LIMIT, debouncedTitle, includeStatuses],
    queryFn: () =>
      listOutlinerDocuments(
        userId,
        skip,
        LIMIT,
        false,
        debouncedTitle || undefined,
        includeStatuses.includes('approved'),
        includeStatuses.includes('skipped')
      ),
    enabled: !!userId,
    staleTime: 0,
  });

  const { data: assignEligibility } = useQuery<{ allowed: boolean }>({
    queryKey: ['outliner-assign-volume-eligibility', userId],
    queryFn: () => getAssignVolumeEligibility(),
    enabled: !!userId,
    staleTime: 0,
  });

  const canGoPrev = page > 1;
  const canGoNext = documents.length === LIMIT;

  useEffect(() => {
  if(user && !hasPermission){
    toast.error('You are not authorized to access this page');
    navigate('/');
  }
  }, [user, hasPermission, navigate]);


  const { data: myGroups = [], isLoading: isLoadingGroups } = useMyOutlinerGroups({ enabled: !!userId });
  const [chosenGroupId, setChosenGroupId] = useState<string>('');
  // One group: use it. Several: the user picks which batch to take work from.
  const assignGroupId = myGroups.length === 1 ? myGroups[0].id : chosenGroupId;

  const assignWorkMutation = useMutation({
    mutationFn: () => assignVolume(assignGroupId || undefined),
    onSuccess: (document) => {
      queryClient.invalidateQueries({ queryKey: ['outliner-documents', userId] });
      queryClient.invalidateQueries({ queryKey: ['outliner-assign-volume-eligibility', userId] });
      toast.success(`Work assigned successfully! Document: ${document.filename || document.id}`);
      // Navigate to the assigned document
      navigate(`/outliner/${document.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to assign work');
    },
  });

  const assignWork = () => {
    assignWorkMutation.mutate();
  };





  const handleDocumentClick = (documentId: string) => {
    navigate(`/outliner/${documentId}`);
  };

  const firstDocWithRejectionNotice = documents.find((doc) => doc.rejected_segment);
  const firstRejectedNotice = firstDocWithRejectionNotice?.rejected_segment;
  const rejectedLinkHref = firstRejectedNotice
    ? `/outliner/${firstRejectedNotice.document_id}?segmentId=${firstRejectedNotice.segment_id}`
    : null;
  const showRejectionResolvedMarker =
    (user?.role === 'reviewer' || user?.role === 'admin') && !!userId;

  const assignDisabled =
    assignWorkMutation.isPending ||
    !userId ||
    !assignEligibility?.allowed ||
    !assignGroupId;
   return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-gray-600 mb-2">Outliner Documents</h1>
            <div className="relative mt-4 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <Input
                type="search"
                placeholder="Search by document title…"
                value={titleSearch}
                onChange={(e) => setTitleSearch(e.target.value)}
                className="pl-9"
                aria-label="Search documents by title"
              />
            </div>
            <div className="mt-3 max-w-md">
              <p className="mb-1 block text-sm font-medium text-gray-500">
                Include statuses
              </p>
              <div className="flex items-center gap-4 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <label htmlFor="include-approved" className="flex items-center gap-2 text-gray-700">
                  <Checkbox
                    id="include-approved"
                    checked={includeStatuses.includes('approved')}
                    onCheckedChange={(checked) => {
                      const isChecked = checked === true;
                      setIncludeStatuses((prev) => {
                        const hasValue = prev.includes('approved');
                        if (isChecked && !hasValue) return [...prev, 'approved'];
                        if (!isChecked && hasValue) return prev.filter((value) => value !== 'approved');
                        return prev;
                      });
                    }}
                    aria-label="Include approved documents"
                  />
                  Approved
                </label>
                <label htmlFor="include-skipped" className="flex items-center gap-2 text-gray-700">
                  <Checkbox
                    id="include-skipped"
                    checked={includeStatuses.includes('skipped')}
                    onCheckedChange={(checked) => {
                      const isChecked = checked === true;
                      setIncludeStatuses((prev) => {
                        const hasValue = prev.includes('skipped');
                        if (isChecked && !hasValue) return [...prev, 'skipped'];
                        if (!isChecked && hasValue) return prev.filter((value) => value !== 'skipped');
                        return prev;
                      });
                    }}
                    aria-label="Include skipped documents"
                  />
                  Skipped
                </label>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button asChild variant="outline">
              <Link to="/outliner/my-stats">
                <ScatterChart className="mr-2 h-4 w-4" aria-hidden />
                My stats
              </Link>
            </Button>
            {!isLoadingGroups && myGroups.length === 0 && (
              <span className="text-sm text-amber-700">You are not in a group yet. Ask an admin to add you to one.</span>
            )}
            {myGroups.length === 1 && (
              <span className="text-sm text-gray-500">Group: {myGroups[0].name}</span>
            )}
            {myGroups.length > 1 && (
              <Select value={chosenGroupId} onValueChange={setChosenGroupId}>
                <SelectTrigger className="w-44" aria-label="Group to take work from">
                  <SelectValue placeholder="Choose group" />
                </SelectTrigger>
                <SelectContent>
                  {myGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={assignWork}
              disabled={assignDisabled}
            >
              {assignWorkMutation.isPending ? 'Assigning...' : 'Assign me a work'}
            </Button>

          </div>
        </div>

        
      {rejectedLinkHref && (
        <div className="mb-6 flex justify-end">
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Please review the rejected segments {' '}
              <Link to={rejectedLinkHref} className="text-sm text-blue-600 underline">fix them.</Link>
              </p>
        </div>
       )}
        {/* Documents List */}
        {isLoadingDocuments && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
              <p className="text-gray-600">Loading documents...</p>
            </div>
          </div>
        )}
        {!isLoadingDocuments && documents.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            {debouncedTitle ? (
              <p className="text-gray-600">No documents match your search.</p>
            ) : (
              <p>Get started by uploading your first document</p>
            )}
          </div>
        )}
        {!isLoadingDocuments && documents.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {(canGoPrev || canGoNext) && (
              <div className="flex justify-end p-3 border-b border-gray-200">
                <SimplePagination
                  canGoPrev={canGoPrev}
                  canGoNext={canGoNext}
                  onPrev={() => handlePageChange(page - 1)}
                  onNext={() => handlePageChange(page + 1)}
                  label={`Page ${page}`}
                  labelPosition="center"
                />
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">Document</TableHead>
                  <TableHead className="font-semibold">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => {
                  const isDeleted = doc.status === 'deleted';
                  // Approved documents open read-only, so the annotator can see the reviewer's changes.
                  const isActive =
                    doc.status === 'active' || doc.status === 'completed' || doc.status === 'approved';
                  const reviewerChanged = doc.reviewer_changed_segments ?? 0;
                  const checked_percentage = (doc.checked_segments || 0) / (doc.total_segments || 1) * 100;
                  const utcDate = new Date(doc.updated_at);
                  const timestamp = new Date(utcDate.getTime() + (5 * 60 + 30) * 60 * 1000);

                  const Icon=(status:string)=>{
                    switch(status){
                      case 'completed':
                        return <CheckCircle2 className="w-5 h-5 shrink-0 text-green-600" />;
                      case 'skipped':
                        return <FileText className="w-5 h-5 shrink-0 text-blue-600" />;
                      case 'approved':
                        return <CheckCircle2 className="w-5 h-5 shrink-0 text-blue-600" />;
                      case 'rejected':
                        return <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />;
                      default:
                        return <FileText className="w-5 h-5 shrink-0 text-blue-600" />;
                    }
                  }

                  return (
                  <TableRow
                    key={doc.id}
                    onClick={() => {
                      if (!isDeleted && isActive)  {
                        handleDocumentClick(doc.id);
                      }
                    }}
                   
                    className={`${isDeleted ||
                      !isActive ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'} transition-colors `}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-2 ">
                        <div className="flex items-center gap-3">
                          {Icon(doc.status || '')}
                          <div className="font-medium flex min-w-0 flex-col text-gray-900">
                            {doc.filename}
                          </div>
                          <p className='text-xs text-gray-500'
                          >
                          {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}

                          </p>
                          {doc.reviewer_id && (
                            <div
                              className="flex items-center gap-1.5 text-xs text-gray-500"
                              title="Assigned reviewer"
                            >
                              {doc.reviewer_user?.picture ? (
                                <img
                                  src={doc.reviewer_user.picture}
                                  alt=""
                                  className="h-4 w-4 rounded-full"
                                />
                              ) : null}
                              <span>
                                Reviewer:{' '}
                                {doc.reviewer_user?.name?.trim() || 'Assigned'}
                              </span>
                            </div>
                          )}
                          {doc.status === 'approved' && reviewerChanged > 0 && (
                            <span
                              className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                              title="Segments the reviewer split, merged or added. Open the document to see them."
                            >
                              {reviewerChanged} changed by reviewer
                            </span>
                          )}
                          {doc.rejected_segment && (
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 animate-bounce h-4 w-4 shrink-0 text-red-600" aria-hidden />
                                {doc.rejected_segment.reviewer_user?.picture && (
                                     <img src={doc.rejected_segment.reviewer_user.picture} alt="Reviewer" className="w-4 h-4 rounded-full" />
                                )}
                                {doc.rejected_segment.message ? (
                                  <p className="text-xs text-amber-900/90 line-clamp-3">{doc.rejected_segment.message}</p>
                                ) : null}
                            </div>
                        )}
                          {showRejectionResolvedMarker && doc.rejection_resolved && (
                            <div
                              className="flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900"
                              title="A reviewer-rejected segment was checked again by the annotator"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                              <span>Rejection resolved</span>
                            </div>
                          )}
                        </div>
                       
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-gray-400" />
                          <span
                            className="font-medium text-sm"
                            style={{
                              color:
                                (doc.checked_segments || 0) !== doc.total_segments
                                  ? 'red'
                                  : 'black',
                            }}
                          >
                            Checked: {doc.checked_segments || 0} / {doc.total_segments}
                          </span>
                     
                        </div>
                        
                        <div className='flex gap-2 items-center'>
                        <Progress value={checked_percentage} />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OutlinerUpload;
