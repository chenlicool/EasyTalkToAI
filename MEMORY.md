# 2026-06-12 16:29
时间：2026-06-12 16:29
目标：修复复杂组件（多 class 元素）选择时页面卡死的性能 bug
改动：
  - utils/selector.js: buildUniqueClassSelector 添加 MAX_ATTEMPTS=200 上限，防止组合爆炸（N=20 class → 100万次 querySelectorAll 卡死），超限 fallback 到 nth-child 路径
  - content/content.js: onMouseMove 添加 requestAnimationFrame 节流，确保每帧最多一次 updateHighlight 调用，消除 mousemove 高频触发导致的 reflow 堆积
当前：EasyTalk AI v1.0.4，复杂组件选择不再卡死，选择器引擎组合搜索有防护上限
禁止动：无
待办：需在真实 Chrome 扩展环境验证 5 条核心路径
回滚：回滚本时间段 selector.js 和 content.js 相关改动即可

# 2026-05-20 22:18
时间：2026-05-20 22:18
目标：提升复制其它站点样式时的稳定性，尤其是 SVG/icon 节点和剪贴板 fallback
改动：
  - content.js: 新增 getElementClassName/getElementChildren，仿写/捕获链路统一安全读取 class，避免 SVGAnimatedString 触发异常
  - content.js: copyToClipboard/fallbackCopy 检查真实复制结果；批量复制等成功后再显示 toast；Cmd/Ctrl+C 增强按键识别并阻断站点侧复制处理
当前：样式仿写失败时会显示错误提示，不再把 execCommand 失败误报为成功
禁止动：manifest.json permissions 结构 / 既有 action 协议
待办：需要在真实 Chrome 扩展环境补跑 5 条核心路径
回滚：回滚本时间段 content.js 相关稳定性补丁即可

# 2026-05-20 17:37
时间：2026-05-20 17:37
目标：选择元素时输出带上页面 URL，让 AI 知道精确的页面来源
改动：
  - content.js: extractElementData 新增 pageUrl/pageTitle 字段；toYAML/toMarkdown 输出增加 Page_URL/Page_Title；formatBatch 批量头部增加页面 URL；buildReplicatePrompt 增加 Page Context 段落
当前：EasyTalk AI v1.0.4，三种模式（识别/仿写/多选）均输出 pageUrl + pageTitle
禁止动：无
待办：无
回滚：无

# 2026-05-15 20:58
时间：2026-05-15 20:58
目标：Toast/Close 图标替换为 Lucide SVG + 选中颜色对齐主界面暗绿主题
改动：
  - content.js: 5 处 emoji 替换为 Lucide SVG（×→x, ✅→check, 📋→clipboard, →→arrow-right）+ 选中色盘改为绿主题配色
  - content.css: .es-sel-close 改用 flexbox 居中 SVG；toast 背景改为 #262626 + 黑边；es-hint 色改 #8BBF2F；es-icon/es-hint 增加 inline-flex + SVG 辅助类
当前：EasyTalk AI v1.0.4，Overlay/Toast 图标与颜色对齐 Popup 暗绿主题
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-15 19:00
时间：2026-05-15 19:00
目标：Launch prep — 重写 README + 新增文档 + assets 目录
改动：
  - README.md: 重写为产品页，含 Hero/Features/Usage/Privacy/FAQ 章节
  - PROMOTION.md: 新增，发布计划（渠道/文案/checklist）
  - STORE_LISTING.md: 新增，Chrome Web Store 文案
  - PRIVACY.md: 新增，隐私政策
  - RELEASE_CHECKLIST.md: 新增，上线检查清单
  - GITHUB_METADATA.md: 新增，仓库描述/topics 建议
  - assets/: 新建 screenshots/demo/store 目录 + README 说明
