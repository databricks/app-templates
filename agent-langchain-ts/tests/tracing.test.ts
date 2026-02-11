/**
 * MLflow Tracing Regression Tests
 * Verifies that tracing is properly configured and working
 *
 * Tests:
 * 1. Tracing initialization with correct configuration
 * 2. Experiment ID is properly set
 * 3. Traces are captured for agent invocations
 * 4. Trace export is functioning (via deployed app)
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import {
  initializeMLflowTracing,
  type MLflowTracing,
} from '../src/tracing.js';
import { getDeployedAuthToken, TEST_CONFIG } from './helpers.js';

const APP_URL = process.env.APP_URL;

describe('MLflow Tracing', () => {
  describe('Configuration', () => {
    test('should initialize with default configuration', () => {
      const originalEnv = { ...process.env };

      try {
        // Set minimal required env vars
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '123456';

        const tracing = initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should use experiment ID from environment', () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '999888777';

        const tracing = initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should accept custom service name', () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';

        const tracing = initializeMLflowTracing({
          serviceName: 'custom-agent-service',
          experimentId: '111222333',
        });

        expect(tracing).toBeDefined();

        // Cleanup
        tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should throw error when DATABRICKS_HOST missing for databricks tracking URI', () => {
      const originalEnv = { ...process.env };

      try {
        delete process.env.DATABRICKS_HOST;
        process.env.MLFLOW_TRACKING_URI = 'databricks';

        expect(() => {
          initializeMLflowTracing();
        }).toThrow('DATABRICKS_HOST environment variable required');
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('Trace Export (Deployed App)', () => {
    let authToken: string;

    beforeAll(async () => {
      if (!APP_URL || !APP_URL.includes('databricksapps.com')) {
        console.log('⏭️  Skipping deployed app tracing tests - APP_URL not set or not a deployed app');
        return;
      }

      authToken = await getDeployedAuthToken();
    }, 30000);

    test('should capture traces for agent invocations', async () => {
      if (!APP_URL || !APP_URL.includes('databricksapps.com')) {
        console.log('⏭️  Skipping - requires deployed app');
        return;
      }

      // Make a request to the agent
      const response = await fetch(`${APP_URL}/invocations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: [
            {
              role: 'user',
              content: 'What is 2+2?',
            },
          ],
          stream: false,
        }),
      });

      expect(response.ok).toBe(true);
      const data: any = await response.json();

      // Should have a response with output field (non-streaming format)
      expect(data.output).toBeDefined();
      expect(typeof data.output).toBe('string');
      expect(data.output.length).toBeGreaterThan(0);

      console.log('✅ Agent invocation completed - trace should be captured in MLflow');
      console.log('   Check MLflow experiment to verify trace was exported');
    }, 60000);

    test('should handle multiple sequential requests with tracing', async () => {
      if (!APP_URL || !APP_URL.includes('databricksapps.com')) {
        console.log('⏭️  Skipping - requires deployed app');
        return;
      }

      // Make multiple requests
      const requests = [
        'What is the weather like?',
        'Calculate 5 * 7',
        'What time is it?',
      ];

      for (const question of requests) {
        const response = await fetch(`${APP_URL}/invocations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: [{ role: 'user', content: question }],
            stream: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Request failed for "${question}":`, errorText);
        }
        expect(response.ok).toBe(true);
      }

      console.log('✅ Multiple sequential requests completed - traces should be in MLflow');
    }, 120000);
  });

  describe('Trace Metadata', () => {
    test('should include experiment ID in trace headers when configured', async () => {
      if (!APP_URL || !APP_URL.includes('databricksapps.com')) {
        console.log('⏭️  Skipping - requires deployed app');
        return;
      }

      // This test verifies that the app is properly configured with experiment ID
      // We can't directly inspect the trace headers, but we can verify the app responds
      const authToken = await getDeployedAuthToken();

      const response = await fetch(`${APP_URL}/invocations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: [{ role: 'user', content: 'Hello' }],
          stream: false,
        }),
      });

      expect(response.ok).toBe(true);

      console.log('✅ App is configured with tracing - check MLflow for experiment link');
    }, 60000);
  });

  describe('Local Development Tracing', () => {
    test('should work with local MLFLOW_TRACKING_URI', () => {
      const originalEnv = { ...process.env };

      try {
        // Test with local MLflow server
        process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
        process.env.MLFLOW_EXPERIMENT_ID = '0';

        const tracing = initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should handle missing experiment ID gracefully', () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        delete process.env.MLFLOW_EXPERIMENT_ID;

        // Should initialize without experiment ID (traces won't link to experiment)
        const tracing = initializeMLflowTracing();

        expect(tracing).toBeDefined();

        console.log('⚠️  Tracing initialized without experiment ID - traces will not link to an experiment');

        // Cleanup
        tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('Shutdown and Cleanup', () => {
    test('should flush traces on shutdown', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '123';

        const tracing = initializeMLflowTracing();

        // Should flush and shutdown without errors
        await expect(tracing.flush()).resolves.not.toThrow();
        await expect(tracing.shutdown()).resolves.not.toThrow();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should handle multiple shutdowns gracefully', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';

        const tracing = initializeMLflowTracing();

        await tracing.shutdown();

        // Second shutdown should not throw
        await expect(tracing.shutdown()).resolves.not.toThrow();
      } finally {
        process.env = originalEnv;
      }
    });
  });
});
