export interface SpawnOptions {
  captureOutput?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  errorMessagePrefix?: string;
}

export async function spawnWithOutput(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<string> {
  const { env, errorMessagePrefix = `${command} failed` } = options;
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${errorMessagePrefix} (exit code ${code}): ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function spawnWithInherit(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { env, cwd, errorMessagePrefix = `${command} failed` } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
      cwd,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${errorMessagePrefix} (exit code ${code})`));
      }
    });
  });
}
