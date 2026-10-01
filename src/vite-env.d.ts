/// <reference types="vite/client" />

/**
 * Vite 已通过 `vite/client` 提供了 `import.meta.env` 的类型（含 BASE_URL / MODE / DEV / PROD），
 * 这里只补充说明，不重复声明，避免与官方声明发生接口合并冲突。
 *
 * BASE_URL：部署基路径，用于 router basename 与 public/data 的相对定位。
 * 本地为 '/'，GH Pages 项目站点为 '/<repo>/'（由 CI 注入 VITE_BASE）。
 */
