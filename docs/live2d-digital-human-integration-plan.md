# 酒店线上演示 Live2D 数字人实施方案

## 1. 目标与原则

### 1.1 目标

将旧项目 `D:\tmp\butterfly-dream` 中的 Live2D 模型接入当前酒店线上演示，使其成为“数字接待员”：

- 在客人进入办理页面时主动欢迎；
- 在听取语音、理解意图、查询订单、核验身份、制作房卡时给出可见反馈；
- 通过表情、动作和气泡解释当前系统状态；
- 在桌面端、移动端和窄屏嵌入式预览中都不遮挡原有办理控件；
- Live2D 加载失败、资源缺失或浏览器不支持时，酒店业务流程仍完全可用。

### 1.2 必须遵守的边界

1. 数字人可以代表用户调用 AI 和酒店 API，但必须通过独立的数字人控制器复用现有请求契约、鉴权、幂等键、确认规则和状态机，不能在 canvas 事件里复制一套业务逻辑。
2. `TerminalPhase` 仍然是唯一业务事实来源。数字人可以发起动作，但不能自行宣布订单成功、入住完成、支付成功或房卡已发出。
3. 数字人语音输入使用酒店现有 ASR 链路；原来的独立语音入口迁移到数字人，键盘、输入框、发送、确认和返回等传统输入继续保留。
4. Live2D 采用渐进增强：资源加载失败时自动退化为静态头像/占位卡片，不能阻塞首屏、输入框或办理流程。
5. 数字人输入和用户点击原有确认按钮都是有效提交通道，但两者必须调用同一个提交函数，不增加第二个确认弹窗或第二套确认规则。
6. 每个业务状态都提供“上一步/后悔”入口；如果业务已产生外部副作用，只能调用真实撤销/补偿接口或转人工，不能仅修改前端状态伪造撤销。
7. 第一阶段不把旧页面的全局脚本、旧 API 请求和旧的硬编码 Token 搬进酒店项目。
8. 模型资源的商业授权必须单独确认。旧项目 README 已注明部分模型仅限学习和非商业用途，线上酒店演示发布前要替换为有明确授权的模型，或保留为内部演示资源。

### 1.3 最终产品定位

数字人是酒店线上演示的主交互入口和 AI 流程推动者。用户可以直接与数字人沟通，完成以下业务：

- 查询线上订单并办理入住；
- 现场入住、报价、支付和证件核验；
- 发起退房、押金结算和房态流转；
- 提出换房需求，由数字人收集信息、查询房态并推动前台受控流程。

整体关系不是“Live2D 装饰页面”，而是：

```text
用户与数字人沟通
        ↓
AI 理解意图并推动流程
        ↓
酒店业务服务执行和校验
        ↓
数字人解释结果和下一步
```

传统输入是稳妥兜底：用户始终可以使用键盘、文字框、发送、返回和上一步；需要提交确认时，可以点击原有物理/传统确认按钮，也可以通过数字人输入确认。两条确认通道调用同一个提交函数，不产生二次确认。

换房需要保留权限边界：数字人可以代表住客发起换房、收集目标房间和原因、查询房态并生成受控草案，但最终改房必须继续经过现有前台/管理员确认流程，不能由普通住客的语音直接改写房态。

## 2. 当前代码基线

### 2.1 酒店端已有可复用状态

酒店端 `VoiceTerminal` 位于 [app/page.tsx](../app/page.tsx)，已经具备接入数字人的全部业务状态：

- `TerminalPhase`：`idle`、`searching`、`matched`、`processing`、`ambiguous`、`not_found`、`blocked`、`complete`、`error`；
- `message`：当前对客文案；
- `listening`：是否正在采集语音；
- `flowStep`：入住流程步骤；
- `activeMessage`：页面当前主提示文案；
- `voiceEnabled`：是否开启浏览器语音播报；
- `audioLevel`：麦克风输入电平，可用于“正在听”的视觉反馈；
- `flowError`：失败步骤、错误码、是否可重试和自查结果。

这些状态在 [app/page.tsx:991](../app/page.tsx:991) 至 [app/page.tsx:1037](../app/page.tsx:1037) 已经集中管理。数字人应该订阅这些状态，而不是重复维护一份业务状态。

