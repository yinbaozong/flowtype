# FlowType

[English](README.md) | [简体中文](README.zh-CN.md)

按住快捷键说话，松开后，识别结果会自动输入到你原来正在使用的输入框中。

FlowType 是一款使用 Electron、React 和 TypeScript 开发的 Windows 桌面语音输入工具。它平时驻留在系统托盘，通过全局快捷键录音，调用用户自己配置的语音识别模型，并把识别结果粘贴回原来的输入位置。API Key、使用记录和个人设置均保存在本机。

![FlowType 概念图](docs/flowtype-concept.png)

![直接安装流程](docs/install-release.svg)

## 主要功能

- 在浏览器、聊天软件、编辑器和笔记软件等 Windows 应用中进行语音输入。
- 按住组合键开始录音，松开任意组成键结束录音并识别。
- 支持录入自定义组合快捷键，例如 `Alt + Win`、`Win + Space`、`Ctrl + Alt + D`。
- 带实时波形反馈的悬浮录音条，可拖动并调整大小。
- 支持千问 `qwen3-asr-flash` 和火山大模型语音识别。
- 提供本地历史记录、每日统计、个人词典、语言选择和 Markdown 导出。
- 使用 Electron `safeStorage` 加密保存在当前 Windows 账户下的 API Key。
- 提供开发、构建和 NSIS 安装包生成流程。

![FlowType 实现图](docs/flowtype-implementation.png)

## 使用方式

1. 在浏览器、微信、编辑器或其他软件中点击一个输入框。
2. 按住配置好的快捷键，例如 `Alt + Win`。
3. 正常说话。
4. 松开快捷键。
5. FlowType 完成识别，并把文字输入到原来的输入框中。

FlowType 不内置公共云端账号。使用真实语音识别前，需要在设置中配置自己的 API Key。

## 直接安装

普通用户不需要安装 Node.js 或编译源代码：

