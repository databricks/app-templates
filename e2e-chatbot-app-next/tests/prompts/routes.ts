import { generateUUID } from '@/lib/utils';
import { mockFmapiSSE, mockFmapiResponseObject } from '../helpers';

export type TEST_NETWORK_COMMANDS = {
  DELAY?: number;
};

export const TEST_PROMPTS = {
  SKY: {
    MESSAGE: {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      role: 'user',
      content: 'Why is the sky blue?',
      parts: [{ type: 'text', text: 'Why is the sky blue?' }],
    },
    OUTPUT_TITLE: {
      response: mockFmapiResponseObject('Sky title'),
      expected: 'Sky title',
    },
    OUTPUT_STREAM: {
      responseSSE: [
        mockFmapiSSE('STATIC_ID', { role: 'assistant', content: "It's" }),
        mockFmapiSSE('STATIC_ID', { role: 'assistant', content: ' just' }),
        mockFmapiSSE('STATIC_ID', { role: 'assistant', content: ' blue' }),
        mockFmapiSSE('STATIC_ID', { role: 'assistant', content: ' duh!' }),
        'data: [DONE]',
      ],
      expectedSSE: [
        'data: {"type":"start","messageId":"STATIC_MESSAGE_ID"}',
        'data: {"type":"start-step"}',
        'data: {"type":"text-start","id":"STATIC_ID"}',
        'data: {"type":"text-delta","id":"STATIC_ID","delta":"It\'s"}',
        'data: {"type":"text-delta","id":"STATIC_ID","delta":" just"}',
        'data: {"type":"text-delta","id":"STATIC_ID","delta":" blue"}',
        'data: {"type":"text-delta","id":"STATIC_ID","delta":" duh!"}',
        'data: {"type":"text-end","id":"STATIC_ID"}',
        'data: {"type":"finish-step"}',
        'data: {"type":"finish"}',
        'data: [DONE]',
      ],
      expectedText: "It's just blue duh!",
    },
  },
  GRASS: {
    MESSAGE: {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      role: 'user',
      content: 'Why is grass green?',
      parts: [{ type: 'text', text: 'Why is grass green?' }],
    },
    OUTPUT_STREAM: [
      'data: {"type":"start-step"}',
      'data: {"type":"text-start","id":"STATIC_ID"}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"It\'s "}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"just "}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"green "}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"duh! "}',
      'data: {"type":"text-end","id":"STATIC_ID"}',
      'data: {"type":"finish-step"}',
      'data: {"type":"finish"}',
      'data: [DONE]',
    ],
  },
};