当前：EasyTalk AI v1.0.4，Launch preparation docs 就绪
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-15 17:04
时间：2026-05-15 17:04
目标：Popup UI 对齐 Paper 设计稿 — 绿色主题 + SVG 图标 + 胶囊按钮
改动：
  - popup.html: 💬 Logo 替换为 SVG 图标（渐变圆角矩形 + 绿色闪电图案），🎯 替换为 SVG 十字星/停止图标，JS 引用改为 getElementById
  - popup.css: 全部配色从蓝色系改为暗灰底+绿色主色(#96EA5C)，按钮绿色渐变 180deg，选项改为 9999px 胶囊 pill，弹体外框圆角 20px+黑边，字体统一 system-ui
  - popup.js: setActiveState 改用 SVG display 切换替代 emoji textContent，引用 iconCrosshair/iconStop 变量
当前：EasyTalk AI v1.0.4，Popup 视觉对齐 Paper 最终设计稿
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-15 16:21
时间：2026-05-15 16:21
目标：Tooltip 多行布局 + 光标跟随定位
改动：
  - content.css: es-row-styles 改为 flex-direction:column + 新增 es-subrow 行内 flex
  - content.js: tooltip 样式区拆为 4 行子区块（P/M → W/H/R → B → 颜色+字体），updateHighlight 接收 event 参数，tooltip 定位改为跟随鼠标光标而非元素左上角，底部出界时 clamped 在视口内
当前：EasyTalk AI v1.0.3，Tooltip 多行分区显示且不跑出屏幕
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-15 15:51
时间：2026-05-15 15:51
目标：Tooltip 增强 — 颜色色值 + W/H/R 标签
改动：
  - content.js: 新增 rgbToHex() helper（rgb → #hex），tooltip 第二行文字色/背景色块后追加 hex 色值
  - content.js: updateHighlight 新增 W（宽）H（高）标签显示元素像素尺寸 + R（圆角）标签（有圆角时才显示）
当前：EasyTalk AI v1.0.3，Tooltip 显示完整颜色色值和尺寸信息
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-15 10:36
时间：2026-05-15 10:36
目标：Box Model Style Inspector — hover 时可视化展示元素样式属性和盒模型
改动：
  - content.css: 新增 #elementsnap-bm-margin/padding 三层 box model（content-box + border-width 环形方案：margin 定位 border box + 紫色 dashed 边框向外延伸，padding 定位 content box + 绿色 dashed 边框向外延伸），修改 tooltip 支持双行布局（es-row/es-swatch/es-style-label/es-style-val），content overlay 圆角改 0
  - content.js: 新增 overlayPadding/overlayMargin 状态变量 + ensureUI/deactivate/activate/onMouseMove iframe 处理同步展示/隐藏 + updateHighlight 重写（getComputedStyle 解析盒模型数值 + 3 层 overlay 定位 + tooltip 双行 HTML 含色块/字体/背景色/边框/P/M 数值）+ setBoxOverlay/boxShorthand 辅助函数 + freeze/unfreeze 覆盖 box model overlay
当前：EasyTalk AI v1.0.2，Box Model Style Inspector 功能就绪
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-14 21:48
时间：2026-05-14 21:48
目标：Tooltip 支持按住 Alt 冻结并选中文字
改动：content.css 新增 .es-frozen 类（pointer-events:auto + user-select:text）+ content.js 新增 tooltipFrozen 状态 / onKeyUp 监听 / unfreezeTooltip 函数（共约 25 行）
当前：EasyTalk AI v1.0.1，Alt 键冻结 tooltip 功能就绪
禁止动：无
待办：无
回滚：无
约束：ES5 / 向内兼容

# 2026-05-14 14:00
时间：2026-05-14 14:00
目标：治理文件精简 + 架构文档重写
改动：删 12 个无用治理文件 → 保留 AGENTS.md / ARCHITECTURE.md / MEMORY.md / README.md
当前：EasyTalk AI v1.0.0，4 个治理文件 + 所有核心功能就绪
禁止动：manifest.json permissions / 消息协议 action 字段
待办：CHANGELOG 合并到 README 版本历史
回滚：无
约束：ES5 / Manifest V3 / 纯 JS

# 2026-05-14 13:39
时间：2026-05-14 13:39
目标：项目初始化 + AI 协作治理体系落地
改动：创建 AGENTS.md / SOUL.md / STACK.md / ARCHITECTURE.md / API.md / CHANGELOG.md / MEMORY.md / .rules/ / WORKFLOWS/
当前：EasyTalk AI Chrome 扩展 v1.0.0 开发完成，推送至 GitHub
禁止动：manifest.json
待办：无
回滚：无
约束：Manifest V3
