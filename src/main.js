import { DoubaoRealtimeClient } from './lib/doubao-realtime-client.js';
import { AudioHandler } from './lib/audio-handler.js';

class EnglishVoiceTutor {
  constructor() {
    // 核心组件
    this.realtimeClient = null;
    this.audioHandler = null;
    
    // 状态
    this.isConnected = false;
    this.isRecording = false;
    
    // 当前 AI 回复的消息元素（用于合并流式文本）
    this.currentAssistantMessage = null;
    this.currentAssistantText = '';
    
    // 豆包 API 配置
    this.config = {
      appId: import.meta.env.VITE_DOUBAO_APP_ID,
      accessToken: import.meta.env.VITE_DOUBAO_ACCESS_TOKEN,
    };
    
    // DOM 元素
    this.elements = {
      connectBtn: document.getElementById('connectBtn'),
      statusBadge: document.getElementById('statusBadge'),
      micButton: document.getElementById('micButton'),
      voiceHint: document.getElementById('voiceHint'),
      visualizer: document.getElementById('visualizer'),
      chatMessages: document.getElementById('chatMessages'),
      emptyState: document.getElementById('emptyState'),
      testBtn: document.getElementById('testBtn'),
      asrText: document.getElementById('asrText'),
    };
    
    this.init();
  }

