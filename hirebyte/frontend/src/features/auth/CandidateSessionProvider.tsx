import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, type CandidateSessionView, type InterviewStatus } from '@/api/client';

/**
 * The candidate's scoped session token is an HttpOnly cookie set by POST /candidate/access.
 * Only the opaque session id is kept here (sessionStorage, this tab only) to build URLs.
 */
const STORAGE_KEY = 'hirebyte.candidateSessionId';

function readStoredId(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(STORAGE_KEY, id);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the session still works until the tab is closed
  }
}

interface CandidateSessionContextValue {
  sessionId: string | null;
  signIn: (invitationCode: string, accessCode: string) => Promise<CandidateSessionView>;
  signOut: () => Promise<void>;
  /** Forget the local session id without calling the API (e.g. after SESSION_EXPIRED). */
  forget: () => void;
}

const CandidateSessionContext = createContext<CandidateSessionContextValue | null>(null);

export function CandidateSessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(readStoredId);

  const signIn = useCallback(async (invitationCode: string, accessCode: string) => {
    const { sessionId: id } = await api.candidate.access({ invitationCode, accessCode });
    writeStoredId(id);
    setSessionId(id);
    return api.candidate.getSession(id);
  }, []);

  const forget = useCallback(() => {
    writeStoredId(null);
    setSessionId(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.candidate.logout();
    } finally {
      forget();
    }
  }, [forget]);

  const value = useMemo(() => ({ sessionId, signIn, signOut, forget }), [sessionId, signIn, signOut, forget]);
  return <CandidateSessionContext.Provider value={value}>{children}</CandidateSessionContext.Provider>;
}

export function useCandidateSession(): CandidateSessionContextValue {
  const ctx = useContext(CandidateSessionContext);
  if (!ctx) throw new Error('useCandidateSession must be used inside <CandidateSessionProvider>');
  return ctx;
}

/** Which candidate page matches the backend-reported state (backend is the source of truth). */
export function candidatePathFor(status: InterviewStatus, hasConsent: boolean): string {
  switch (status) {
    case 'IN_PROGRESS':
    case 'PROCESSING_ANSWER':
      return '/candidate/interview';
    case 'COMPLETED':
    case 'EVALUATING':
    case 'EVALUATED':
    case 'EVALUATION_FAILED':
    case 'REVIEWED':
      return '/candidate/complete';
    default:
      return hasConsent ? '/candidate/device-check' : '/candidate/lobby';
  }
}
