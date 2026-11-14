# 语音服务切换（0.7.0）

## 如何选择

| 服务 | 接入方式 | 出字方式 | 凭证 |
| --- | --- | --- | --- |
| 千问 | 原有实时 / 整段接口 | 确认增量或松手后整段 | 阿里云百炼 Key |
| 豆包语音 / 火山引擎 | 新增双向流式优化接口；保留旧整段接口 | 实时模式按已定稿分句回填，草稿只进历史 | 豆包语音 Key，或旧 App ID + Access Token |
| DeepSeek ASR | 新增官方 `/v1/tools/asr` | 松手后整段；自动检测语种 | DeepSeek API Key |

DeepSeek 官方 ASR 目前不支持流式识别，不能把聊天模型的 Token 计费或流式聊天功能当作实时语音识别。软件使用内存 WAV multipart 上传，每段最多 60 秒，低于官方 120 秒 / 8 MiB 限制；长录音沿用现有分块、历史保留及一次重试机制。

## 豆包配置

1. 在火山引擎的**豆包语音控制台**开通流式语音识别服务，创建语音 API Key。不是方舟聊天模型的 Key。
2. FlowType 设置 → 识别服务 → 豆包语音 / 火山引擎。
3. 识别方式选择实时，默认资源为 `volc.seedasr.sauc.duration`（2.0 小时版）。账户开通并发版或旧模型时，选择对应资源 ID。
4. 填入 Volcano API Key，点击保存并测试。测试会发静音音频检查实际服务鉴权，不再仅检查 Key 是否填写。
5. 实时接口支持中英文。日语请切换千问或整段模式。保留的火山整段接口是独立的录音识别服务，权限和资源与流式接口不同。

豆包实时模式使用 16kHz 单声道 PCM，合并成约 200ms 数据包。启用 ITN、标点和二遍识别；只回填 definite 分句，避免修订草稿时误删用户输入。分句速度、准确率和计费以服务端为准，不能保证比千问更快或更准。

## DeepSeek 配置

设置 → DeepSeek 语音（整段识别）→ 填入 DeepSeek API Key → 保存并测试。无需填写聊天模型名称，语言由音频自动识别。语音服务单独计费，参考 ASR 文档而非聊天模型价格表。

## 开头漏字与隐私

换服务商可以比较模型识别效果，但不能录到麦克风打开前的声音。默认仍是用户选择的按需开启：按住快捷键，看到灰条变绿后开口。需要更低启动等待时，可手动开启设置中的“预热麦克风”；该选项会让 Windows 显示麦克风占用，不在本次升级中自动开启。

所有 Key 加密保存在当前 Windows 账户下，切换服务不会清空旧 Key、历史、快捷键或悬浮条设置。音频只在内存中，只有主动选择的服务会收到录音；不会同时把录音发送给多家。

## 官方参考

- [DeepSeek ASR：请求格式、限制与语音计费](https://api-docs.deepseek.com/zh-cn/guides/asr/)
- [豆包语音流式接入协议](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=zh)
- [豆包实时识别与资源 ID](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)

新增接入已通过模拟 HTTP / WebSocket、二进制压缩协议、超时、重试和凭证保存测试。没有用户的 DeepSeek / 豆包语音凭证时，无法替用户验证账户权限、余额和真实识别效果，需要填写后手动验证。
