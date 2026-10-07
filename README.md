# 超级泡泡岗位状态板 · 012 手机端只读版

GitHub Pages: https://z58479874.github.io/super-bubble-status-board/

`site/` 是经过本地构建和验证的 012 静态发布产物。页面使用 Supabase 浏览器可用的 publishable key，通过受控 RPC 登录和读取数据。真正的 PIN 与会话令牌只由运行时输入和 `sessionStorage` 保存，不属于仓库文件。

本仓库与 `super-bubble-weekly-lite` 无关。012 源代码和本地开发入口仍保留在原项目。更新发布产物时，从原项目执行 `node tools/build-pages-012.mjs`，验证后复制到本仓库的 `site/`，再提交。
