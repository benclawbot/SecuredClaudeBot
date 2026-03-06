/**
 * Unified Security Guard — single entry point for all security checks.
 * Integrates SSRF, path safety, binary allowlist, rate limiting, and audit.
 */
import { createChildLogger } from "../logger/index.js";
import { isUrlSafe } from "./ssrf.js";
import { isPathSafe } from "./path.js";
import { isBinaryAllowed } from "./binary.js";
import type { AuditLog } from "../logger/audit.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { SecurityConfig } from "../config/schema.js";

const log = createChildLogger("security:guard");

export interface SecurityGuardOpts {
  config: SecurityConfig;
  audit: AuditLog;
  rateLimiter: RateLimiter;
}

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Centralized security enforcement for all gateway operations.
 */
export class SecurityGuard {
  private config: SecurityConfig;
  private audit: AuditLog;
  private rateLimiter: RateLimiter;

  constructor(opts: SecurityGuardOpts) {
    this.config = opts.config;
    this.audit = opts.audit;
    this.rateLimiter = opts.rateLimiter;
    log.info("Security guard initialized");
  }

  /**
   * Check if a URL fetch is safe (SSRF protection).
   */
  checkUrl(url: string, actor: string): SecurityCheckResult {
    if (!isUrlSafe(url)) {
      this.audit.log({
        event: "security.ssrf_blocked",
        actor,
        detail: `Blocked SSRF attempt to ${url}`,
      });
      return { allowed: false, reason: `URL blocked: internal/private address` };
    }
    return { allowed: true };
  }

  /**
   * Check if a file path is within allowed roots.
   */
  checkPath(filePath: string, actor: string): SecurityCheckResult {
    if (!isPathSafe(filePath, this.config.shellAllowedPaths)) {
      this.audit.log({
        event: "security.path_traversal",
        actor,
        detail: `Blocked path traversal to ${filePath}`,
      });
      return {
        allowed: false,
        reason: `Path blocked: outside allowed roots`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if a binary/executable is on the allowlist.
   */
  checkBinary(command: string, actor: string): SecurityCheckResult {
    if (!isBinaryAllowed(command, this.config.binaryAllowlist)) {
      this.audit.log({
        event: "security.binary_blocked",
        actor,
        detail: `Blocked unauthorized binary: ${command}`,
      });
      return {
        allowed: false,
        reason: `Binary blocked: ${command} not on allowlist`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check rate limit for an actor.
   */
  checkRateLimit(actor: string): SecurityCheckResult {
    if (!this.rateLimiter.consume(actor)) {
      this.audit.log({
        event: "security.rate_limited",
        actor,
        detail: "Rate limit exceeded",
      });
      return { allowed: false, reason: "Rate limit exceeded" };
    }
    return { allowed: true };
  }

  /**
   * Full security check for a shell command.
   * Validates binary allowlist + path safety.
   */
  checkShellCommand(
    command: string,
    args: string[],
    actor: string
  ): SecurityCheckResult {
    // Check binary
    const binaryCheck = this.checkBinary(command, actor);
    if (!binaryCheck.allowed) return binaryCheck;

    // Check any file path arguments against allowed roots
    for (const arg of args) {
      // Only validate args that look like paths (contain / or \)
      if (arg.includes("/") || arg.includes("\\")) {
        const pathCheck = this.checkPath(arg, actor);
        if (!pathCheck.allowed) return pathCheck;
      }
    }

    return { allowed: true };
  }

  /**
   * Sanitize user input to prevent injection attacks.
   * Strips null bytes, control characters (except newline/tab), and
   * excessive whitespace.
   */
  sanitizeInput(input: string): string {
    return input
      // Remove null bytes
      .replace(/\0/g, "")
      // Remove control characters except \n and \t
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Collapse excessive newlines (max 3 consecutive)
      .replace(/\n{4,}/g, "\n\n\n")
      // Trim
      .trim();
  }

  /**
   * Validate and sanitize a chat message before processing.
   */
  validateChatMessage(
    content: string,
    actor: string
  ): SecurityCheckResult & { sanitized?: string } {
    // Rate limit
    const rlCheck = this.checkRateLimit(actor);
    if (!rlCheck.allowed) return rlCheck;

    // Empty check
    const sanitized = this.sanitizeInput(content);
    if (!sanitized) {
      return { allowed: false, reason: "Empty message after sanitization" };
    }

    // Max length (16KB for a single message)
    if (sanitized.length > 16384) {
      this.audit.log({
        event: "security.rate_limited",
        actor,
        detail: `Message too long: ${sanitized.length} chars`,
      });
      return { allowed: false, reason: "Message too long (max 16KB)" };
    }

    return { allowed: true, sanitized };
  }
}
