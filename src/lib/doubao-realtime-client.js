/**
 * 豆包端到端实时语音大模型 WebSocket 客户端
 * 基于火山引擎豆包语音 API
 */

export class DoubaoRealtimeClient {
  constructor(config) {
    this.appId = config.appId;
    this.accessToken = config.accessToken;
    this.ws = null;
    this.isConnected = false;
    this.isSessionStarted = false;
    this.sessionId = this.generateUUID();
    
    this.callbacks = {
      onOpen: null,
      onClose: null,
      onError: null,
      onAudio: null,
      onText: null,
      onASRText: null,
      onSessionStarted: null,
      onTTSStart: null,
      onTTSEnd: null,
    };
  }

  /**
   * 生成 UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 连接到豆包实时语音 API（通过本地代理）
   */
  async connect() {
    // 连接到本地代理服务器（代理会处理认证 headers）
    const wsUrl = `ws://${window.location.hostname}:3001/ws`;

    return new Promise((resolve, reject) => {
      console.log('[Doubao] Connecting to proxy:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[Doubao] WebSocket connected');
        this.isConnected = true;
        // 发送 StartConnection 事件
        this.sendStartConnection();
      };

      this.ws.onclose = (event) => {
        console.log('[Doubao] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.isSessionStarted = false;
        this.callbacks.onClose?.(event);
      };

      this.ws.onerror = (error) => {
        console.error('[Doubao] WebSocket error:', error);
        this.callbacks.onError?.(error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data, resolve, reject);
      };
    });
  }

  /**
   * 构建二进制协议帧
   */
  buildFrame(messageType, eventId, payload, sessionId = null) {
    const isAudio = messageType === 0x02;
    const serialization = isAudio ? 0x00 : 0x01;
    const flags = 0x04; // has event

    // Header: 4 bytes
    const header = new Uint8Array(4);
    header[0] = 0x11; // Protocol version 1, Header size 1
    header[1] = (messageType << 4) | flags;
    header[2] = (serialization << 4) | 0x00;
    header[3] = 0x00;

    // Event ID: 4 bytes (big-endian)
    const eventIdBytes = new Uint8Array(4);
    new DataView(eventIdBytes.buffer).setUint32(0, eventId, false);

    // Session ID (for session-level events, eventId >= 100)
    let sessionIdSizeBytes = new Uint8Array(0);
    let sessionIdBytes = new Uint8Array(0);
    
    if (sessionId && eventId >= 100) {
      sessionIdBytes = new TextEncoder().encode(sessionId);
      sessionIdSizeBytes = new Uint8Array(4);
      new DataView(sessionIdSizeBytes.buffer).setUint32(0, sessionIdBytes.length, false);
    }

    // Payload
    let payloadBytes;
    if (typeof payload === 'string') {
      payloadBytes = new TextEncoder().encode(payload);
    } else if (payload instanceof ArrayBuffer) {
      payloadBytes = new Uint8Array(payload);
    } else if (payload instanceof Uint8Array) {
      payloadBytes = payload;
    } else {
      payloadBytes = new Uint8Array(0);
    }

    // Payload size: 4 bytes (big-endian)
    const payloadSizeBytes = new Uint8Array(4);
    new DataView(payloadSizeBytes.buffer).setUint32(0, payloadBytes.length, false);

    // Combine all parts
    const totalLength = header.length + eventIdBytes.length + 
                       sessionIdSizeBytes.length + sessionIdBytes.length +
                       payloadSizeBytes.length + payloadBytes.length;
    
    const frame = new Uint8Array(totalLength);
    let offset = 0;
    
    frame.set(header, offset); offset += header.length;
    frame.set(eventIdBytes, offset); offset += eventIdBytes.length;
    frame.set(sessionIdSizeBytes, offset); offset += sessionIdSizeBytes.length;
    frame.set(sessionIdBytes, offset); offset += sessionIdBytes.length;
    frame.set(payloadSizeBytes, offset); offset += payloadSizeBytes.length;
    frame.set(payloadBytes, offset);

    return frame;
  }

  /**
   * 发送 StartConnection 事件 (事件 ID: 1)
   */
  sendStartConnection() {
    console.log('[Doubao] Sending StartConnection...');
    const frame = this.buildFrame(0x01, 1, '{}');
    this.ws.send(frame);
  }

