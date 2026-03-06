import type { Query } from '@anthropic-ai/claude-agent-sdk';

type QueuedRequest<T> = {
  message: string;
  handler: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

const activeAbortControllers: Map<string, AbortController> = new Map();
const activeQueries: Map<string, Query> = new Map();
const pendingQueues: Map<string, Array<QueuedRequest<unknown>>> = new Map();
const processingFlags: Map<string, boolean> = new Map();
// Tracks chats where a cancel was initiated — checked by agent.ts to detect
// user-initiated cancellation without calling controller.abort() (which crashes the SDK).
const cancelledChats: Set<string> = new Set();

export function getAbortController(sessionKey: string): AbortController | undefined {
  return activeAbortControllers.get(sessionKey);
}

export function setAbortController(sessionKey: string, controller: AbortController): void {
  activeAbortControllers.set(sessionKey, controller);
}

export function clearAbortController(sessionKey: string): void {
  activeAbortControllers.delete(sessionKey);
}

export function setActiveQuery(sessionKey: string, q: Query): void {
  activeQueries.set(sessionKey, q);
}

export function clearActiveQuery(sessionKey: string): void {
  activeQueries.delete(sessionKey);
}

export function isCancelled(sessionKey: string): boolean {
  return cancelledChats.has(sessionKey);
}

export function clearCancelled(sessionKey: string): void {
  cancelledChats.delete(sessionKey);
}

export function isProcessing(sessionKey: string): boolean {
  return processingFlags.get(sessionKey) === true;
}

export function getQueuePosition(sessionKey: string): number {
  const queue = pendingQueues.get(sessionKey);
  return queue ? queue.length : 0;
}

export async function queueRequest<T>(
  sessionKey: string,
  message: string,
  handler: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request: QueuedRequest<T> = {
      message,
      handler,
      resolve: resolve as (value: unknown) => void,
      reject,
    };

    let queue = pendingQueues.get(sessionKey);
    if (!queue) {
      queue = [];
      pendingQueues.set(sessionKey, queue);
    }
    queue.push(request as QueuedRequest<unknown>);

    processQueue(sessionKey);
  });
}

async function processQueue(sessionKey: string): Promise<void> {
  if (processingFlags.get(sessionKey)) {
    return;
  }

  const queue = pendingQueues.get(sessionKey);
  if (!queue || queue.length === 0) {
    return;
  }

  processingFlags.set(sessionKey, true);
  const request = queue.shift()!;

  try {
    const result = await request.handler();
    request.resolve(result);
  } catch (error) {
    request.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    processingFlags.set(sessionKey, false);
    clearAbortController(sessionKey);
    clearActiveQuery(sessionKey);
    clearCancelled(sessionKey);

    if (queue.length > 0) {
      processQueue(sessionKey);
    }
  }
}

/** Soft cancel: interrupt the running query but keep the session alive. */
export async function cancelRequest(sessionKey: string): Promise<boolean> {
  const q = activeQueries.get(sessionKey);

  if (q) {
    // Set the cancelled flag BEFORE interrupt so agent.ts can detect it
    // when the error_during_execution result arrives.
    // Do NOT call controller.abort() — that crashes the SDK subprocess.
    cancelledChats.add(sessionKey);
    try {
      await q.interrupt();
    } catch (err) {
      console.debug('[cancelRequest] interrupt() threw for chat', sessionKey, err);
    }
    clearActiveQuery(sessionKey);
    return true;
  }

  // Fallback to AbortController if no query stored
  const controller = activeAbortControllers.get(sessionKey);
  if (controller) {
    cancelledChats.add(sessionKey);
    controller.abort();
    clearAbortController(sessionKey);
    return true;
  }

  return false;
}

/** Soft reset: interrupt query + signal abort to fully tear down the session. */
export async function resetRequest(sessionKey: string): Promise<boolean> {
  const q = activeQueries.get(sessionKey);
  const controller = activeAbortControllers.get(sessionKey);

  if (q) {
    cancelledChats.add(sessionKey);
    try {
      await q.interrupt();
    } catch (err) {
      console.debug('[resetRequest] interrupt() threw for chat', sessionKey, err);
    }
    // Also abort controller to fully tear down
    if (controller) controller.abort();
    clearActiveQuery(sessionKey);
    clearAbortController(sessionKey);
    return true;
  }

  if (controller) {
    cancelledChats.add(sessionKey);
    controller.abort();
    clearAbortController(sessionKey);
    return true;
  }

  return false;
}

export function clearQueue(sessionKey: string): number {
  const queue = pendingQueues.get(sessionKey);
  if (!queue) return 0;

  const count = queue.length;
  for (const request of queue) {
    request.reject(new Error('Queue cleared'));
  }
  queue.length = 0;
  return count;
}
