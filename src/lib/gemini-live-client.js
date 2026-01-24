/**
 * Gemini Live API WebSocket Client
 * 用于实时语音对话的 WebSocket 客户端
 */

export class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.isConnected = false;
    this.isSetupComplete = false;
    this.callbacks = {
      onOpen: null,
      onClose: null,
      onError: null,
      onAudio: null,
      onText: null,
      onInterrupted: null,
      onSetupComplete: null,
    };
  }

  /**
   * 连接到 Gemini Live API
   */
  async connect(config = {}) {
    const model = config.model || 'gemini-2.0-flash-exp';
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    return new Promise((resolve, reject) => {
      console.log('[Gemini] Connecting to:', wsUrl.replace(this.apiKey, '***'));
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Gemini] WebSocket connected, sending setup...');
        
        // 发送初始配置
        const setupMessage = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: config.voiceName || 'Kore',
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{
                text: config.systemPrompt || `You are a friendly English pronunciation tutor. Your role is to:
1. Listen carefully to the user's English pronunciation
2. Identify any pronunciation errors or areas for improvement
3. Provide clear, constructive feedback on their pronunciation
4. Demonstrate the correct pronunciation by speaking slowly and clearly
5. Encourage the user and celebrate their progress
6. If the user speaks in Chinese, respond in English but explain in simple terms
7. Focus on common pronunciation challenges for Chinese speakers (like "th", "r/l", "v/w" sounds)
8. Keep your responses concise and focused on pronunciation help

When correcting pronunciation:
- First, acknowledge what they said
- Point out the specific sound or word that needs improvement
- Demonstrate the correct pronunciation slowly
- Give a tip on how to position the mouth or tongue
- Ask them to try again`
              }],
            },
          },
        };

        console.log('[Gemini] Sending setup message:', JSON.stringify(setupMessage, null, 2));
        this.ws.send(JSON.stringify(setupMessage));
        this.isConnected = true;
      };

      this.ws.onclose = (event) => {
        console.log('[Gemini] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.isSetupComplete = false;
        this.callbacks.onClose?.(event);
      };

      this.ws.onerror = (error) => {
        console.error('[Gemini] WebSocket error:', error);
        this.callbacks.onError?.(error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data, resolve, reject);
      };
    });
  }

  /**
   * 处理来自服务器的消息
   */
  handleMessage(data, resolve, reject) {
    try {
      const message = JSON.parse(data);
      console.log('[Gemini] Received message:', JSON.stringify(message, null, 2).substring(0, 500));
      
      // 处理设置完成响应
      if (message.setupComplete) {
        console.log('[Gemini] Setup complete!');
        this.isSetupComplete = true;
        this.callbacks.onSetupComplete?.();
        this.callbacks.onOpen?.();
        resolve?.();
        return;
      }

      // 处理服务器内容
      if (message.serverContent) {
        const serverContent = message.serverContent;

        // 检查是否被中断
        if (serverContent.interrupted) {
          console.log('[Gemini] Interrupted');
          this.callbacks.onInterrupted?.();
          return;
        }

        // 处理模型输出
        if (serverContent.modelTurn && serverContent.modelTurn.parts) {
          for (const part of serverContent.modelTurn.parts) {
            // 处理音频数据
            if (part.inlineData && part.inlineData.data) {
              console.log('[Gemini] Received audio data, length:', part.inlineData.data.length);
              const audioData = this.base64ToArrayBuffer(part.inlineData.data);
              this.callbacks.onAudio?.(audioData);
            }
            // 处理文本数据
            if (part.text) {
              console.log('[Gemini] Received text:', part.text);
              this.callbacks.onText?.(part.text);
            }
          }
        }

        // 处理 turnComplete
        if (serverContent.turnComplete) {
          console.log('[Gemini] Turn complete');
        }
      }

      // 处理错误
      if (message.error) {
        console.error('[Gemini] Server error:', message.error);
        this.callbacks.onError?.(new Error(message.error.message || 'Server error'));
      }
    } catch (error) {
      console.error('[Gemini] Error parsing message:', error, data);
    }
  }

  /**
   * 发送实时音频数据
   */
  sendAudio(audioData) {
    if (!this.isConnected || !this.ws) {
      console.warn('[Gemini] Not connected, cannot send audio');
      return;
    }

    if (!this.isSetupComplete) {
      console.warn('[Gemini] Setup not complete, cannot send audio yet');
      return;
    }

    const base64Audio = this.arrayBufferToBase64(audioData);
    
    // 使用新的 audio 字段而不是废弃的 mediaChunks
    const message = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Audio,
        },
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送音频流结束信号
   */
  sendAudioEnd() {
    if (!this.isConnected || !this.ws || !this.isSetupComplete) {
      return;
    }

    const message = {
      realtimeInput: {
        audioStreamEnd: true,
      },
    };

    console.log('[Gemini] Sending audio stream end');
    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送文本消息
   */
  sendText(text) {
    if (!this.isConnected || !this.ws) {
      console.warn('[Gemini] Not connected');
      return;
    }

    if (!this.isSetupComplete) {
      console.warn('[Gemini] Setup not complete');
      return;
    }

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }],
        }],
        turnComplete: true,
      },
    };

    console.log('[Gemini] Sending text:', text);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.isSetupComplete = false;
    }
  }

  /**
   * 设置回调函数
   */
  on(event, callback) {
    const eventMap = {
      'open': 'onOpen',
      'close': 'onClose',
      'error': 'onError',
      'audio': 'onAudio',
      'text': 'onText',
      'interrupted': 'onInterrupted',
      'setupComplete': 'onSetupComplete',
    };
    
    const callbackName = eventMap[event];
    if (callbackName) {
      this.callbacks[callbackName] = callback;
    }
    return this;
  }

  /**
   * 工具函数：Base64 转 ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * 工具函数：ArrayBuffer 转 Base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