  /**
   * 发送 StartSession 事件 (事件 ID: 100)
   */
  sendStartSession(config = {}) {
    console.log('[Doubao] Sending StartSession...');
    this.sessionId = this.generateUUID();
    
    const payload = {
      asr: {
        audio_info: {
          format: 'pcm',
          sample_rate: 16000,
          channel: 1
        }
      },
      tts: {
        audio_config: {
          channel: 1,
          format: 'pcm_s16le',
          sample_rate: 24000
        },
        speaker: config.speaker || 'zh_female_vv_jupiter_bigtts'
      },
      dialog: {
        bot_name: config.botName || 'English Tutor',
        system_role: config.systemRole || `你是一个友好的英语发音教练。你的任务是：
1. 仔细听用户的英语发音
2. 识别发音错误或需要改进的地方
3. 提供清晰、建设性的发音反馈
4. 用缓慢清晰的语音示范正确发音
5. 鼓励用户并庆祝他们的进步
6. 如果用户说中文，用英语回答但用简单的词汇解释
7. 重点关注中国人常见的发音挑战（如 "th"、"r/l"、"v/w" 音）
8. 保持回复简洁，专注于发音帮助`,
        speaking_style: config.speakingStyle || '你说话温和友善，像一个耐心的老师。',
        extra: {
          model: 'O',
          strict_audit: false,
          input_mod: 'keep_alive' // 支持麦克风静音时不超时
        }
      }
    };

    const frame = this.buildFrame(0x01, 100, JSON.stringify(payload), this.sessionId);
    this.ws.send(frame);
  }

  /**
   * 发送音频数据 (事件 ID: 200)
   */
  sendAudio(audioData) {
    if (!this.isConnected || !this.isSessionStarted) {
      return;
    }

    const frame = this.buildFrame(0x02, 200, audioData, this.sessionId);
    this.ws.send(frame);
  }

  /**
   * 发送文本消息 (事件 ID: 501)
   */
  sendText(text) {
    if (!this.isConnected || !this.isSessionStarted) {
      console.warn('[Doubao] Not ready to send text');
      return;
    }

    console.log('[Doubao] Sending text:', text);
    const payload = JSON.stringify({ content: text });
    const frame = this.buildFrame(0x01, 501, payload, this.sessionId);
    this.ws.send(frame);
  }

  /**
   * 发送 FinishSession 事件 (事件 ID: 102)
   */
  sendFinishSession() {
    if (!this.isConnected) return;
    
    console.log('[Doubao] Sending FinishSession...');
    const frame = this.buildFrame(0x01, 102, '{}', this.sessionId);
    this.ws.send(frame);
    this.isSessionStarted = false;
  }

  /**
   * 解析服务端返回的二进制帧
   */
  parseFrame(data) {
    const view = new DataView(data);
    let offset = 0;

    // Header (4 bytes)
    const header1 = view.getUint8(1);
    const header2 = view.getUint8(2);
    offset = 4;

    const messageType = (header1 >> 4) & 0x0F;
    const flags = header1 & 0x0F;

    const hasEvent = (flags & 0x04) !== 0;
    const isError = messageType === 0x0F;
    const isAudioResponse = messageType === 0x0B;

    let eventId = 0;
    if (hasEvent) {
      eventId = view.getUint32(offset, false);
      offset += 4;
    }

    // Error code (if error frame)
    if (isError && (flags & 0x0F) === 0x0F) {
      // Skip error code
      offset += 4;
    }

    // Session ID (for session-level responses, eventId >= 50)
    let sessionId = null;
    if (eventId >= 50 && offset + 4 <= data.byteLength) {
      const sessionIdSize = view.getUint32(offset, false);
      offset += 4;
      if (sessionIdSize > 0 && offset + sessionIdSize <= data.byteLength) {
        const sessionIdBytes = new Uint8Array(data, offset, sessionIdSize);
        sessionId = new TextDecoder().decode(sessionIdBytes);
        offset += sessionIdSize;
      }
    }

    // Payload size and payload
    let payload = null;
    if (offset + 4 <= data.byteLength) {
      const payloadSize = view.getUint32(offset, false);
      offset += 4;
      if (payloadSize > 0 && offset + payloadSize <= data.byteLength) {
        if (isAudioResponse) {
          // Return audio as ArrayBuffer
          payload = data.slice(offset, offset + payloadSize);
        } else {
          const payloadBytes = new Uint8Array(data, offset, payloadSize);
          payload = new TextDecoder().decode(payloadBytes);
          try {
            payload = JSON.parse(payload);
          } catch (e) {
            // Keep as string
          }
        }
      }
    }

    return { messageType, eventId, sessionId, payload, isAudio: isAudioResponse, isError };
  }

