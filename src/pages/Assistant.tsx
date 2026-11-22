import { useEffect, useRef, useState } from "react";
import { askAssistant, isAssistantError, type ChatTurn } from "../lib/aiClient";
import { useAuth } from "../lib/auth";

interface Bubble {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS: string[] = [
  "Where did most of my money go this month?",
  "Am I spending too much on food?",
  "How much have I spent this month?",
  "What expenses should I review?",
  "How can I save more before payday?",
];

const QUICK_TASKS: Array<{ id: "insights" | "recommendations"; label: string; prompt: string }> = [
  {
    id: "insights",
    label: "Spending insights",
    prompt:
      "Give me a quick summary of my spending this month: the biggest categories, how this month compares to last month, and anything notable.",
  },
  {
    id: "recommendations",
    label: "Budget & savings ideas",
    prompt:
      "Based on my budgets and this month's spending, suggest practical budget adjustments or ways I could save before payday, and explain your reasoning.",
  },
];

export default function Assistant() {
  const { profile } = useAuth();
  const firstName = profile?.display_name?.trim().split(/\s+/)[0];

  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, sending]);

  async function send(rawMessage: string) {
    const message = rawMessage.trim();
    if (message.length === 0 || sending) {
      return;
    }
    setError(null);
    setInput("");
    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);
    setSending(true);
    const result = await askAssistant(message, history);
    setSending(false);
    if (isAssistantError(result)) {
      setError(result.error);
      setMessages((prev) => prev.slice(0, -1)); // drop the empty assistant bubble
      return;
    }
    setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: result.reply }]);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function retry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setMessages((prev) => {
        const index = prev.map((m) => m.role).lastIndexOf("user");
        return index >= 0 ? prev.slice(0, index) : prev;
      });
      void send(lastUser.content);
    }
  }

  const hasConversation = messages.length > 0;

  return (
    <div className="dashboard-grid assistant-page">
      <div className="tx-page-head">
        <h1>AI Assistant</h1>
        <span className="forecast-estimate-badge">AI-generated — grounded in your records, not financial advice</span>
      </div>

      {!hasConversation && (
        <div className="card assistant-intro">
          <h2>{firstName ? `Hi ${firstName}, how can I help?` : "How can I help?"}</h2>
          <p>
            Ask about your spending, budgets, bills, or your payday estimate. I can only read your records — I never
            change anything. Your data stays yours: only summary numbers needed for an answer are used.
          </p>
        </div>
      )}

      {hasConversation && (
        <div className="card assistant-thread" ref={listRef} aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`assistant-message ${message.role}`}>
              <span className="assistant-message-author">{message.role === "user" ? "You" : "AI Assistant"}</span>
              <div className="assistant-message-body">{message.content}</div>
            </div>
          ))}
          {sending && (
            <div className="assistant-message assistant">
              <span className="assistant-message-author">AI Assistant</span>
              <div className="assistant-message-body assistant-typing" role="status" aria-label="Assistant is thinking">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-error assistant-error" role="alert">
          <span>{error}</span>
          <button className="button button-secondary button-small" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {!hasConversation && (
        <>
          <div className="assistant-quick-row">
            {QUICK_TASKS.map((task) => (
              <button
                key={task.id}
                className="card assistant-quick-card"
                onClick={() => void send(task.prompt)}
                disabled={sending}
              >
                <strong>{task.label}</strong>
                <span>
                  {task.id === "insights"
                    ? "See where your money went this month."
                    : "Get practical budget and savings suggestions."}
                </span>
              </button>
            ))}
          </div>
          <div className="card">
            <h2>Try asking</h2>
            <div className="assistant-suggestions">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button key={prompt} className="assistant-suggestion" onClick={() => void send(prompt)} disabled={sending}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <form className="card assistant-composer" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor="assistant-input">
          Ask the AI assistant about your budget
        </label>
        <textarea
          id="assistant-input"
          className="input assistant-input"
          rows={2}
          maxLength={2000}
          placeholder="Ask about your spending, budgets, or payday estimate…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          disabled={sending}
        />
        <button className="button button-primary" type="submit" disabled={sending || input.trim().length === 0}>
          {sending ? "Thinking…" : "Send"}
        </button>
      </form>

      <p className="section-note">
        Responses are AI-generated and labelled as such. They are general budgeting help based on your recorded data —
        not professional financial, tax, or investment advice. Estimates are not guaranteed. To change any record, use
        the Transactions, Budgets, or Bills pages; the assistant cannot change anything for you.
      </p>
    </div>
  );
}
