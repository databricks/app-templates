import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local from the project root (takes precedence)
dotenv.config({ path: path.resolve(__dirname, '../..', '.env.local') });
// Also load .env as fallback
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });
