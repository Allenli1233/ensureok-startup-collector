/**
 * 漏斗埋点客户端 SDK —— 移植自 EnsureOK 主站 src/api/tracker.ts。
 *
 * 与主站的差异(跨域改造):
 *   - 事件 POST 到 apiUrl('/api/events')(可能是跨域的 EnsureOK 域名);
 *   - 去掉 credentials:'include'(跨域匿名口,不需要主站 cookie 身份);
 *   - unload 兜底改用 fetch(keepalive) 而非 sendBeacon —— sendBeacon 跨域发
 *     application/json 会被 CORS 拦(无法预检);keepalive fetch 复用已缓存的
 *     预检结果(交互期间 flush 早已预检过),unload 时能可靠发出。
 *
 * 设计原则(与主站一致):永不抛错 / 异步批量 flush / 无第三方依赖。
 * 调试:localStorage.setItem('bdl_tracker_debug', '1')。
 */
import { apiUrl } from './config';

export type TrackerEvent = {
  event: string;
  props?: Record<string, unknown>;
  ts?: string;
  session_id?: string;
};

const ENDPOINT = apiUrl('/api/events');
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 30;

let queue: TrackerEvent[] = [];
let flushTimer: number | null = null;
let inFlight = false;
let currentSessionId: string | null = null;

/** 给 tracker 设当前 session 标识 */
export function setTrackerSession(id: string | null) {
  currentSessionId = id;
}

function isDebug(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem('bdl_tracker_debug') === '1';
  } catch { return false; }
}

/** 记录一个事件 —— 同步入队,异步发送 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    queue.push({
      event,
      props,
      ts: new Date().toISOString(),
      session_id: currentSessionId ?? undefined,
    });
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[tracker]', event, props || '');
    }
    if (queue.length >= MAX_BATCH) {
      void flush();
    } else {
      scheduleFlush();
    }
  } catch { /* swallow */ }
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/** 主动触发一次 flush(页面切换、关键节点都可以调) */
export async function flush(): Promise<void> {
  if (inFlight || queue.length === 0) return;
  inFlight = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true, // 允许 unload 时仍能发出
    });
  } catch {
    // 失败重新塞回队列开头,下次再试(最多保留 200 条避免内存炸)
    if (queue.length < 200) queue.unshift(...batch);
  } finally {
    inFlight = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/** 注册 page unload 时的兜底 flush(跨域用 keepalive fetch,复用已缓存预检) */
export function installTrackerUnloadHook(): void {
  if (typeof window === 'undefined') return;
  const handler = () => { void flush(); };
  window.addEventListener('pagehide', handler);
  window.addEventListener('beforeunload', handler);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') handler();
  });
}
