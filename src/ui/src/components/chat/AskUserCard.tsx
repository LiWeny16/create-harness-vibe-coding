// AskUserCard.tsx — user_ask presentation. Questions with options render as
// selectable pills; free text is supported per question. Submitting sends a
// single chat:send with a structured prefix so the agent-side transcript stays
// machine-parseable: [ask:<requestId>] <question>: <answer> | ...
import { useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { useT } from '../../i18n';
import type { ChatAskRequest } from '../../hooks/useChatStream';

type Props = {
  request: ChatAskRequest;
  onAnswer: (requestId: string, messageText: string) => void;
};

export default function AskUserCard({ request, onAnswer }: Props) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const setAnswer = (index: number, value: string) => {
    if (submitted) return;
    setAnswers(current => ({ ...current, [index]: value }));
  };

  const submit = () => {
    if (submitted) return;
    const parts = request.questions.map((question, index) => {
      const label = String(question.question || `Q${index + 1}`);
      return `${label}: ${String(answers[index] ?? '').trim() || '-'}`;
    });
    setSubmitted(true);
    onAnswer(request.requestId, `[ask:${request.requestId}] ${parts.join(' | ')}`);
  };

  const allAnswered = request.questions.every((_, index) => String(answers[index] ?? '').trim().length > 0);

  return (
    <div
      className="chat-ask-card"
      data-testid="chat-ask-card"
      data-request-id={request.requestId}
      style={{
        border: '1px solid #bfdbfe',
        borderRadius: 'var(--radius)',
        background: '#eff6ff',
        padding: '7px 9px',
        display: 'grid',
        gap: 7,
        fontSize: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, color: '#1d4ed8' }}>
        <MessageCircleQuestion size={12} />
        <span>{t('Agent needs your input')}</span>
      </div>
      {request.questions.map((question, index) => (
        <div key={question.id || index} style={{ display: 'grid', gap: 5, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{String(question.question || `Q${index + 1}`)}</div>
          {Array.isArray(question.options) && question.options.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {question.options.map(option => {
                const active = answers[index] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    data-testid="chat-ask-option"
                    onClick={() => setAnswer(index, option)}
                    disabled={submitted}
                    aria-pressed={active ? 'true' : 'false'}
                    style={{
                      minHeight: 24,
                      padding: '2px 9px',
                      border: `1px solid ${active ? '#1d4ed8' : 'var(--border)'}`,
                      borderRadius: 999,
                      background: active ? '#dbeafe' : '#fff',
                      color: active ? '#1e3a8a' : 'var(--fg)',
                      fontSize: 11,
                      fontWeight: 700,
                      opacity: submitted ? 0.6 : 1,
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
          <input
            data-testid="chat-ask-free-text"
            value={answers[index] ?? ''}
            onChange={event => setAnswer(index, event.target.value)}
            disabled={submitted}
            placeholder={t('Or type a custom answer')}
            style={{ minHeight: 26, fontSize: 11 }}
          />
        </div>
      ))}
      <button
        type="button"
        data-testid="chat-ask-submit"
        onClick={submit}
        disabled={submitted || (!allAnswered && Object.keys(answers).length === 0)}
        style={{
          minHeight: 26,
          border: '1px solid #86efac',
          borderRadius: 'var(--radius)',
          background: '#fff',
          color: '#166534',
          fontSize: 11,
          fontWeight: 800,
          justifySelf: 'start',
          padding: '0 10px',
          opacity: submitted ? 0.55 : 1,
        }}
      >
        {submitted ? t('Answer sent') : t('Submit answer')}
      </button>
    </div>
  );
}
