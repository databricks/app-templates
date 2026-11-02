import { createContext, useContext } from "react";
import type { CardData } from "../../config/actions";
import type { Model } from "../../lib/api-client";
import type { AgentChat } from "./use-agent-chat";

export const ChatContext = createContext<{ chat: AgentChat; cardData: CardData; models: Model[] } | null>(null);

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("Chat components must be rendered inside ChatContext.");
  return context;
}
