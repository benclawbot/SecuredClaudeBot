import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cache = new Map<string, string>();
const isWin = process.platform === 'win32';

/**
 * Check if a resolved path is a valid executable file.
 * Follows symlinks (required for Homebrew, snap, etc.).
 */
function isValidExecutable(filePath: string): boolean {
  try {
    const resolved = fs.realpathSync(filePath);
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) return false;
    if (!isWin && !(stats.mode & 0o111)) return false;
    return true;
  } catch {
    return false;
  }
}

function getSearchDirs(): string[] {
  const home = os.homedir();

  switch (process.platform) {
    case 'win32':
      return [];
    case 'darwin':
      return [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        path.join(home, '.local', 'bin'),
      ];
    default:
      return [
        path.join(home, '.local', 'bin'),
        '/usr/local/bin',
        '/usr/bin',
        '/snap/bin',
      ];
  }
}

const SEARCH_DIRS = getSearchDirs();

/**
 * Resolve a binary name to its full path.
 * Checks platform-specific install locations so execFile works under
 * systemd, launchd, and other environments with minimal PATH.
 */
export function resolveBin(name: string): string {
  // Reject names with path separators to prevent traversal
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`Invalid binary name: path separators not allowed`);
  }

  const cached = cache.get(name);
  if (cached) {
    if (isValidExecutable(cached)) {
      return cached;
    }
    cache.delete(name);
  }

  try {
    const cmd = isWin ? 'where' : 'which';
    const result = execFileSync(cmd, [name], { encoding: 'utf8', timeout: 3000 }).trim();
    const resolved = result.split(/\r?\n/)[0];
    if (resolved && isValidExecutable(resolved)) {
      cache.set(name, resolved);
      return resolved;
    }
  } catch {
    // Lookup failed or binary not found in PATH
  }

  for (const dir of SEARCH_DIRS) {
    const fullPath = path.join(dir, name);
    if (isValidExecutable(fullPath)) {
      cache.set(name, fullPath);
      return fullPath;
    }
  }

  // Fall back to bare name and let execFile resolve via PATH
  return name;
}
