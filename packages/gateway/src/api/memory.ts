/**
 * Memory API endpoints for the dashboard.
 * Provides REST API for storing, recalling, and querying memories.
 */
import { Router, type Request, type Response } from "express";
import { createChildLogger } from "../logger/index.js";
import type { MemoryOrchestrator } from "../memory/agent/orchestrator.js";
import { verifyToken, type JwtPayload } from "../security/jwt.js";

const log = createChildLogger("api:memory");

/**
 * Create the memory API router.
 * @param memoryAgent The memory orchestrator instance
 * @param jwtSecret The JWT secret for authentication
 * @returns Express router with memory endpoints
 */
export function createMemoryRouter(
  memoryAgent: MemoryOrchestrator,
  jwtSecret: string
): Router {
  const router = Router();

  /**
   * Auth middleware to verify JWT and extract user ID.
   */
  const authenticate = (req: Request, res: Response, next: Function): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }

    const payload = verifyToken(token, jwtSecret);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    (req as Request & { user: JwtPayload }).user = payload;
    next();
  };

  /**
   * POST /api/memory - Store a memory
   * Body: { content: string, tags?: string[] }
   * Returns: { id: string }
   */
  router.post("/", authenticate, async (req: Request, res: Response) => {
    try {
      const { content, tags } = req.body;

      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "content is required and must be a string" });
        return;
      }

      const userId = (req as Request & { user: JwtPayload }).user.sub;
      const id = await memoryAgent.storeMemory(userId, content, tags);

      log.debug({ userId, id }, "Memory stored via API");
      res.status(201).json({ id });
    } catch (error) {
      log.error({ error }, "Failed to store memory");
      res.status(500).json({ error: "Failed to store memory" });
    }
  });

  /**
   * GET /api/memory?query=X - Recall memories
   * Query param: query (string)
   * Returns: { memories: RecallResult[] }
   */
  router.get("/", authenticate, async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string | undefined;

      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "query parameter is required" });
        return;
      }

      const userId = (req as Request & { user: JwtPayload }).user.sub;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const memories = await memoryAgent.recall(userId, query, limit);

      log.debug({ userId, query, count: memories.length }, "Memories recalled via API");
      res.json({ memories });
    } catch (error) {
      log.error({ error }, "Failed to recall memories");
      res.status(500).json({ error: "Failed to recall memories" });
    }
  });

  /**
   * POST /api/memory/query - Query with synthesis
   * Body: { question: string }
   * Returns: { answer: string, memories: [], insights: [] }
   */
  router.post("/query", authenticate, async (req: Request, res: Response) => {
    try {
      const { question } = req.body;

      if (!question || typeof question !== "string") {
        res.status(400).json({ error: "question is required and must be a string" });
        return;
      }

      const userId = (req as Request & { user: JwtPayload }).user.sub;
      const result = await memoryAgent.query(userId, question);

      log.debug({ userId, question }, "Memory query via API");
      res.json(result);
    } catch (error) {
      log.error({ error }, "Failed to query memories");
      res.status(500).json({ error: "Failed to query memories" });
    }
  });

  return router;
}
