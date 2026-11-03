/** Deduplicate public JSON downloads; cancellation belongs to each subscriber. */
type Snapshot = {body: string; headers: Headers; expires: number};
export function createSnapshotCache(transport: typeof fetch = fetch, clock = Date.now) {
  const saved = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<Snapshot>>();
  return async function snapshot(url: string, options: RequestInit = {}): Promise<Response> {
    const signal = options.signal;
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    let task: Promise<Snapshot>;
    const hit = saved.get(url);
    if (hit && hit.expires > clock()) task = Promise.resolve(hit);
    else {
      const inFlight = pending.get(url);
      if (inFlight) task = inFlight;
      else {
        task = (async () => {
          const response = await transport(url, {cache: 'no-cache', signal: AbortSignal.timeout(15_000)});
          if (!response.ok) throw new Error(`Snapshot unavailable (${response.status})`);
          const body = await response.text();
          JSON.parse(body); // Invalid responses must never poison the shared cache.
          const value = {body, headers: response.headers, expires: clock() + (/\/(odds|player_props|refresh_status)\.json$/.test(url) ? 60_000 : 300_000)};
          saved.delete(url); saved.set(url, value);
          if (saved.size > 24) saved.delete(saved.keys().next().value!);
          return value;
        })().finally(() => pending.delete(url));
        pending.set(url, task);
      }
    }
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException('Request aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, {once: true});
      task.then(value => {
        if (!signal?.aborted) resolve(new Response(value.body, {headers: value.headers}));
      }, reject).finally(() => signal?.removeEventListener('abort', abort));
    });
  };
}
export const fetchSnapshot = createSnapshotCache();