酒店端的语音播报函数在 [app/page.tsx:743](../app/page.tsx:743)，目前使用 `SpeechSynthesisUtterance`。浏览器原生语音没有统一的实时音频振幅回调，因此第一阶段只能做“播报开始/结束 + 估算口型”；真实口型同步应留到接入可分析的 TTS 音频后实现。

### 2.2 旧 Live2D 工程边界

旧页面入口是 `D:\tmp\butterfly-dream\index_meme.html`：

- 通过全局 `loadlive2d` 加载模型；
- 通过 `js/live2d.js` 和 `js/live2d-extensions.js` 提供运行时和动作扩展；
- `canvas` 当前写死为 `500 x 900`，见 [index_meme.html:738](D:/tmp/butterfly-dream/index_meme.html:738)；
- 对话气泡当前接近画布全宽，见 [index_meme.html:223](D:/tmp/butterfly-dream/index_meme.html:223)；
- 旧页面包含独立的 API 调用和前端 Token，不得随模型运行时一起迁移。

## 3. 总体架构

### 3.1 新增文件

建议新增以下文件，不把 Live2D 逻辑继续堆进 `app/page.tsx`：

```text
components/
  live2d/
    digital-human.tsx          # React 外壳、生命周期、降级
    digital-human-runtime.ts   # 旧 runtime 的加载与初始化适配
    digital-human-state.ts     # 酒店状态 -> 数字人状态的纯函数映射
    digital-human.css          # 舞台、气泡、响应式布局
    types.ts                   # 对外类型和动作协议
public/
  live2d/
    runtime/
      live2d.js
      live2d-extensions.js
    models/
      hotel-agent/
        model.json
        model.moc
        textures/
        motions/
        expressions/
```

如果使用 Cubism 3/4 模型，则把模型目录换成对应的 `*.model3.json`、`*.moc3`、`physics3.json` 和纹理目录，并在 runtime 适配层中明确区分 Cubism 2/3/4，不能依赖路径猜测版本。

### 3.2 组件职责

`DigitalHuman` 负责以下事情：

1. 创建并清理 canvas；
2. 在浏览器端按需加载 runtime；
3. 根据容器尺寸设置 canvas 的 CSS 尺寸和实际像素尺寸；
4. 调用旧 runtime 的模型加载函数；
5. 接收已映射的数字人状态并播放动作；
6. 显示可访问的状态气泡；
7. 发出数字人语音、点击、确认和快捷意图事件；
8. 通过 `onAgentRequest` 请求数字人控制器调用 AI / 酒店 API；
9. 捕获资源、WebGL、模型、动作和输入异常，并展示降级占位。

它本身不保存业务状态，也不在模型脚本中复制业务规则。具体请求由相邻的 `digital-human-agent.ts` 控制器负责：

- 持久化订单、身份、支付或入住状态；
- 修改 `TerminalPhase` 的规则；
- 绕过确认、冲突检查和人工接手；
- 通过改写前端 `phase` 伪造提交成功或撤销成功；
- 在模型脚本内部拼接未经校验的 API URL 或请求体。

### 3.3 与 `VoiceTerminal` 和 API 的连接

在 `VoiceTerminal` 中增加输入状态对象和数字人控制器：

```ts
type DigitalHumanInput = {
  phase: TerminalPhase;
  message: string;
  activeMessage: string;
  listening: boolean;
  audioLevel: number;
  flowStep: number;
  flowError: { retryable: boolean; status: string } | null;
  voiceEnabled: boolean;
};

type DigitalHumanAgentRequest = {
  source: "digital_human_voice" | "digital_human_action";
  eventId: string;
  text?: string;
  action?: "checkin" | "checkout" | "confirm" | "cancel" | "help";
  sessionId: string;
  conversationId: string;
};
```

使用方式：

```tsx
<DigitalHuman
  input={digitalHumanInput}
  onAgentRequest={handleDigitalHumanAgentRequest}
/>
```

`digitalHumanInput` 应由 `useMemo` 组装。数字人组件不直接持有酒店页面 refs，但 `onAgentRequest` 会进入数字人控制器；控制器可以调用现有 AI / 酒店 API，并把结果交回 `VoiceTerminal` 的状态更新函数。

## 4. 数字人状态协议

### 4.1 内部状态

数字人内部建议使用比酒店业务更稳定的状态：

