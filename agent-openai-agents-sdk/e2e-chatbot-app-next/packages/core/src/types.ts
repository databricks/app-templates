import { z } from 'zod';
import type { InferUITool, LanguageModelUsage, UIMessage } from 'ai';

import type {
  DATABRICKS_TOOL_CALL_ID,
  DATABRICKS_TOOL_DEFINITION,
} from '@chat-template/ai-sdk-providers/tools';

const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ChatTools = {
  [K in typeof DATABRICKS_TOOL_CALL_ID]: InferUITool<
    typeof DATABRICKS_TOOL_DEFINITION
  >;
};

export type CustomUIDataTypes = {
  error: string;
  usage: LanguageModelUsage;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}

export type { VisibilityType } from '@chat-template/utils';
