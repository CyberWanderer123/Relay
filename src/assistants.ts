/**
 * Assistants a respondent can open straight from a form. Each takes a prefilled message in its
 * new-chat URL; the person sees the message and sends it themselves. Any other assistant works by
 * copying the same message, or by reading /a/:id.
 */
export const ASSISTANTS = {
  claude: { name: "Claude", home: "https://claude.ai/new", prefill: (q: string) => `https://claude.ai/new?q=${q}` },
  chatgpt: { name: "ChatGPT", home: "https://chatgpt.com/", prefill: (q: string) => `https://chatgpt.com/?q=${q}` },
} as const;

export type AssistantId = keyof typeof ASSISTANTS;
export type Assistant = (typeof ASSISTANTS)[AssistantId];

export const findAssistant = (id: string): Assistant | undefined =>
  Object.hasOwn(ASSISTANTS, id) ? ASSISTANTS[id as AssistantId] : undefined;