```ts
type DigitalHumanMode =
  | "welcome"
  | "listening"
  | "thinking"
  | "guiding"
  | "processing"
  | "success"
  | "warning"
  | "error"
  | "disabled";

type DigitalHumanViewModel = {
  mode: DigitalHumanMode;
  expression: "neutral" | "smile" | "focused" | "concerned";
  motion: string | null;
  bubble: string | null;
  compact: boolean;
  interactive: boolean;
};
```

### 4.2 映射规则

映射必须是纯函数，放在 `digital-human-state.ts`，并为每条规则写单元测试。

| 酒店状态 | 数字人模式 | 表情 | 动作 | 气泡 | 是否缩小 |
|---|---|---|---|---|---|
| `idle` | `welcome` | `smile` | `idle` | `您好，今天想办理什么？` | 否 |
| `listening=true` | `listening` | `focused` | `listen` | `我在听，请直接说。` | 否 |
| `searching` | `thinking` | `focused` | `think` | 使用 `message`，无文案时显示“正在理解您的需求…” | 否 |
| `matched` | `guiding` | `smile` | `nod` | 使用 `message` | 否 |
| `processing` | `processing` | `focused` | `work` | 使用 `activeMessage` 或当前流程步骤 | 是 |
| `ambiguous` | `warning` | `concerned` | `explain` | 告知找到多笔订单，需要人工选择 | 否 |
| `not_found` | `guiding` | `neutral` | `explain` | 引导现场办理或重新提供信息 | 否 |
| `blocked` | `warning` | `concerned` | `stop` | 明确说明不能自动继续 | 是 |
| `complete` | `success` | `smile` | `celebrate` | `入住完成，请带好身份证和房卡` | 否 |
| `error` | `error` | `concerned` | `stop` | 使用 `message`，禁止自动伪装成功 | 是 |

规则优先级必须固定为：

1. `phase === "error"`；
2. `phase === "blocked"` 或 `phase === "ambiguous"`；
3. `listening === true`；
4. `phase === "processing"`；
5. 其余按 `phase` 判断。

这样可以避免“正在听”覆盖“流程失败”，也避免失败状态被欢迎动作短暂覆盖。

### 4.3 动作节流和去重

不要在每次 React render 时重新播放动作。组件内部需要保存：

- `lastModeRef`；
- `lastMotionRef`；
- `lastBubbleRef`；
- `motionCooldownRef`。

只有以下情况才触发动作：

- `mode` 变化；
- `motion` 变化；
- 同一动作冷却时间已结束；
- 用户明确点击模型。

建议动作冷却时间为 800～1500ms。`idle` 动作使用定时器循环，但在组件卸载、页面隐藏和 `disabled` 时必须清除。

## 5. 页面布局实施

### 5.1 桌面端布局

酒店演示不是纯展示页，订单状态和设备回执必须保持主视觉。因此建议将数字人作为左侧固定舞台：

```css
.hotel-demo-shell {
  display: grid;
  grid-template-columns: minmax(280px, 36%) minmax(0, 64%);
  min-height: calc(100dvh - 7rem);
  align-items: stretch;
}

.digital-human-stage {
  position: sticky;
  top: 1rem;
  height: calc(100dvh - 9rem);
  min-height: 420px;
  overflow: hidden;
}

.hotel-workspace {
  min-width: 0;
  min-height: 0;
}
```

数字人舞台建议宽度 280～460px，模型底部对齐，头部留出气泡空间。聊天输入框、订单卡片和流程卡片全部保留在右侧，不允许被 canvas 覆盖。

### 5.2 办理中布局

进入 `processing`、`complete` 或 `error` 后，右侧业务状态卡片优先级高于模型：

- 数字人舞台缩小到 220～280px；
- 只显示半身或胸像；
- 气泡最多 2～3 行；
- 不显示可拖拽效果；
- 不允许动作动画覆盖状态卡片。

### 5.3 移动端布局

移动端不要使用桌面端的 `fixed bottom-right` 浮窗覆盖输入框，建议采用上下分区：

```css
@media (max-width: 768px) {
  .hotel-demo-shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(230px, 36svh) minmax(0, 1fr);
  }

  .digital-human-stage {
    position: relative;
    top: auto;
    height: 36svh;
    min-height: 230px;
    max-height: 360px;
  }
}
```

输入框需要考虑 `env(safe-area-inset-bottom)`，模型气泡不能贴近刘海、底部手势区域或发送按钮。

