# 当前验收范围

本轮验证 DSH 能编排 Updream 创作画布，并在发送或生成之前核对输入。成片规划接受 110–118 秒（含两端）。可独立排演单个 5 秒镜头。Elsevier 查询、整片生成及画质评估等待后续指示。

| 环节 | 可复核的证据 |
| --- | --- |
| 平台计费和控件 | 登录后在“积分详情 → 积分计费表 → 视频模型”读取 MiniMax H3 的两档费率，并在无参考视频的 5 秒镜头核对报价。账户验收只创建画布、编辑草稿和选择参数。详见 [七类功能覆盖](../updream/CAPABILITIES.md) 和 [实际观察](../updream/authenticated-observations.json)。 |
| DSH 原生操作 | 在本机安装 Web 插件并选择项目，运行节点排演，修改并保存工作流。DSH 和离线 HTML 使用同一图编译器。原生接口的草稿写入需绑定到当前页面与具体编辑器。 |
| 跨环境实站往返 | 已注册的 DSH 原生工具发出一次 H3 草稿写入。操作方经已登录浏览器的受控接口传递请求并逐字读回，重试后 SQLite 中只有一条回执。[证据摘要](../updream/split-browser-observation.json) |
| 未验收项 | 登录状态下，由 DSH 原生模型端到端调用全部工具、上传与任务回执未被此记录覆盖。七类菜单的可见性不代表七类都已实现自动化。 |

MiniMax H3 输出每秒为 768P 50 积分、2K 85 积分，参考视频每秒另计同额。时长可选 5–15 秒。5 秒实报价分别为 250 和 425，本轮支出额度 0，总预算 100。未确认零碎参考时长的取整规则。真实提交一直关闭。

执行 `node tooling/xatp/e2e/live-gate.mjs preflight` 检查环境。 `XATP_DSH_ORIGIN` 接受不含令牌的 DSH 回环地址，`XATP_CDP_ENDPOINT` 指向受控 Chromium 的回环调试地址。探测只检查页面可见性与 DSH 登录挑战，`DEEPSEEK_API_KEY` 只记录是否存在。环境就绪时退出 0，缺少条件时退出 2。执行 `node tooling/xatp/e2e/live-gate.mjs live` 输出 [#11](https://github.com/KRPCT/dsh-XATP/issues/11) 的能力与预算边界，完整生产验收仍退出 2。两项命令均不触发计费。

## 已登录视频节点的原生检查

在运行目标 Chromium 的宿主使用已构建的 DSH 仓库与 Node 24.9+，先构建插件。将 `XATP_CDP_ENDPOINT` 设为该受控浏览器的 HTTP 回环调试地址。打开 Updream 创作画布并选中 MiniMax H3 视频节点。独立标签和 DSH Browser 内嵌画布均可，后者还需设置 `XATP_DSH_ORIGIN`。

```sh
node tooling/xatp/plugin/build.mjs
node tooling/xatp/e2e/h3-native-check.mjs
```

命令通过 DSH NativeExecutor 读取四种模式、当前选项、站内报价和草稿空闲状态。多张画布时，用 `XATP_TEST_UPDREAM_DRAFT_TAB` 指定原生 `xatp_list_tabs` 返回的页签。输出 JSON 仅含检查结果。状态 `checked` 只表示所列步骤通过，缺少端点或可验证页面时返回 `blocked` 并退出 2。

如需测试实际写入，选中验收用的空视频节点，设定 5 秒、768P，并显式指定上述页签。在命令尾加 `--write-empty` 后，只有站内报价恰好 250 且编辑器为空才会填入一条验收草稿，逐字回读并重试。运行结束后草稿保留在页面。非空编辑器返回 `existing_draft_preserved`。此路径不会发送或生成。

重新选中节点时，Updream 的报价可能晚于模型和参数更新。文生视频须等到页面显示值与该规格已核实的无参考费率一致，返回 `matched_no_reference_tariff`。持续不符返回 `quote_unconfirmed`，需要再核对站内计费表。其他模式的 `observed_only` 仅记录页面当时显示的数字，可能包含参考视频费用，命令退出 2，不能作为最低报价验收。
