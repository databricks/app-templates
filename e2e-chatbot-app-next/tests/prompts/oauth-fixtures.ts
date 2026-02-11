import { generateUUID } from '@chat-template/core';
import { mockSSE } from '../helpers';

/**
 * OAuth error message format from Databricks.
 * This is the actual error returned when a tool requires OAuth but user hasn't authenticated.
 */
export const OAUTH_ERROR_MESSAGE = `Failed request to https://example.databricks.com/api/2.0/endpoint
Error: Credential for user identity('user@example.com') is not found for the connection 'slack_no_auth_per_user'. Please login first to the connection by visiting https://example.databricks.com/oauth/connect?connection_name=slack_no_auth_per_user`;

export const OAUTH_CONNECTION_NAME = 'slack_no_auth_per_user';
export const OAUTH_LOGIN_URL =
  'https://example.databricks.com/oauth/connect?connection_name=slack_no_auth_per_user';

/**
 * Stream parts for mocking a response that includes an OAuth error.
 * This simulates an agent making a tool call that fails due to missing OAuth credentials.
 */
export const OAUTH_ERROR_STREAM = {
  // The SSE events that the mock server should return
  responseSSE: [
    // Initial assistant content before tool call
    mockSSE({
      id: 'oauth-test-id',
      created: Date.now(),
      model: 'chat-model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: "I'll check Slack for you.",
          },
        },
      ],
    }),
    // Tool call delta - simulating agent calling a Slack tool
    mockSSE({
      id: 'oauth-test-id',
      created: Date.now(),
      model: 'chat-model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'tool-call-oauth-1',
                type: 'function',
                function: {
                  name: 'slack_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
          },
        },
      ],
    }),
    // Tool result with OAuth error
    mockSSE({
      id: 'oauth-test-id',
      created: Date.now(),
      model: 'chat-model',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            role: 'tool',
            tool_call_id: 'tool-call-oauth-1',
            content: OAUTH_ERROR_MESSAGE,
          },
        },
      ],
    }),
    'data: [DONE]',
  ],
};

/**
 * Test prompts for OAuth error scenarios
 */
export const OAUTH_TEST_PROMPTS = {
  TRIGGER_OAUTH_ERROR: {
    MESSAGE: {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      role: 'user' as const,
      content: 'Search slack for recent messages',
      parts: [{ type: 'text' as const, text: 'Search slack for recent messages' }],
    },
    OUTPUT_STREAM: OAUTH_ERROR_STREAM,
    EXPECTED: {
      connectionName: OAUTH_CONNECTION_NAME,
      loginUrl: OAUTH_LOGIN_URL,
      errorMessage: OAUTH_ERROR_MESSAGE,
    },
  },
};
