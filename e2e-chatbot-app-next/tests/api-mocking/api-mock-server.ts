import { setupServer } from 'msw/node';
import { handlers } from './api-mock-handlers';

// Re-export test utilities so they use the same module instance as MSW handlers
export {
  getCapturedRequests,
  resetCapturedRequests,
  getLastCapturedRequest,
  setMockEndpointTask,
  getMockEndpointTask,
  resetMockEndpointTask,
} from './api-mock-handlers';

export const mockServer = setupServer(...handlers);