### 5.4 气泡规范

旧项目气泡宽度接近画布 98%，会遮挡模型头部。酒店数字人的气泡建议：

- 桌面端最大宽度 320px；
- 移动端最大宽度为舞台宽度的 82%；
- `pointer-events: none`，避免挡住模型交互；
- 使用 `aria-live="polite"`，但同一条流式文本不能每个字符都触发读屏；
- 文案超过 80 个中文字符时截断为摘要，完整内容仍显示在酒店对话记录中；
- 错误和风险文案使用稳定颜色，不使用剧烈抖动或连续弹窗。

## 6. Canvas、资源和运行时安全

### 6.1 动态尺寸

禁止继续使用旧页面的固定 `500 x 900`。使用 `ResizeObserver`：

1. 读取舞台的 CSS 宽高；
2. 计算 `devicePixelRatio`，限制在 1～2；
3. 设置 canvas 的实际宽高为 CSS 尺寸乘 DPR；
4. 只在尺寸真正变化时更新；
5. 防止 ResizeObserver 和模型重绘互相触发死循环。

### 6.2 runtime 加载

runtime 必须通过客户端生命周期加载：

- 不在服务器渲染阶段访问 `window`、`document` 或 WebGL；
- 同一页面只加载一次脚本，使用 Promise 缓存；
- 脚本加载顺序固定：核心 runtime → 扩展 → 模型；
- 组件卸载时清理动作循环、事件监听、ResizeObserver 和 WebGL 资源；
- 页面切换到后台时暂停高频动画，回到前台再恢复。

### 6.3 失败降级

以下任何情况都必须降级，不得抛出到酒店业务层：

- 模型文件 404；
- runtime 脚本加载失败；
- WebGL 不可用；
- 模型 JSON 解析失败；
- 纹理或动作文件缺失；
- canvas 上下文丢失；
- 浏览器禁用第三方脚本。

降级 UI 显示酒店图标、数字人名称和当前 `message`，并允许继续文字办理。错误只记录到前端诊断信息，不进入订单或 AI 上下文。

## 7. 语音、口型和消息同步

### 7.1 第一阶段：安全的估算口型

保留现有 `speak(text, voiceEnabled)` 行为，在它外层增加数字人事件：

```ts
onSpeechStart(text);
speechSynthesis.speak(utterance);
utterance.onend = () => onSpeechEnd();
utterance.onerror = () => onSpeechEnd();
```

`onSpeechStart` 只设置数字人 `talking=true`，`onSpeechEnd`、取消和异常都必须设置回 `false`。需要有超时保护，避免某些浏览器不触发 `onend` 导致模型一直张嘴。

### 7.2 第二阶段：真实音频口型

如果以后接入服务器 TTS：

- 播放同一份音频数据；
- 通过 `AudioContext`、`AnalyserNode` 获取振幅；
- 将归一化音量映射到嘴部参数；
- 播放结束、暂停、切页、异常时统一释放 AudioContext。

不要尝试从浏览器 `speechSynthesis` 反向抓取音频，这是不稳定且跨浏览器不可控的。

### 7.3 流式响应

模型流式返回时，气泡不应每个 token 都触发动作：

- 文本可按 50～100ms 节流更新；
- 动作只在“开始思考”“开始回答”“回答结束”三个节点触发；
- 最终完整文本仍以现有 `message` 和对话记录为准。

## 8. 特性开关、回滚和发布策略

增加环境变量或本地配置：

```text
NEXT_PUBLIC_LIVE2D_ENABLED=false
NEXT_PUBLIC_LIVE2D_MODEL=hotel-agent
```

默认关闭，完成静态资源、性能和流程验收后再开启。建议分三步发布：

1. **隐藏模式**：加载资源但不显示，验证 runtime、404、WebGL 和内存。
2. **内部演示模式**：只对指定浏览器或 URL 参数开启，验证动作映射。
3. **公开演示模式**：默认显示，保留右上角关闭数字人的入口。

任何线上异常都可以只关闭 `NEXT_PUBLIC_LIVE2D_ENABLED`，不需要回滚酒店业务代码。

## 9. 测试与验收清单

### 9.1 状态映射

