# English Voice Tutor 英语发音助手

基于 Gemini Live API 的英语发音学习助手，帮助你练习和纠正英语发音。

## 功能特点

- 🎙️ 实时语音对话 - 使用 Gemini 原生音频模型
- 🗣️ 发音纠正 - AI 会识别你的发音问题并给出纠正建议
- 🔊 标准示范 - AI 会用正确的发音示范单词和句子
- 📱 移动端适配 - 专为手机使用优化的界面

## 快速开始

### 1. 获取 Gemini API Key

1. 访问 [Google AI Studio](https://aistudio.google.com/apikey)
2. 登录 Google 账号
3. 点击 "Create API Key" 创建免费的 API Key
4. 复制你的 API Key

### 2. 安装和运行

```bash
# 进入项目目录
cd english-voice-tutor

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 3. 在手机上使用

启动后，终端会显示局域网地址（如 `http://192.168.x.x:3000`），确保手机和电脑在同一 WiFi 下，用手机浏览器打开这个地址即可。

## 使用方法

1. 打开应用，输入你的 Gemini API Key
2. 点击"连接"按钮
3. 连接成功后，**按住**麦克风按钮说英语
4. **松开**按钮后，AI 会分析你的发音并给出反馈
5. 建议使用耳机，避免 AI 回复时产生回声

## 练习建议

- 从简单的单词开始，如 "hello", "thank you", "apple"
- 特别练习中国人容易发错的音：
  - "th" 音：think, this, that
  - "r/l" 音：right/light, read/lead
  - "v/w" 音：very/well, vest/west
- 可以用中文问问题，AI 会用英语回答

## 技术说明

- **前端**: 原生 JavaScript + Vite
- **API**: Gemini Live API (WebSocket)
- **音频**: Web Audio API (16kHz 录音, 24kHz 播放)

## 注意事项

- 需要允许浏览器访问麦克风
- API Key 会保存在浏览器本地存储中
- Gemini API 有免费额度限制，日常学习足够使用
- 建议使用 Chrome 或 Safari 浏览器

## 常见问题

**Q: 为什么要用 Gemini 而不是 OpenRouter？**
A: OpenRouter 目前不支持实时语音 WebSocket，只支持上传音频文件。Gemini Live API 是真正的原生音频模型，可以实现实时对话。

**Q: API Key 安全吗？**
A: API Key 只保存在你的浏览器本地，不会上传到任何服务器。但建议不要在公共设备上使用。

**Q: 为什么需要用耳机？**
A: 如果用外放，AI 的回复声音可能会被麦克风录入，导致 AI 听到自己的声音并中断回复。
