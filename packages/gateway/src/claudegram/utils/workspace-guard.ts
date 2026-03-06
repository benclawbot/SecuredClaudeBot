import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';

export function getWorkspaceRoot(): string {
  const root = config.WORKSPACE_DIR || process.env.HOME || process.cwd();
  return path.resolve(root);
}

/**
 * Check if target path is within root directory.
 * Uses realpathSync to resolve symlinks and prevent symlink-based traversal.
 */
export function isPathWithinRoot(root: string, target: string): boolean {
  try {
    // Resolve symlinks to get actual paths
    const resolvedRoot = fs.realpathSync(root);
    let resolvedTarget: string;
    try {
      resolvedTarget = fs.realpathSync(target);
    } catch {
      // Target doesn't exist — just normalize the path
      resolvedTarget = path.resolve(target);
    }
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
  } catch {
    // Root doesn't exist — reject all paths
    return false;
  }
}

export function resolvePathWithinRoot(root: string, target: string): string | null {
  let resolved: string;
  try {
    resolved = fs.realpathSync(target);
  } catch {
    resolved = path.resolve(target);
  }
  if (!isPathWithinRoot(root, resolved)) {
    return null;
  }
  return resolved;
}
