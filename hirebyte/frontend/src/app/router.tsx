import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { CandidateSessionProvider, RecruiterAuthProvider } from '@/features/auth';
import { AppLayout, NotFoundPage, RouteErrorPage } from './AppLayout';
import { CandidateRouteGuard } from './CandidateRouteGuard';
import { RecruiterRouteGuard } from './RecruiterRouteGuard';
import { CandidateLoginPage } from '@/pages/candidate/CandidateLoginPage';
import { LobbyPage } from '@/pages/candidate/LobbyPage';
import { DeviceCheckPage } from '@/pages/candidate/DeviceCheckPage';
import { InterviewRoomPage } from '@/pages/candidate/InterviewRoomPage';
import { CompletionPage } from '@/pages/candidate/CompletionPage';
import { PhoneCameraPage } from '@/pages/candidate/PhoneCameraPage';
import { RecruiterLoginPage } from '@/pages/recruiter/RecruiterLoginPage';
import { RecruiterRegisterPage } from '@/pages/recruiter/RecruiterRegisterPage';
import { OverviewPage } from '@/pages/recruiter/OverviewPage';
import { HistoryPage } from '@/pages/recruiter/HistoryPage';
import { CreateInterviewPage } from '@/pages/recruiter/CreateInterviewPage';
import { MonitorPage } from '@/pages/recruiter/MonitorPage';
import { ReportPage } from '@/pages/recruiter/ReportPage';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/candidate/login" replace /> },
      { path: 'login', element: <Navigate to="/candidate/login" replace /> },
      // Opened on the candidate's phone from the QR code; authorised by the pairing/device token, not a cookie.
      { path: 'pair', element: <PhoneCameraPage /> },

      // Workstream A — candidate experience. Only candidate-safe endpoints are used under here.
      {
        path: 'candidate',
        element: (
          <CandidateSessionProvider>
            <Outlet />
          </CandidateSessionProvider>
        ),
        children: [
          { index: true, element: <Navigate to="login" replace /> },
          { path: 'login', element: <CandidateLoginPage /> },
          {
            element: <CandidateRouteGuard />,
            children: [
              { path: 'lobby', element: <LobbyPage /> },
              { path: 'device-check', element: <DeviceCheckPage /> },
              { path: 'interview', element: <InterviewRoomPage /> },
              { path: 'complete', element: <CompletionPage /> },
            ],
          },
        ],
      },

      // Workstream B — recruiter dashboard.
      {
        path: 'recruiter',
        element: (
          <RecruiterAuthProvider>
            <Outlet />
          </RecruiterAuthProvider>
        ),
        children: [
          { path: 'login', element: <RecruiterLoginPage /> },
          { path: 'register', element: <RecruiterRegisterPage /> },
          {
            element: <RecruiterRouteGuard />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'interviews', element: <HistoryPage /> },
              { path: 'interviews/new', element: <CreateInterviewPage /> },
              { path: 'interviews/:id/setup', element: <CreateInterviewPage /> },
              { path: 'interviews/:id/monitor', element: <MonitorPage /> },
              { path: 'interviews/:id/report', element: <ReportPage /> },
            ],
          },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
