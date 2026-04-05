# AZOTH

AZOTH 是一个以角色包、记忆系统、任务调度和多 surface 交互为核心的云端 PWA 个人操作系统。

产品名称现在统一使用 `AZOTH`，但仓库目录、部署路径、PM2 进程名以及部分技术标识仍保留 `lifeos` 兼容别名。

## 当前状态

截至 `2026-04-02`，项目当前口径如下：

- `Phase 6 A-F` 已完成并进入稳定基线
- `角色包系统 v2` 已封板
- `proposal -> approve -> task -> Discord delivery` 已打通并完成真实 live smoke
- `v3.0 Prompt Runtime` 已完成 `A/B/C/D` 四刀：
  - `A` shadow compile
  - `B` shadow context hydration
  - `C` parity drilldown / summary
  - `D` first live cut behind feature flag
- `LIFEOS_V3_PROMPT_LIVE` 当前默认保持 `off`

## 现在仓库里最重要的能力

- 角色包 loader / resolver / runtime summary
- hooks / quota / proposal / approve / task 执行链
- proposal inbox / proposal notifications / risk routing
- native Discord delivery
- prompt runtime compiler / stable prefix cache / prompt preview
- LifeOS web chat 的 shadow compile 与 guarded live cut

## 当前 rollout 口径

- `v2` 已视为完成，不再往里塞 `v3` 内容
- `v3.0` 仍是唯一主线，先稳住 Prompt Runtime
- `v3.1 Capability Runtime` 还没开工，不提前推进
- Discord 主回复链暂未做 v3 live cut，当前只对 `LifeOS web chat` 预留 live path

## 当前运行注意

- Claude 的 `LifeOS` 绑定当前临时跑在 `gpt-4o-2024-11-20`
- 当前工作 API base 为 `https://www.msuicode.com/v1`
- 工作 key 只放在 PM2 env，不写入仓库文件
- Discord 侧 Claude 绑定没有跟着一起切
- `quota.json`、hooks/policies 这类变更目前仍需要服务重启生效

## 关键文档

- [计划与架构/codex_memory.md](计划与架构/codex_memory.md)
- [计划与架构/CLOUD_PROGRESS.md](计划与架构/CLOUD_PROGRESS.md)
- [计划与架构/角色包系统_v2_设计.md](计划与架构/角色包系统_v2_设计.md)
- [计划与架构/角色包系统_v3_设计计划.md](计划与架构/角色包系统_v3_设计计划.md)
- [计划与架构/角色包系统_v3_基因移植补充.md](计划与架构/角色包系统_v3_基因移植补充.md)
- [计划与架构/AZOTH-Discord多端房间构架.md](计划与架构/AZOTH-Discord多端房间构架.md)

## 代码锚点

- [server/routes/ai.js](server/routes/ai.js)
- [server/services/prompt-runtime.js](server/services/prompt-runtime.js)
- [server/services/task-dispatcher.js](server/services/task-dispatcher.js)
- [server/services/proposal-execution.js](server/services/proposal-execution.js)
- [server/discord-bridge.js](server/discord-bridge.js)

## 推荐阅读顺序

1. 先看 `CLOUD_PROGRESS.md` 了解真实上线时间线
2. 再看 `codex_memory.md` 抓当前工作口径
3. 然后看 `角色包系统_v3_设计计划.md` 理解 v3 的目标边界
4. 最后回到 `ai.js / prompt-runtime.js / task-dispatcher.js` 看实际主链

## 备注

- 这个 README 现在主要承担“仓库入口态势板”的作用，不再记录所有历史小改动
- 较早期的零散更新说明请直接看 Git 历史或架构文档时间线
