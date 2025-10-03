#!/usr/bin/env tsx

import { getDatabricksToken } from '../databricks/auth/databricks-auth-node';

async function getToken() {
  try {
    const token = await getDatabricksToken();
    console.log(token);
  } catch (error) {
    console.error('Failed to get Databricks token:', error);
    process.exit(1);
  }
}

getToken().catch(console.error);
