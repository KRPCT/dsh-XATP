# 当前验收范围

本轮验证 DSH 能编排 Updream 创作画布，并在发送或生成之前核对输入。成片规划接受 110–118 秒（含两端）。可独立排演单个 5 秒镜头。Elsevier 查询、整片生成及画质评估等待后续指示。

| 环节 | 可复核的证据 |
| --- | --- |
| 平台计费和控件 | 登录后在“积分详情 → 积分计费表 → 视频模型”读取 MiniMax H3 的两档费率，并在无参考视频的 5 秒镜头核对报价。账户验收只创建画布、编辑草稿和选择参数。详见 [七类功能覆盖](../updream/CAPABILITIES.md) 和 [实际观察](../updream/authenticated-observations.json)。 |
| DSH 原生操作 | 在本机安装 Web 插件并选择项目，运行节点排演，修改并保存工作流。DSH 和离线 HTML 使用同一图编译器。原生接口的草稿写入需绑定到当前页面与具体编辑器。 |
| 未验收项 | 登录状态下，由 DSH 原生模型端到端调用全部工具、上传与任务回执未被此记录覆盖。七类菜单的可见性不代表七类都已实现自动化。 |

MiniMax H3 输出每秒为 768P 50 积分、2K 85 积分，参考视频每秒另计同额。时长可选 5–15 秒。5 秒实报价分别为 250 和 425，本轮支出额度 0，总预算 100。未确认零碎参考时长的取整规则。真实提交一直关闭。

执行 `node tooling/xatp/e2e/live-gate.mjs preflight` 检查环境。 `XATP_DSH_ORIGIN` 接受不含令牌的 DSH 回环地址，`XATP_CDP_ENDPOINT` 指向受控 Chromium 的回环调试地址。探测只检查页面可见性与 DSH 登录挑战，`DEEPSEEK_API_KEY` 只记录是否存在。环境就绪时退出 0，缺少条件时退出 2。执行 `node tooling/xatp/e2e/live-gate.mjs live` 输出 [#11](https://github.com/KRPCT/dsh-XATP/issues/11) 的能力与预算边界，完整生产验收仍退出 2。两项命令均不触发计费。
