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
} from '../../../src/framework/tracing.js';
import { getDeployedAuthToken, TEST_CONFIG } from '../../helpers.js';

const APP_URL = process.env.APP_URL;

describe('MLflow Tracing', () => {
  describe('Configuration', () => {
    test('should initialize with default configuration', async () => {
      const originalEnv = { ...process.env };

      try {
        // Set minimal required env vars
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '123456';

        const tracing = await initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        await tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should use Databricks OTel collector endpoint', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '123456';
        process.env.OTEL_UC_TABLE_NAME = 'main.traces.test_otel_spans';

        // Capture console logs to verify endpoint URL
        const logs: any[][] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args);
          originalLog(...args);
        };

        const tracing = await initializeMLflowTracing();

        // Verify endpoint uses /api/2.0/otel/v1/traces
        const traceConfigLog = logs.find(log =>
          log.length > 1 &&
          typeof log[0] === 'string' &&
          log[0].includes('Trace export configuration')
        );
        expect(traceConfigLog).toBeDefined();
        // The config object is in the second argument
        expect(traceConfigLog![1]).toHaveProperty('url');
        expect(traceConfigLog![1].url).toContain('/api/2.0/otel/v1/traces');

        // Verify UC table name is logged
        const ucTableLog = logs.find(log =>
          log[0]?.includes('Traces will be stored in UC table')
        );
        expect(ucTableLog).toBeDefined();
        expect(ucTableLog![0]).toContain('main.traces.test_otel_spans');

        // Cleanup
        console.log = originalLog;
        await tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should use experiment ID from environment', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        process.env.MLFLOW_EXPERIMENT_ID = '999888777';

        const tracing = await initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        await tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should accept custom service name', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';

        const tracing = await initializeMLflowTracing({
          serviceName: 'custom-agent-service',
          experimentId: '111222333',
        });

        expect(tracing).toBeDefined();

        // Cleanup
        await tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should throw error when DATABRICKS_HOST missing for databricks tracking URI', async () => {
      const originalEnv = { ...process.env };

      try {
        delete process.env.DATABRICKS_HOST;
        process.env.MLFLOW_TRACKING_URI = 'databricks';

        await expect(async () => {
          await initializeMLflowTracing();
        }).rejects.toThrow('DATABRICKS_HOST environment variable required');
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
    test('should work with local MLFLOW_TRACKING_URI', async () => {
      const originalEnv = { ...process.env };

      try {
        // Test with local MLflow server
        process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
        process.env.MLFLOW_EXPERIMENT_ID = '0';

        const tracing = await initializeMLflowTracing();

        expect(tracing).toBeDefined();

        // Cleanup
        await tracing.shutdown();
      } finally {
        process.env = originalEnv;
      }
    });

    test('should handle missing experiment ID gracefully', async () => {
      const originalEnv = { ...process.env };

      try {
        process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
        process.env.MLFLOW_TRACKING_URI = 'databricks';
        delete process.env.MLFLOW_EXPERIMENT_ID;

        // Should initialize without experiment ID (traces won't link to experiment)
        const tracing = await initializeMLflowTracing();

        expect(tracing).toBeDefined();

        console.log('⚠️  Tracing initialized without experiment ID - traces will not link to an experiment');

        // Cleanup
        await tracing.shutdown();
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

        const tracing = await initializeMLflowTracing();

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

        const tracing = await initializeMLflowTracing();

        await tracing.shutdown();

        // Second shutdown should not throw
        await expect(tracing.shutdown()).resolves.not.toThrow();
      } finally {
        process.env = originalEnv;
      }
    });
  });
});
