'use server';
import { setupServer } from 'msw/node';
import { handlers } from './api-mock-handlers';

export const mockServer = setupServer(...handlers);