- 初始页面显示欢迎动作和欢迎气泡；
- 开始录音后进入 listening，录音结束后恢复；
- 查询中不会显示成功表情；
- 找到订单后显示引导动作；
- 多订单、订单不存在和人工接手状态显示警示动作；
- 身份核验、锁房、登记、写卡、取卡每一步都能显示正确步骤；
- 完成和失败不会被后续 idle 定时器覆盖。

### 9.2 布局

- 1366×768、1920×1080 桌面端不遮挡输入框和办理按钮；
- 390×844、412×915 移动端不遮挡发送按钮和底部安全区；
- 浏览器缩放 80%、100%、125% 后模型仍保持比例；
- 长消息不会把气泡撑出舞台；
- 订单卡片、流程卡片滚动时 canvas 不跟随漂移。

### 9.3 降级和资源

- 删除模型文件后，仍可完成文字办理；
- 禁用 WebGL 后，显示占位卡片；
- runtime 重复加载不会产生多个动画循环；
- 页面切换、刷新和重新办理下一位客人后无重复声音、重复动作或旧气泡；
- 连续进入退出页面 20 次，内存和 canvas 数量不持续增长。

### 9.4 业务回归

至少执行现有酒店验收脚本，并手工走通：

- 线上订单匹配；
- 多订单暂停；
- 现场办理、报价、支付；
- 身份读取、公安登记、锁房、PMS 确认、写卡、取卡；
- 可重试错误和不可重试错误；
- 管理后台入口不受数字人影响。

## 10. 实施顺序

### 阶段 A：只读接入

- 搭建 `DigitalHuman` 外壳；
- 接入资源加载和降级；
- 不播放业务动作，只验证布局和生命周期；
- 保持 `NEXT_PUBLIC_LIVE2D_ENABLED=false`。

### 阶段 B：状态映射

- 完成 `TerminalPhase` 到 `DigitalHumanViewModel` 的纯函数映射；
- 为每个 phase 添加测试；
- 接入气泡和基础动作；
- 不改变原有 `setPhase`、`setMessage` 和 API 调用。

### 阶段 C：语音和流程动画

- 接入听取状态、播报开始/结束和 `audioLevel`；
- 加入流程步骤动作；
- 处理取消、超时、异常和页面隐藏。

### 阶段 D：公开演示

- 完成桌面、移动端、窄屏和低性能设备验收；
- 确认模型授权；
- 开启特性开关；
- 保留关闭数字人的入口和快速回滚配置。

## 11. 数字人作为 AI 输入入口

数字人是酒店 AI 的主语音入口和可视化界面，同时保留传统输入作为备用通道。它可以直接代表用户发起 AI / 酒店请求，但请求必须经过统一控制器和原有状态机：

```text
用户对数字人说话 / 点击数字人
                ↓
      数字人使用现有 ASR
                ↓
       DigitalHumanAgentController
          ↙                    ↘
   现有 AI 接口             现有酒店 API
          ↘                    ↙
       原有 TerminalPhase 状态机
                ↓
        数字人表情 / 动作 / 气泡

键盘、文本框、发送、确认和返回按钮
                ↓
       同一个 AgentController
```

### 11.1 输入事件协议

在 `components/live2d/types.ts` 中定义统一事件，不让 Live2D 组件直接依赖酒店业务函数：

```ts
type DigitalHumanInputEvent =
  | { type: "voice_start"; source: "model_button"; eventId: string }
  | { type: "voice_stop"; source: "model_button"; eventId: string }
  | { type: "text_submit"; source: "model_bubble"; text: string; eventId: string }
  | { type: "quick_intent"; source: "model_button"; intent: "checkin" | "checkout" | "help"; eventId: string }
  | { type: "confirm"; source: "model_button"; eventId: string }
  | { type: "cancel"; source: "model_button"; eventId: string }
  | { type: "model_interaction"; source: "canvas"; interaction: "tap_head" | "tap_body"; eventId: string };
```

事件协议的约束：

- `eventId` 必须由前端生成，用于防止双击和重复提交；
- `model_interaction` 只播放表情或动作，不能改变订单状态；
- `quick_intent` 必须转换成现有的文字输入，例如“办理入住”；
- `confirm` 可以由数字人输入或原有物理/传统按钮触发，但必须调用同一个确认提交函数，不增加二次确认；
- 事件处理失败时，数字人只显示错误气泡，不能吞掉原有错误。

### 11.2 数字人语音输入

