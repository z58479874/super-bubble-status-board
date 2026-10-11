# 超级泡泡岗位状态板 · 014 门店试运行版

GitHub Pages: https://z58479874.github.io/super-bubble-status-board/

`site/` 为014生产构建：统一中文显示、按安全/区域/人员/交接排序的总览、现场调度及员工本人任务页面。调度只复用既有受控RPC，安全岗不能走普通调岗。安全返岗保留013.4的有人交还和真实空岗补位两条路径。

浏览器仅使用公开publishable key。PIN不保存；运行时会话沿用sessionStorage。临时PIN仅在一次性弹窗显示。没有新增数据库迁移、没有修改业务RPC、没有Realtime或服务端代理。

页面每5秒读取，近期跨页结果复用，后台暂停、回到前台立即刷新；写成功立即重读。页面采用相对资源路径，适配`/super-bubble-status-board/`。

源代码、本地正式预览与模拟测试继续保留在原工作目录。本仓库不修改super-bubble-weekly-lite。
