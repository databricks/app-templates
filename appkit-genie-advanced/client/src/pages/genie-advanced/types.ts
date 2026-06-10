export interface SpaceInfo {
  alias: string;
  space_id: string;
  title: string;
  description?: string;
  warehouse_id?: string;
  accessible: boolean;
  error?: string;
}

export interface ConversationSummary {
  conversation_id: string;
  title?: string;
  created_timestamp?: number;
  last_updated_timestamp?: number;
  user_id?: number;
}

export interface AttachmentQueryResult {
  statement_response?: {
    statement_id?: string;
    status?: { state?: string };
    manifest?: {
      schema?: {
        columns?: Array<{ name: string; type_text?: string; position?: number }>;
      };
      total_row_count?: number;
      truncated?: boolean;
    };
    result?: {
      data_array?: Array<Array<string | null>>;
      chunk_index?: number;
      row_count?: number;
      row_offset?: number;
    };
  };
}

export type FeedbackRating = 'POSITIVE' | 'NEGATIVE' | 'NONE';
