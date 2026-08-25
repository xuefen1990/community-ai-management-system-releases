# 更新检查按钮反馈实施计划

> 执行时遵循 `docs/superpowers/specs/2026-08-25-update-check-button-feedback-design.md`。

## 1. 补充行为测试

- 文件：`app/tests/renderer/update-ui.test.js`
- 先添加断言，要求更新按钮具备加载状态类、旋转图标、`try/finally` 收尾，以及恢复默认文案的逻辑。
- 运行该测试，确认在代码修改前失败。

## 2. 实现稳定的按钮状态切换

- 文件：`app/src/renderer/js/update-ui.js`
- 定义按钮默认内容与加载内容，使用小型辅助函数统一设置禁用状态、文字、图标和可访问状态。
- 将人工检查包装在 `try/finally` 中，保留现有结果提示；所有路径在 `finally` 恢复默认状态。

## 3. 添加交互样式

- 文件：`app/src/renderer/style.css`
- 为 `.sidebar-update-btn` 增加悬停、键盘焦点、按下和 `.is-checking` 状态；加载图标用 CSS 动画旋转。
- 用 `prefers-reduced-motion` 禁用旋转和位移。

## 4. 验证

- 运行 `node --test app/tests/renderer/update-ui.test.js`。
- 运行 `npm --prefix app test`。
- 检查差异与格式，确认仅改动本功能的代码、测试与方案文件。