  /**
   * 处理服务端消息
   */
  handleMessage(data, resolve, reject) {
    try {
      const frame = this.parseFrame(data);
      
      if (frame.eventId !== 352) { // Don't log audio frames
        console.log('[Doubao] Received event:', frame.eventId, frame.isAudio ? '(audio)' : '', frame.payload);
      }

      switch (frame.eventId) {
        case 50: // ConnectionStarted
          console.log('[Doubao] Connection started');
          this.sendStartSession();
          break;

        case 51: // ConnectionFailed
          console.error('[Doubao] Connection failed:', frame.payload);
          this.callbacks.onError?.(new Error(frame.payload?.error || 'Connection failed'));
          reject?.(new Error('Connection failed'));
          break;

        case 150: // SessionStarted
          console.log('[Doubao] Session started, dialog_id:', frame.payload?.dialog_id);
          this.isSessionStarted = true;
          this.callbacks.onSessionStarted?.(frame.payload);
          this.callbacks.onOpen?.();
          resolve?.();
          break;

        case 152: // SessionFinished
          console.log('[Doubao] Session finished');
          this.isSessionStarted = false;
          break;

        case 153: // SessionFailed
          console.error('[Doubao] Session failed:', frame.payload);
          this.callbacks.onError?.(new Error(frame.payload?.error || 'Session failed'));
          break;

        case 350: // TTSSentenceStart
          console.log('[Doubao] TTS started:', frame.payload?.tts_type);
          this.callbacks.onTTSStart?.(frame.payload);
          break;

        case 351: // TTSSentenceEnd
          break;

        case 352: // TTSResponse (音频数据)
          if (frame.isAudio && frame.payload) {
            this.callbacks.onAudio?.(frame.payload);
          }
          break;

        case 359: // TTSEnded
          console.log('[Doubao] TTS ended');
          this.callbacks.onTTSEnd?.();
          break;

        case 450: // ASRInfo
          console.log('[Doubao] ASR info (user speaking detected)');
          break;

        case 451: // ASRResponse
          if (frame.payload?.results) {
            const text = frame.payload.results.map(r => r.text).join('');
            const isInterim = frame.payload.results.some(r => r.is_interim);
            console.log('[Doubao] ASR:', text, isInterim ? '(interim)' : '(final)');
            this.callbacks.onASRText?.(text, isInterim);
          }
          break;

        case 459: // ASREnded
          console.log('[Doubao] ASR ended (user stopped speaking)');
          break;

        case 550: // ChatResponse
          if (frame.payload?.content) {
            this.callbacks.onText?.(frame.payload.content);
          }
          break;

        case 553: // ChatTextQueryConfirmed
          console.log('[Doubao] Text query confirmed');
          break;

        case 559: // ChatEnded
          console.log('[Doubao] Chat ended');
          break;

        case 599: // DialogCommonError
          console.error('[Doubao] Dialog error:', frame.payload);
          this.callbacks.onError?.(new Error(frame.payload?.message || 'Dialog error'));
          break;

        default:
          if (frame.isError) {
            console.error('[Doubao] Error frame:', frame.payload);
          }
      }
    } catch (error) {
      console.error('[Doubao] Error parsing message:', error);
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.isSessionStarted) {
      this.sendFinishSession();
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.isSessionStarted = false;
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
      'asrText': 'onASRText',
      'sessionStarted': 'onSessionStarted',
      'ttsStart': 'onTTSStart',
      'ttsEnd': 'onTTSEnd',
    };
    
    const callbackName = eventMap[event];
    if (callbackName) {
      this.callbacks[callbackName] = callback;
    }
    return this;
  }
}
