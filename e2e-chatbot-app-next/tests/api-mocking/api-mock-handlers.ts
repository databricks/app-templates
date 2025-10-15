import { http, HttpResponse } from 'msw';
import { createMockStreamResponse } from '../helpers';
import { TEST_PROMPTS } from '../prompts/routes';

export const handlers = [
  // Mock chat completions
  http.post('*/serving-endpoints/chat/completions', async (req) => {
    const body = await req.request.clone().json();
    if ((body as any)?.stream) {
      return createMockStreamResponse(
        TEST_PROMPTS.SKY.OUTPUT_STREAM.responseSSE,
      );
    } else {
      return HttpResponse.json(TEST_PROMPTS.SKY.OUTPUT_TITLE.response);
    }
  }),
  // Mock fetching SCIM user
  http.get('*/api/2.0/preview/scim/v2/Me', () => {
    return HttpResponse.json({
      id: '123',
      userName: 'test-user',
      displayName: 'Test User',
      emails: [{ value: 'test@example.com', primary: true }],
    });
  }),
  // Mock fetching endpoint details
  http.get('*/api/2.0/serving-endpoints/*', () => {
    return HttpResponse.json({
      name: 'test-endpoint',
      task: 'llm/v1/chat', // mock fmapi for now
    });
  }),
  // Mock fetching oidc token
  http.post('*/oidc/v1/token', () => {
    return HttpResponse.json({
      access_token: 'test-token',
    });
  }),
];
