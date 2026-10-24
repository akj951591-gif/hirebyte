import { useEffect, useState } from 'react';
import { api, type InterviewStatus } from '@/api/client';
import { useAsync } from '@/api/client/useAsync';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Recruiter interview list with server-side search/status filtering. */
export function useInterviewList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const result = useAsync(
    (signal) => api.interviews.list({ search: debouncedSearch || undefined, status: status || undefined }, signal),
    [debouncedSearch, status],
  );
  return { ...result, search, setSearch, status, setStatus, isFiltered: Boolean(debouncedSearch || status) };
}
