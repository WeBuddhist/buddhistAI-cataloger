import { Routes, Route, useLocation,Link, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';

import { Navigation, ProtectedRoute } from '@app';

import OutlinerAdminLayout from './features/outliner/components/OutlinerAdminLayout';
import LogoutPage from './pages/LogoutPage';
import useEnsureUserExists from './hooks/useEnsureUserExists';
import PostHogPageViewTracker from './PostHogPageViewTracker';
import ViewOnly from './pages/ViewOnly';

// Lazy load page components
// Texts and Persons are hidden from the Cataloger for now; routes commented out below.
// const TextsPage = lazy(() => import('./pages/Text'));
// const PersonsPage = lazy(() => import('./pages/Person'));
const TextInstances = lazy(() => import('./pages/TextInstances'));
const Instance = lazy(() => import('./pages/Instance'));
const Index = lazy(() => import('./pages/Index'));
const Create = lazy(() => import('./pages/Create'));
const CreateTranslation = lazy(() => import('./pages/CreateTranslation'));
const CreateCommentary = lazy(() => import('./pages/CreateCommentary'));
const UpdateAnnotation = lazy(() => import('./pages/UpdateAnnotation'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const AlignmentWorkstationLazy = lazy(() =>
  import('@/features/aligner').then((m) => ({ default: m.AlignmentWorkstation }))
);
const OutlineDashboardLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.Dashboard })));
// Batch list: kept for the admin dashboard; editors start straight at their own items.
// const DedupDashboardLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.Dashboard })));
const DedupQueueLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.Queue })));
const DedupReviewLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.Review })));
const DedupMyStatsLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.MyStats })));
const DedupAdjudicationQueueLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdjudicationQueue })));
const DedupPairViewLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.PairView })));
const DedupAdminLayoutLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.DedupAdminLayout })));
const DedupAdminOverviewLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminOverview })));
const DedupAdminAnnotatorsLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminAnnotators })));
const DedupAdminAnnotatorLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminAnnotator })));
const DedupAdminAdjudicatorLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminAdjudicator })));
const DedupAdminAdjudicationsLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminAdjudications })));
const DedupAdminUsersLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminUsers })));
const DedupAdminPairListLazy = lazy(() => import('@/features/dedup').then((m) => ({ default: m.AdminPairList })));
const OutlineFixQueueLazy = lazy(() => import('@/features/outline-fix').then((m) => ({ default: m.Queue })));
const OutlineFixWorkspaceLazy = lazy(() => import('@/features/outline-fix').then((m) => ({ default: m.Workspace })));
const OutlineFixAdminLazy = lazy(() => import('@/features/outline-fix').then((m) => ({ default: m.Admin })));
const OutlineFixAdminLayoutLazy = lazy(() => import('@/features/outline-fix').then((m) => ({ default: m.AdminLayout })));
const OutlineFixAdminUsersLazy = lazy(() => import('@/features/outline-fix').then((m) => ({ default: m.AdminUsers })));
const AuthorIdentificationQueueLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.Queue })));
const AuthorIdentificationWorkspaceLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.Workspace })));
const AuthorIdentificationGuidelinesLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.Guidelines })));
const AuthorIdentificationAdminLayoutLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.AdminLayout })));
const AuthorIdentificationAdminUsersLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.AdminUsers })));
const AuthorIdentificationAdminDuplicatesLazy = lazy(() => import('@/features/author-identification').then((m) => ({ default: m.AdminDuplicates })));
const OutlinerWorkspaceLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.Workspace })));
const OutlinerMyStatsLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.MyStats })));
const OutlinerAdminDashboardLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminDashboard })));
const OutlinerAdminDocumentLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminDocument })));
const OutlinerAdminSegmentLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminSegment })));
const OutlinerAdminUsersLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminUsers })));
const OutlinerAdminGroupsLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminGroups })));
const OutlinerAdminReviewerStatsLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminReviewerStats })));
const OutlinerAdminBDRCWorksLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminBDRCWorks })));
const OutlinerAdminBDRCPersonsLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminBDRCPersons })));
const OutlinerAdminStatisticsLazy = lazy(() => import('@/features/outliner').then((m) => ({ default: m.AdminStatistics })));





