import { supabase, supabaseUrl, supabaseKey } from "./supabase";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  reply: string;
  forecastAvailable: boolean;
}

export interface AssistantError {
  error: string;
}

export function isAssistantError(value: unknown): value is AssistantError {
  return typeof value === "object" && value !== null && typeof (value as AssistantError).error === "string";
}

// Calls the authenticated ai-assistant Edge Function with the user's session
// JWT. The function verifies the token server-side and derives identity from
// it; no user id is ever sent. The API key stays server-side.
export async function askAssistant(message: string, history: ChatTurn[]): Promise<AssistantReply | AssistantError> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      return { error: "Your session has ended. Please sign in again." };
    }
    const url = `${supabaseUrl}/functions/v1/ai-assistant`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify({ message, history: history.slice(-6) }),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      if (isAssistantError(body)) {
        return body;
      }
      if (response.status === 401) {
        return { error: "Your session has ended. Please sign in again." };
      }
      if (response.status === 429) {
        return { error: "You are sending messages too quickly. Please wait a minute and try again." };
      }
      return { error: "The assistant is temporarily unavailable. Please try again in a moment." };
    }
    if (typeof body !== "object" || body === null || typeof (body as AssistantReply).reply !== "string") {
      return { error: "The assistant returned an unexpected response. Please try again." };
    }
    const reply = (body as AssistantReply).reply;
    const forecastAvailable = (body as AssistantReply).forecastAvailable === true;
    return { reply, forecastAvailable };
  } catch {
    return { error: "Could not reach the assistant. Please check your connection and try again." };
  }
}
