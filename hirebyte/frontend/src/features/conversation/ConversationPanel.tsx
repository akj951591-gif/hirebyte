import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircleQuestion, Send } from 'lucide-react';
import type { ConversationTurn } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { cn } from '@/components/cn';

/**
 * The interview as a conversation: what the AI interviewer said (greeting, replies, clarifications)
 * and what the candidate asked it. The candidate's answers themselves stay in the answer box.
 */
export function ConversationPanel({
  turns,
  canAsk,
  onAsk,
}: {
  turns: ConversationTurn[];
  /** False while the candidate is recording or the answer is saving. */
  canAsk: boolean;
  onAsk: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 2) return;
    setSending(true);
    setError(null);
    try {
      await onAsk(text);
      setMessage('');
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card space-y-3 p-5" aria-labelledby="conversation-heading">
      <h2 id="conversation-heading" className="flex items-center gap-2 font-semibold text-ink">
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        Conversation
      </h2>
      {turns.length > 0 && (
        <ol ref={listRef} className="max-h-64 space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {turns.map((turn) => (
            <li key={turn.id} className={cn('flex', turn.role === 'CANDIDATE' && 'justify-end')}>
              <p
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  turn.role === 'INTERVIEWER' ? 'bg-surface-muted text-ink' : 'bg-brand-soft text-brand-strong',
                )}
              >
                <span className="block text-xs font-semibold opacity-70">{turn.role === 'INTERVIEWER' ? 'Interviewer' : 'You'}</span>
                {turn.text}
              </p>
            </li>
          ))}
        </ol>
      )}
      {error && <Alert tone="warning">{error}</Alert>}
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="ask-interviewer" className="sr-only">
          Ask the interviewer about this question
        </label>
        <input
          id="ask-interviewer"
          className="input flex-1"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the interviewer, e.g. “Could you rephrase that?”"
          disabled={!canAsk || sending}
        />
        <Button type="submit" variant="secondary" loading={sending} disabled={!canAsk || message.trim().length < 2} icon={<Send className="h-4 w-4" aria-hidden />}>
          Ask
        </Button>
      </form>
      <p className="text-xs text-ink-muted">The interviewer can repeat or explain the question, but will not give you the answer.</p>
    </section>
  );
}