function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  useEnsureUserExists();
 
  return (

    <div className="min-h-screen w-full  relative text-gray-900">
  <div
    className="absolute inset-0 -z-10"
    style={{
      backgroundImage: `
        linear-gradient(to right, #e2e8f0 1px, transparent 1px),
        linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)
      `,
      backgroundSize: "20px 30px",
      WebkitMaskImage:
        "radial-gradient(ellipse 70% 60% at 50% 100%, #000 60%, transparent 100%)",
      maskImage:
        "radial-gradient(ellipse 70% 60% at 50% 100%, #000 60%, transparent 100%)",
    }}
  />


    <div className="h-screen overflow-auto  text-xl z-10"
      >

<PostHogPageViewTracker />

      {!isLoginPage && <Navigation/>}
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-gray-600">Loading...</div>
          </div>
        }>
          <Routes>
          <Route path="/" element={
              <Index />
          } />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/logout" element={<LogoutPage />} />
          <Route path="/profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } />
         
          <Route path="/create" element={
            <ProtectedRoute>
              <Create />
            </ProtectedRoute>
          }  />
          <Route path="/align/:sourceInstanceId/:targetInstanceId" element={
            <ProtectedRoute>
              <AlignmentWorkstationLazy />
            </ProtectedRoute>
          } />
          {/* Hidden for now: Texts and Persons are not shown in the Cataloger.
          <Route path="/texts" element={
            <ProtectedRoute>
              <TextsPage />
            </ProtectedRoute>
          } />
          <Route path="/persons" element={
            <ProtectedRoute>
              <PersonsPage />
            </ProtectedRoute>
          } />
          */}
          <Route path="/texts/:text_id/instances" element={
            <ProtectedRoute>
              <TextInstances />
            </ProtectedRoute>
          } />
          <Route path="/texts/:text_id/instances/:instance_id" element={
            <ProtectedRoute>
              <Instance />
            </ProtectedRoute>
          } />
          <Route path="/texts/:text_id/instances/:instance_id/translation" element={
            <ProtectedRoute>
              <CreateTranslation />
            </ProtectedRoute>
          } />
          <Route path="/texts/:text_id/instances/:instance_id/commentary" element={
            <ProtectedRoute>
              <CreateCommentary />
            </ProtectedRoute>
          } />
          <Route path="/texts/:text_id/instances/:instance_id/edit" element={
            <ProtectedRoute>
              <UpdateAnnotation />
            </ProtectedRoute>
          } />
          <Route path="/outliner" element={
            <ProtectedRoute>
              <OutlineDashboardLazy />
            </ProtectedRoute>
          } />
          {/* <Route path="/dedup/batches" element={
            <ProtectedRoute>
              <DedupDashboardLazy />
            </ProtectedRoute>
          } /> */}
          <Route path="/dedup" element={
            <ProtectedRoute>
              <DedupQueueLazy />
            </ProtectedRoute>
          } />
          <Route path="/dedup/my-stats" element={
            <ProtectedRoute>
              <DedupMyStatsLazy />
            </ProtectedRoute>
          } />
          <Route path="/dedup/item/:itemId" element={
            <ProtectedRoute>
              <DedupReviewLazy />
            </ProtectedRoute>
          } />
          <Route path="/dedup/pair/:itemId" element={
            <ProtectedRoute>
              <DedupPairViewLazy />
            </ProtectedRoute>
          } />
          <Route path="/dedup/adjudicate" element={
            <ProtectedRoute>
              <DedupAdjudicationQueueLazy />
            </ProtectedRoute>
          } />
          <Route path="/dedup/adjudicate/:itemId" element={
            <ProtectedRoute>
              <DedupReviewLazy mode="adjudicate" />
            </ProtectedRoute>
          } />
          <Route path="/outline-fix" element={
            <ProtectedRoute>
              <OutlineFixQueueLazy />
            </ProtectedRoute>
          } />
          <Route path="/outline-fix/work/:workId" element={
            <ProtectedRoute>
              <OutlineFixWorkspaceLazy />
            </ProtectedRoute>
          } />
          <Route path="/author-identification" element={
            <ProtectedRoute>
              <AuthorIdentificationQueueLazy />
            </ProtectedRoute>
          } />
          <Route path="/author-identification/guidelines" element={
            <ProtectedRoute>
              <AuthorIdentificationGuidelinesLazy />
            </ProtectedRoute>
          } />
          {/* Old one-part text addresses (before batches): back to the list. */}
          <Route path="/author-identification/:oldTextId" element={<Navigate to="/author-identification" replace />} />
          <Route path="/author-identification/:batchId/:itemId" element={
            <ProtectedRoute>
              <AuthorIdentificationWorkspaceLazy />
            </ProtectedRoute>
          } />
          <Route path="/author-identification-admin" element={<Navigate to="/author-identification-admin/users" replace />} />
          <Route path="/author-identification-admin/users" element={
            <ProtectedRoute>
              <AuthorIdentificationAdminLayoutLazy>
                <AuthorIdentificationAdminUsersLazy />
              </AuthorIdentificationAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/author-identification-admin/duplicates" element={
            <ProtectedRoute>
              <AuthorIdentificationAdminLayoutLazy>
                <AuthorIdentificationAdminDuplicatesLazy />
              </AuthorIdentificationAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/outline-fix-admin" element={
            <ProtectedRoute>
              <OutlineFixAdminLayoutLazy>
                <OutlineFixAdminLazy />
              </OutlineFixAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/outline-fix-admin/users" element={
            <ProtectedRoute>
              <OutlineFixAdminLayoutLazy>
                <OutlineFixAdminUsersLazy />
              </OutlineFixAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin" element={<Navigate to="/dedup-admin/overview" replace />} />
          <Route path="/dedup-admin/overview" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminOverviewLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/annotators" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminAnnotatorsLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/adjudications" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminAdjudicationsLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/users" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminUsersLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/pairs" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminPairListLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          {/* Admins correct a pair on the answer screen; /dedup/pair/:id stays read-only for everyone. */}
          <Route path="/dedup-admin/pairs/:itemId" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy bare>
                <DedupReviewLazy mode="correct" />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/adjudicators/:userId" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminAdjudicatorLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          <Route path="/dedup-admin/annotators/:userId" element={
            <ProtectedRoute>
              <DedupAdminLayoutLazy>
                <DedupAdminAnnotatorLazy />
              </DedupAdminLayoutLazy>
            </ProtectedRoute>
          } />
          {/* Before /outliner/:documentId, or "my-stats" is captured as a document id. */}
          <Route path="/outliner/my-stats" element={
            <ProtectedRoute>
              <OutlinerMyStatsLazy />
            </ProtectedRoute>
          } />
          <Route path="/outliner/:documentId" element={
            <ProtectedRoute>
              <OutlinerWorkspaceLazy />
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin" element={
            <Navigate to="/outliner-admin/documents" replace />
          } />
          <Route path="/outliner-admin/statistics" element={
            <ProtectedRoute>
              <OutlinerAdminLayout>
                <OutlinerAdminStatisticsLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/overview" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminDashboardLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/reviewer-stats" element={
            <ProtectedRoute>
              <OutlinerAdminLayout>
                <OutlinerAdminReviewerStatsLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/documents" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminDocumentLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/documents/:documentId" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminSegmentLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/users" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminUsersLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/groups" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminGroupsLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
           <Route path="/outliner-admin/bdrc-library/works" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminBDRCWorksLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/outliner-admin/bdrc-library/persons" element={
            <ProtectedRoute>
              <OutlinerAdminLayout >
                <OutlinerAdminBDRCPersonsLazy />
              </OutlinerAdminLayout>
            </ProtectedRoute>
          } />

          <Route path="/outliner/documents/view" element={
            <ProtectedRoute>
                <ViewOnly />
                </ProtectedRoute>
          } />
        </Routes>
        </Suspense>
    </div>
    
   
  </div>

  );
}





export default App;