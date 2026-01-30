import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if running in test mode
const TEST_MODE = process.env.TEST_MODE;

if (!TEST_MODE) {
  dotenv.config({
    path: path.resolve(__dirname, '../..', '.env'),
  });
}
