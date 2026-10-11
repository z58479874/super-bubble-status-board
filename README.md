# 超级泡泡岗位状态板 · 013.4 安全岗返岗版

GitHub Pages: https://z58479874.github.io/super-bubble-status-board/

`site/` 是经过本地构建和验证的 013.4 静态发布产物。页面使用 Supabase 浏览器可用的 publishable key，通过已执行的受控 RPC 登录、读取和操作。安全岗返岗时，页面读取本人返岗岗位的真实占岗状态：有人顶岗走返岗交还，真实空岗且本人短离时走空岗补位。写 RPC 接受空成功响应，并立即重读当前视图。真正的 PIN 与会话令牌不属于仓库文件；会话令牌由运行时放在 `sessionStorage`，PIN 不会保存。

本仓库与 `super-bubble-weekly-lite` 无关。013 源代码和本地开发入口仍保留在原项目。更新发布产物时，从原项目执行 `node tools/build.mjs`，验证后复制到本仓库的 `site/`，再提交。

