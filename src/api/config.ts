/**
 * API 基址 —— 留资/埋点提交到 EnsureOK 现有服务(本 repo 只是纯前端采集器)。
 *
 * - 生产构建:VITE_API_BASE 编进产物(默认 https://ensureok.ai),跨域 POST,
 *   依赖 EnsureOK 侧对 /api/startup-leads 与 /api/events 开放的 CORS。
 * - 本地 dev:留空即用相对路径,vite proxy 把 /api 转发到线上,免 CORS。
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export const apiUrl = (path: string): string => `${API_BASE}${path}`;