数字人语音输入必须复用现有 ASR，不新增第二套录音协议：

1. 用户点击数字人的麦克风或说话按钮；
2. 数字人发出 `voice_start`；
3. `VoiceTerminal` 调用现有 `startListening()`；
4. 本地 ASR 或浏览器 ASR 按现有逻辑返回文字；
5. 数字人显示“正在听”和实时电平，但不自己解释转写内容；
6. 结束录音后，文字交给数字人控制器调用现有 AI 路由；
7. 原来的表单麦克风按钮可以移除或隐藏，键盘输入和传统按钮继续保留。

这样“数字人语音”和原来的语音输入在 ASR、识别结果、错误处理和会话记录上完全一致，只是麦克风入口从表单迁移到了数字人。

### 11.3 数字人 Agent 控制器

新增 `components/live2d/digital-human-agent.ts`，负责将数字人请求转换成已有 API 调用。它可以直接调用 AI / 酒店 API，但不能在组件内散落 `fetch`：

```ts
async function handleDigitalHumanAgentRequest(
  request: DigitalHumanAgentRequest,
) {
  if (request.text) {
    return submitUtterance(request.text, {
      source: request.source,
      eventId: request.eventId,
    });
  }

  return submitUtterance(actionToExistingUtterance(request.action), {
    source: request.source,
    eventId: request.eventId,
  });
}
```

控制器可以调用 `/api/agent/turn`、`/api/demo/*` 或现有酒店服务，但必须满足：

- 复用现有 Zod schema 和请求体；
- 复用 `sessionId`、`conversationId` 和当前会话隔离；
- 每个请求携带唯一 `eventId` / 幂等键；
- 复用已有 `FlowStepError`、重试和 reconciliation 处理；
- 只根据 API 返回结果更新 `phase`、`message` 和 `flowStep`；
- 不允许根据动作名称直接把状态写成 `complete`。

### 11.4 输入适配层

在 `VoiceTerminal` 内新增一个小型适配函数，作为唯一业务入口：

```ts
function handleDigitalHumanInput(event: DigitalHumanInputEvent) {
  if (event.type === "voice_start") return startListening();
  if (event.type === "voice_stop") return finishListeningAndSubmit();
  if (event.type === "text_submit") {
    return handleDigitalHumanAgentRequest({
      source: "digital_human_voice",
      eventId: event.eventId,
      text: event.text,
      sessionId,
      conversationId,
    });
  }
  if (event.type === "confirm") return commitCurrentAction("digital_human_action", event.eventId);
  if (event.type === "quick_intent") {
    const text = event.intent === "checkin"
      ? "我要办理入住"
      : event.intent === "checkout"
        ? "我要退房"
        : "我需要帮助";
    return handleDigitalHumanAgentRequest({
      source: "digital_human_action",
      eventId: event.eventId,
      action: event.intent,
      sessionId,
      conversationId,
    });
  }
  if (event.type === "cancel") return resetOrCancelCurrentStep();
  return playLocalModelInteraction(event);
}
```

这里的函数是数字人的输入路由。数字人可以进入 AI / 酒店 API；数字人确认和传统按钮确认都必须进入同一个 `commitCurrentAction`，不能在 Live2D 脚本中重写订单、支付或入住流程。

### 11.5 用户输入到原办理逻辑的对应关系

| 数字人输入 | 适配层调用 | 后续真实逻辑 |
|---|---|---|
| 点击“开始说话” | `startListening()` | 原有本地 ASR / 浏览器 ASR |
| 点击“结束说话” | `finishListeningAndSubmit()` | 原有转写、确认和提交 |
| 说出“查订单” | ASR 文本 → `submitUtterance(text)` | 原有 `/api/agent/turn` 和订单匹配 |
| 点击“办理入住” | `submitUtterance("我要办理入住")` | 原有入住意图路由 |
| 数字人输入“确认” | `commitCurrentAction("digital_human_action", eventId)` | 原有确认、支付或流程继续逻辑 |
| 用户点击原有确认按钮 | `commitCurrentAction("physical_button", eventId)` | 同一套确认、支付或流程继续逻辑 |
| 点击“取消” | 现有取消/重置函数 | 原有会话隔离和状态回退 |
| 点击模型头部 | `playLocalModelInteraction()` | 仅播放动作，不产生业务副作用 |