  init() {
    // 绑定连接按钮事件
    this.elements.connectBtn.addEventListener('click', () => this.handleConnect());

    // 麦克风按钮 - 点击切换模式
    this.elements.micButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleRecording();
    });

    // 测试按钮
    this.elements.testBtn.addEventListener('click', () => this.sendTestMessage());
  }

  async handleConnect() {
    if (!this.config.appId || !this.config.accessToken) {
      this.showMessage('API 配置缺失，请检查 .env 文件', 'system');
      return;
    }

    // 更新 UI 状态
    this.elements.connectBtn.disabled = true;
    this.elements.connectBtn.textContent = '连接中...';
    this.updateStatus('connecting');

    try {
      // 初始化音频处理器
      this.audioHandler = new AudioHandler();
      await this.audioHandler.init();

      // 初始化豆包实时语音客户端
      this.realtimeClient = new DoubaoRealtimeClient(this.config);
      
      // 设置回调
      this.realtimeClient
        .on('open', () => this.onConnected())
        .on('close', () => this.onDisconnected())
        .on('error', (error) => this.onError(error))
        .on('audio', (data) => this.onAudioReceived(data))
        .on('text', (text) => this.onTextReceived(text))
        .on('asrText', (text, isInterim) => this.onASRText(text, isInterim))
        .on('ttsStart', (data) => this.onTTSStart(data))
        .on('ttsEnd', () => this.onTTSEnd());

      // 连接
      await this.realtimeClient.connect();

    } catch (error) {
      console.error('Connection failed:', error);
      this.showMessage(`连接失败: ${error.message}`, 'system');
      this.updateStatus('disconnected');
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.textContent = '点击连接';
    }
  }

  onConnected() {
    this.isConnected = true;
    this.updateStatus('connected');
    
    // 隐藏连接按钮，显示麦克风和测试按钮
    this.elements.connectBtn.style.display = 'none';
    this.elements.micButton.style.display = 'flex';
    this.elements.micButton.disabled = false;
    this.elements.testBtn.style.display = 'block';
    this.elements.testBtn.disabled = false;
    
    this.elements.voiceHint.textContent = '点击麦克风开始对话';
    
    this.showMessage('已连接！点击麦克风开始对话 🎉', 'system');
    this.hideEmptyState();
  }

  onDisconnected() {
    this.isConnected = false;
    this.isRecording = false;
    this.updateStatus('disconnected');
    
    // 显示连接按钮，隐藏其他
    this.elements.connectBtn.style.display = 'block';
    this.elements.connectBtn.disabled = false;
    this.elements.connectBtn.textContent = '重新连接';
    this.elements.micButton.style.display = 'none';
    this.elements.micButton.disabled = true;
    this.elements.micButton.classList.remove('recording');
    this.elements.testBtn.style.display = 'none';
    this.elements.testBtn.disabled = true;
    this.elements.visualizer.classList.remove('active');
    
    this.elements.voiceHint.textContent = '连接已断开';
    
    this.showMessage('连接已断开', 'system');
  }

  onError(error) {
    console.error('Realtime error:', error);
  }

  onAudioReceived(audioData) {
    if (this.audioHandler) {
      this.audioHandler.playAudio(audioData);
    }
  }

  onTextReceived(text) {
    // 流式文本回复 - 合并到同一条消息
    if (!text) return;
    
    // 如果没有当前消息元素，创建一个新的
    if (!this.currentAssistantMessage) {
      this.hideEmptyState();
      this.currentAssistantMessage = document.createElement('div');
      this.currentAssistantMessage.className = 'message assistant';
      this.currentAssistantText = '';
      this.elements.chatMessages.appendChild(this.currentAssistantMessage);
    }
    
    // 追加文本
    this.currentAssistantText += text;
    this.currentAssistantMessage.textContent = this.currentAssistantText;
    
    // 滚动到底部
    this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
  }

  onASRText(text, isInterim) {
    // 显示语音识别结果
    if (this.elements.asrText) {
      this.elements.asrText.textContent = text;
      this.elements.asrText.className = `asr-text ${isInterim ? '' : 'final'}`;
    }
    
    // 如果是最终结果，显示在聊天中
    if (!isInterim && text.trim()) {
      this.showMessage(text, 'user');
    }
  }

  onTTSStart(data) {
    // AI 开始说话 - 重置当前消息
    this.currentAssistantMessage = null;
    this.currentAssistantText = '';
    if (this.isRecording) {
      this.updateStatus('speaking');
    }
  }

  onTTSEnd() {
    // AI 说完了 - 结束当前消息
    this.currentAssistantMessage = null;
    this.currentAssistantText = '';
    if (this.isConnected && this.isRecording) {
      this.updateStatus('recording');
    } else if (this.isConnected) {
      this.updateStatus('connected');
    }
  }

  // 切换录音状态
  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  async startRecording() {
    if (!this.isConnected || this.isRecording) return;
    
    this.isRecording = true;
    
    // 更新 UI
    this.elements.micButton.classList.add('recording');
    this.elements.visualizer.classList.add('active');
    this.elements.voiceHint.textContent = '对话中，点击停止';
    this.updateStatus('recording');
    
    // 清空 ASR 显示
    if (this.elements.asrText) {
      this.elements.asrText.textContent = '';
    }
    
    // 停止当前播放
    this.audioHandler.stopPlayback();
    
    try {
      await this.audioHandler.startRecording((audioData) => {
        // 发送音频数据到豆包
        if (this.realtimeClient && this.isRecording) {
          this.realtimeClient.sendAudio(audioData);
        }
      });
      console.log('[App] Recording started - continuous mode');
    } catch (error) {
      console.error('Recording error:', error);
      this.showMessage(`录音失败: ${error.message}`, 'system');
      this.stopRecording();
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    
    this.isRecording = false;
    
    // 更新 UI
    this.elements.micButton.classList.remove('recording');
    this.elements.visualizer.classList.remove('active');
    this.elements.voiceHint.textContent = '点击麦克风开始对话';
    this.updateStatus('connected');
    
    // 停止录音
    if (this.audioHandler) {
      this.audioHandler.stopRecording();
    }
    
    console.log('[App] Recording stopped');
  }

  // 发送测试文本消息
  sendTestMessage() {
    if (!this.isConnected || !this.realtimeClient) {
      this.showMessage('请先连接', 'system');
      return;
    }
    
    const testText = "Hello, can you help me practice English?";
    this.showMessage(testText, 'user');
    this.realtimeClient.sendText(testText);
  }

  updateStatus(status) {
    const badge = this.elements.statusBadge;
    badge.className = 'status-badge';
    
    switch (status) {
      case 'connected':
        badge.textContent = '已连接';
        badge.classList.add('connected');
        break;
      case 'recording':
        badge.textContent = '对话中';
        badge.classList.add('recording');
        break;
      case 'speaking':
        badge.textContent = 'AI说话中';
        badge.classList.add('recording');
        break;
      case 'connecting':
        badge.textContent = '连接中...';
        break;
      default:
        badge.textContent = '未连接';
    }
  }

  showMessage(text, type) {
    this.hideEmptyState();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;
    
    this.elements.chatMessages.appendChild(messageDiv);
    
    // 滚动到底部
    this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
  }

  hideEmptyState() {
    if (this.elements.emptyState) {
      this.elements.emptyState.style.display = 'none';
    }
  }

  // 清理资源
  dispose() {
    this.stopRecording();
    if (this.audioHandler) {
      this.audioHandler.dispose();
    }
    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
    }
  }
}

// 初始化应用
const app = new EnglishVoiceTutor();

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  app.dispose();
});
