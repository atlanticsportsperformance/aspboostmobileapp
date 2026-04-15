/**
 * Serialized fetch queue — processes requests one at a time.
 *
 * Background: on rapid day-switches in the workload screen, firing 4-5
 * concurrent PostgREST requests through RN's HTTP/2 connection wedges the
 * entire pool (first batch succeeds, every subsequent batch hangs forever,
 * even setTimeout-based abort races don't fire — JS event loop stalls).
 *
 * Serializing solves it: only one request is in flight at a time, so there's
 * no contention for the HTTP stream, and cancellation works cleanly.
 */

type QueueTask = () => Promise<void>;

let tail: Promise<void> = Promise.resolve();

export function queuedFetch(
  tag: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 6000,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const task: QueueTask = async () => {
      // CRITICAL: the task itself must race the timeout. If we only raced
      // the outer promise, a hung fetch would leave the task pending forever,
      // and `tail` would never advance — every subsequent queued request
      // would deadlock behind it. By racing inside the task, the task
      // resolves on timeout even if fetch itself never returns, letting the
      // queue drain.
      try {
        const res = await Promise.race<Response>([
          fetch(url, init),
          new Promise<Response>((_, rej) =>
            setTimeout(() => rej(new Error(`${tag} timeout`)), timeoutMs),
          ),
        ]);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    };
    tail = tail.then(task, task);
  });
}