### 11.6 AI / 酒店 API 请求边界

数字人可以通过 `DigitalHumanAgentController` 向 `/api/agent/turn` 和 `/api/demo/*` 发起请求；数字人确认和传统确认也都是合法提交通道。完整链路必须保持：

1. 数字人接收麦克风或快捷动作事件；
2. 语音事件启动已有 ASR；
3. ASR 返回文字；
4. 数字人控制器附加 `source`、`eventId`、`sessionId` 和 `conversationId`；
5. 控制器调用现有 `/api/agent/turn` 或 `/api/demo/*`；
6. 现有代码更新 `phase`、`message`、`flowStep`；
7. 数字人订阅新状态并更新表现；
8. 传统输入框和原有确认按钮也调用同一个控制器/提交函数，保证两个入口完全一致；
9. 数字人或物理按钮先到达者提交成功后，另一通道立即锁定，防止双提交。

这样可以确保数字人看见的状态和酒店真正执行的状态相同，不会出现“数字人说已经入住，但实际状态仍然失败”的分叉。

### 11.7 双通道输入锁和防重复提交

数字人和传统输入都必须使用酒店端现有状态做输入锁：

- `phase === "searching"`：禁用语音开始、文字提交和快捷意图；
- `phase === "processing"`：只允许查看状态，不允许新建请求；
- `listening === true`：显示“结束说话”，再次点击只能结束当前录音；
- `phase === "ambiguous"`：只允许选择订单或返回，不允许数字人自动猜选；
- `phase === "blocked"` 或 `phase === "error"`：仍显示上一步/后悔入口，并按现有重试、返回或人工接手规则处理；
- `eventId` 在消费后短期缓存，防止 pointer、click 和 touch 同时触发两次。

传统输入不能因为数字人加载失败而消失。数字人启用后，原有文字框、键盘 Enter、发送、确认、上一步和管理后台入口继续存在；只有原来独立的语音按钮迁移到数字人，避免出现两个麦克风同时录音。

`confirm` 事件和物理确认按钮都不能绕过当前状态、冲突检查、权限检查或确认条件；两者只允许调用同一个 `commitCurrentAction`。

### 11.8 双通道确认与全状态回退

确认采用“双通道、单提交函数”：

```text
数字人语音/动作“确认” ─┐
                         ├─> commitCurrentAction() ─> 原有业务流程
原有物理/传统确认按钮 ───┘
```

不增加额外确认弹窗，不要求客人先确认一次再点击一次。数字人可以朗读确认摘要，用户也可以直接点击原有确认按钮；任一通道成功提交后，另一个通道立即进入锁定状态。

每个状态都必须有“上一步/后悔”入口，但回退分为三类：

| 状态阶段 | “上一步/后悔”真实行为 | 结果 |
|---|---|---|
| 输入、识别、订单选择 | 清空输入或返回上一步 | 只改变当前会话 UI，可立即回退 |
| 草稿、报价、待支付、待确认 | 调用原有取消草稿/返回选择函数 | 业务草稿被真实取消或保留，不能只改页面 |
| 已提交、外部处理中 | 取消重复提交并等待真实结果 | 不允许前端强制改回未提交 |
| 已支付、已入住、已写卡 | 调用后端真实撤销/补偿接口 | 没有撤销接口时转人工，不伪造成功 |
| 错误或人工接手 | 保留原错误和 reconciliation 结果 | 按 `retryable` 决定重试、返回或人工处理 |

实现要求：

- 数字人的“上一步”和原有物理“上一步”调用同一个 `goBackOrRegret()`；
- `goBackOrRegret()` 根据服务端当前状态决定能否回退；
- 任何回退都必须清理旧的数字人气泡、ASR、TTS、未完成请求和输入锁；
- 已产生外部副作用时，前端不得直接 `setPhase("idle")`、`setPhase("matched")` 或删除订单显示来伪造撤销；
- 撤销成功必须由服务端返回真实回执，撤销失败必须显示失败和人工处理入口。

### 11.9 文字气泡和传统输入框的关系

数字人气泡分为两类：

- **输出气泡**：只读，显示 `message`、`activeMessage` 或流程摘要；
- **输入气泡**：只有用户点击气泡输入区域后才进入编辑状态，提交时调用 `submitUtterance`。

