import { spawn, ChildProcess } from 'child_process';

let caffeinateProcess: ChildProcess | null = null;

export function preventSleep(): void {
  if (process.platform !== 'darwin') {
    console.log('[Caffeinate] Not on macOS, skipping sleep prevention');
    return;
  }

  if (caffeinateProcess) {
    console.log('[Caffeinate] Already running');
    return;
  }

  try {
    // -d: prevent display sleep, -i: prevent idle sleep
    caffeinateProcess = spawn('caffeinate', ['-di'], {
      stdio: 'ignore',
      detached: true,
    });

    caffeinateProcess.unref();

    caffeinateProcess.on('error', (err) => {
      console.error('[Caffeinate] Error:', err.message);
      caffeinateProcess = null;
    });

    caffeinateProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.log('[Caffeinate] Exited with code:', code);
      }
      caffeinateProcess = null;
    });

    console.log('[Caffeinate] Preventing system sleep');
  } catch (error) {
    console.error('[Caffeinate] Failed to start:', error);
  }
}

export function allowSleep(): void {
  if (caffeinateProcess) {
    try {
      caffeinateProcess.kill();
    } catch {
      // Ignore errors when killing process
    }
    caffeinateProcess = null;
    console.log('[Caffeinate] Sleep prevention disabled');
  }
}

export function isPreventingSleep(): boolean {
  return caffeinateProcess !== null;
}
