import crypto from "node:crypto";

export type AiJobName = "customer-summary" | "reply-suggestions";
export type AiJobStatus = "completed" | "queued";

export interface AiJobResult<T> {
  jobId: string;
  status: AiJobStatus;
  result?: T;
}

export interface AiJobQueue {
  run<T>(name: AiJobName, payload: Record<string, unknown>, handler: () => Promise<T>): Promise<AiJobResult<T>>;
  close?(): Promise<void>;
}

export function createSyncAiJobQueue(): AiJobQueue {
  let sequence = 0;
  return {
    async run(_name, _payload, handler) {
      sequence += 1;
      return {
        jobId: `sync-ai-${sequence}`,
        status: "completed",
        result: await handler()
      };
    }
  };
}

export interface CreateBullMqAiJobQueueOptions {
  redisUrl: string;
  queueName?: string;
  waitForCompletion?: boolean;
  completionTimeoutMs?: number;
}

export async function createBullMqAiJobQueue(options: CreateBullMqAiJobQueueOptions): Promise<AiJobQueue> {
  const { Queue, QueueEvents, Worker } = await import("bullmq");
  const queueName = options.queueName || "wangwang-ai";
  const connection = redisConnectionFromUrl(options.redisUrl);
  const handlers = new Map<string, () => Promise<unknown>>();
  const queue = new Queue(queueName, { connection });
  const queueEvents = new QueueEvents(queueName, { connection });
  const worker = new Worker(
    queueName,
    async (job) => {
      const handler = handlers.get(String(job.id));
      if (!handler) throw new Error("ai_job_handler_not_found");
      try {
        return await handler();
      } finally {
        handlers.delete(String(job.id));
      }
    },
    { connection }
  );

  return {
    async run(name, payload, handler) {
      const jobId = crypto.randomUUID();
      handlers.set(jobId, handler);
      const job = await queue.add(name, payload, { jobId, removeOnComplete: 100, removeOnFail: 100 });
      if (!options.waitForCompletion) {
        return {
          jobId: String(job.id),
          status: "queued"
        };
      }

      const result = await job.waitUntilFinished(queueEvents, options.completionTimeoutMs || 30_000);
      return {
        jobId: String(job.id),
        status: "completed",
        result: result as Awaited<ReturnType<typeof handler>>
      };
    },
    async close() {
      await worker.close();
      await queueEvents.close();
      await queue.close();
    }
  };
}

export function redisConnectionFromUrl(redisUrl: string): Record<string, string | number> {
  const url = new URL(redisUrl);
  const connection: Record<string, string | number> = {
    host: url.hostname,
    port: Number(url.port || 6379)
  };
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, "");
  if (db) connection.db = Number(db);
  return connection;
}

export function publicAiJob<T>(job: AiJobResult<T>): { id: string; status: AiJobStatus } {
  return {
    id: job.jobId,
    status: job.status
  };
}