输入气泡不能直接改写 `message`，也不能把临时编辑内容写入 `conversationRef`。只有提交成功后，原有 `recordConversation("user", text)` 才能记录用户消息。

推荐初期采用“数字人语音/快捷动作 + 页面原文字输入框”双通道。输入气泡可以先只读显示识别结果，等输入锁、无障碍和重复提交测试完成后，再开放气泡内直接编辑。

## 12. 最终落点

这套方案的关键不是把旧 Live2D 页面嵌进酒店页面，而是让数字人成为酒店 AI 的统一交互入口，同时保留原有物理/传统确认入口，并让原有业务状态机保持唯一事实来源：

```text
用户输入
   ↓
数字人输入事件 / 传统输入事件
   ↓
数字人 / 传统输入共用控制器
   ↓
现有 ASR / AI / 酒店 API
   ↓
TerminalPhase 状态机
   ↓
数字人 ViewModel
   ↓
表情 / 动作 / 气泡 / 布局
```

这样即使 Live2D 完全失效，用户仍可通过原输入框和物理确认按钮完成酒店办理；而数字人正常工作时，用户可以直接对数字人说话或输入“确认”，也可以点击原有确认按钮，两条通道都只提交一次，并且每个状态都有真实的上一步/后悔入口，不会通过前端状态伪造撤销。

## 13. 第一版已落地内容

第一版实现保持为独立增量，不复制旧项目页面、接口或令牌：

- `components/live2d/digital-human.tsx`：Live2D 卡片、状态气泡、语音开始/结束、上一步、确认提交按钮和降级占位；
- `components/live2d/digital-human-runtime.ts`：按需加载旧 Cubism 2 运行时，统一模型加载、Canvas 高 DPI 尺寸同步和动作调用；
- `components/live2d/digital-human-state.ts`：纯函数把 `TerminalPhase`、`message`、`listening`、流程错误映射为动作和气泡；
- `components/live2d/types.ts`：数字人事件协议，确认事件区分数字人和物理来源但不分叉业务提交；
- `public/live2d/models/hotel-agent/`：仅保留模型、纹理和动作资源；`public/live2d/runtime/`：仅保留运行时和动作扩展；
- `app/page.tsx`：复用原 ASR、`submitUtterance`、物理文字输入、物理确认和原状态机，数字人事件通过同一入口转发；
- Live2D 加载失败时只显示降级卡片，传统文字输入和确认按钮继续可用。

当前验证：`npm run build` 通过；`npm run lint` 无 error（仅保留原项目和新增 Hook 的 warning）。

## 14. 受控 Computer Use 与左侧悬浮布局

数字人现在可以作为页面级 Computer Use 的入口，但这里的“操作整个流程”是受控的酒店页面操作，不是给模型任意浏览器或操作系统权限。动作协议只允许：聚焦输入框、提交文字、开始/结束语音、确认、上一步/后悔和转人工；所有业务提交仍回到现有 `submitUtterance`、`commitCurrentAction`、`goBackOrRegret`，因此不会绕过高风险确认、幂等锁、审计或真实撤销接口。

`components/live2d/computer-use-controller.ts` 是唯一动作分发器，禁止 `eval`、任意 DOM 点击、跨站导航和直接调用 PMS。事件仍带 `eventId`，页面继续去重；当状态进入 `searching`、`processing`、外部设备或结算阶段时，控制器只允许安全的等待、回退或人工接手。数字人界面显示“AI 操作已开/等待用户点击确认”，高风险提交依旧必须由用户点击原有物理确认按钮或数字人确认按钮，不增加二次确认弹窗。

布局上，Live2D 从右下角卡片改为主界面左侧的大尺寸、透明无边框悬浮舞台；对话气泡、按钮和语音设备选择器保留为半透明胶囊，主内容在桌面端增加左侧安全间距，移动端自动回到底部窄幅布局。数字人资源失败时仍降级为文字和按钮输入，原有传统输入通道不受影响。

语音收尾必须区分“停止采集”和“ASR 收尾”：点击数字人“结束”后先停止 `MediaRecorder`，但保留最后一个音频分片、MediaStream 和 WebSocket，等待 ASR 的最终回执；只有收到最终转写、错误或 25 秒保护超时后才释放资源。否则浏览器会在最后一个 `dataavailable` 分片发送前关闭轨道，表现为只能识别到“嗯”、空文本或完全没有结果。