1. 打开 [GitHub 最新版本](https://github.com/yinbaozong/flowtype/releases/latest)。
2. 下载 `FlowType.Setup.0.3.1.exe`。
3. 运行安装程序，并选择安装目录。
4. 启动 FlowType，在设置页面配置语音识别服务和 API Key。
5. 测试接口成功后，录入自己的快捷键。

安装程序会在所选目录中生成 `Uninstall FlowType.exe`。也可以通过“Windows 设置 > 应用”卸载 FlowType。

当前发布包尚未使用受信任的代码签名证书签名，因此 Windows SmartScreen 可能警告，开启 Smart App Control 的电脑也可能直接拦截。请只运行自己信任来源的安装包。

## 系统要求

- Windows 10 或 Windows 11
- 可用的麦克风，并允许桌面应用使用麦克风
- 千问百炼或火山大模型语音识别 API 凭证
- 只有参与开发时才需要 Node.js 20/22 和 npm

## 首次配置

1. 启动 FlowType。
2. 打开“设置”。
3. 选择“演示模式”“千问”或“火山大模型”。
4. 填入相应的 API Key。
5. 点击“保存并测试当前识别服务”。
6. 点击“录入新快捷键”，然后按下想使用的组合键。
7. 在任意输入框中测试一句简短语音。

演示模式只用于检查界面和输入流程，不会调用真实识别服务。正式使用需要配置千问或火山凭证。

## 配置 API Key

### 千问 Qwen3-ASR

千问配置最简单，只需要一个百炼 API Key：

1. 打开[阿里云百炼控制台](https://bailian.console.aliyun.com/)并登录。
2. 根据控制台提示开通模型服务。
3. 进入“API Key 管理”，创建并保存一个新的 API Key。
4. 在 FlowType 设置中选择“千问 Qwen3-ASR”。
5. 将 Key 填入“千问 API Key”。
6. 点击“保存并测试当前识别服务”。

FlowType 通过兼容 DashScope 的接口调用 `qwen3-asr-flash`。

- [阿里云：获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [阿里云：Qwen-ASR API 参考](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)

### 火山大模型语音识别

1. 打开[火山引擎控制台](https://www.volcengine.com/)并登录。
2. 进入语音技术相关控制台，开通大模型语音识别。
3. 找到大模型语音识别凭证，优先使用控制台提供的 API Key。
4. 在 FlowType 设置中选择“火山大模型”。
5. 将凭证填入“火山 API Key”。
6. 只有控制台提供旧式 App ID 和 Access Key 时，才填写对应字段。
7. 点击“保存并测试当前识别服务”。

FlowType 调用火山引擎录音文件识别极速版接口，并使用资源 ID `volc.bigasr.auc_turbo`。

- [火山引擎：鉴权方法](https://www.volcengine.com/docs/6561/107789)
- [火山引擎：大模型录音文件识别](https://www.volcengine.com/docs/6561/1354868)

## 自定义快捷键

快捷键录入和运行时检测均使用 Windows 低级键盘钩子：

- 点击“录入新快捷键”，再同时按下需要的按键。
- 支持 `Alt + Win`、`Win + Space`、`Ctrl + Alt + D` 等组合。
- 按住全部组成键开始录音，松开其中任意一个键结束录音。
- 快捷键保存后立即生效，重新启动 FlowType 后仍然有效。
- `Ctrl + Alt + Delete`、`Alt + Tab`、`Win + L` 等 Windows 保留组合会被拒绝。
- FlowType 会拦截已配置的组合，并在录音结束时清理修饰键状态，避免弹出开始菜单、输入法切换窗口或出现 Win/Alt/Ctrl 卡住的问题。

## 导出语音记录

打开“历史记录”，点击“导出 Markdown”，选择保存位置即可。

导出的文件只包含识别成功并且有文字的记录。每条记录包括识别时间、使用的模型、录音时长和识别文字。

## 数据与隐私

正式安装版的数据位于：

```text
%APPDATA%\FlowType
```

从源代码运行开发版时，数据保存在项目目录的 `.flowtype-data/` 中。两个目录都已配置为不提交到 Git。

当 Windows 加密能力可用时，FlowType 使用 Electron `safeStorage` 加密 API Key。GitHub 仓库不包含用户的 API Key、语音历史或录音文件。

## 开发版数据迁移

如果以前从项目目录运行过 FlowType，需要把 `.flowtype-data` 合并到正式安装版，可以先关闭 FlowType，然后运行：

```powershell
scripts/migrate-development-data.ps1 `
  -InstalledApp 'D:\software\flowtype\FlowType.exe' `
  -RemoveDevelopmentData
```

脚本会先备份开发版和安装版数据，再按记录 ID 合并历史，保留当前安装版设置，最后删除旧开发数据和指向 Electron 开发环境的快捷方式。

## 从源代码运行

```powershell
git clone https://github.com/yinbaozong/flowtype.git
cd flowtype
npm install
npm run dev
```

常用验证和构建命令：

```powershell
npm run typecheck
npm run verify:hotkeys
npm run verify:overlay
npm run build
npm run dist
```

安装包会生成到 `release/FlowType Setup 0.3.1.exe`。

## 项目结构

```text
src/main/        Electron 主进程、托盘、快捷键、模型调用和文字粘贴
src/preload/     暴露给渲染进程的安全通信桥
src/renderer/    React 设置页、历史记录和悬浮条界面
src/shared/      主进程与渲染进程共享的 TypeScript 类型
resources/       Windows 快捷键钩子脚本和图标
scripts/         数据迁移及系统回归测试脚本
docs/            图片和用户文档资源
```

录音由渲染进程负责，主进程调用所选语音识别服务，然后恢复原输入框焦点并粘贴结果。Windows 悬浮条使用原生异形窗口区域裁剪，因此圆角胶囊外部的透明像素无法被绘制，从系统层面避免白色矩形和阴影。

## 代码签名

代码签名会给 EXE 附加可验证的发布者身份和完整性签名。Windows 可以确认发布者，并检测文件在签名后是否被修改。公开分发时建议购买 OV/EV 代码签名证书或使用 Microsoft Artifact Signing，并添加可信时间戳。

取得 PFX 代码签名证书后，可以在私有终端或 CI Secret 中配置：

```powershell
$env:CSC_LINK = 'C:\secure\publisher-certificate.pfx'
$env:CSC_KEY_PASSWORD = 'certificate-password'
npm run dist:signed
```

不要把 PFX 文件或密码提交到仓库。自签名证书不能为其他用户消除 SmartScreen 警告。

- [Microsoft SmartScreen 应用信誉](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- [Microsoft SignTool 文档](https://learn.microsoft.com/windows/win32/seccrypto/signtool)

## 联系方式

如果你在复现、安装或开发过程中遇到问题，可以发送邮件到：yinbaozong@163.com
