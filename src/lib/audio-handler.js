/**
 * 音频处理模块
 * 处理麦克风录音和音频播放
 * 适配豆包实时语音 API 格式要求
 */

export class AudioHandler {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.isRecording = false;
    this.onAudioData = null;
    
    // 播放相关
    this.playbackContext = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.nextPlayTime = 0;
  }

  /**
   * 初始化音频上下文
   */
  async init() {
    // 录音用的 AudioContext (16kHz - 豆包输入要求)
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    
    // 播放用的 AudioContext (24kHz - 豆包输出采样率)
    this.playbackContext = new AudioContext({ sampleRate: 24000 });
    
    // 注册 AudioWorklet 处理器
    await this.registerWorklet();
  }

  /**
   * 注册音频处理 Worklet
   * 豆包要求：PCM、单声道、采样率16000、int16、小端序
   * 推荐 20ms 一包，即 640 字节 (16000 * 0.02 * 2)
   */
  async registerWorklet() {
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = [];
          this.bufferSize = 320; // 20ms at 16kHz = 320 samples
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input[0]) {
            const channelData = input[0];
            
            // 将浮点数转换为 16-bit PCM (小端序)
            for (let i = 0; i < channelData.length; i++) {
              const sample = Math.max(-1, Math.min(1, channelData[i]));
              const pcmSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
              this.buffer.push(Math.round(pcmSample));
            }

            // 当缓冲区达到 20ms 时发送数据
            while (this.buffer.length >= this.bufferSize) {
              const pcmData = new Int16Array(this.buffer.splice(0, this.bufferSize));
              this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
            }
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  }

  /**
   * 开始录音
   */
  async startRecording(onAudioData) {
    this.onAudioData = onAudioData;

    try {
      // 请求麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 确保 AudioContext 是运行状态
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 创建音频源
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 创建 AudioWorklet 节点
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');
      
      // 处理来自 Worklet 的音频数据
      this.workletNode.port.onmessage = (event) => {
        if (this.isRecording && this.onAudioData) {
          this.onAudioData(event.data);
        }
      };

      // 连接节点
      source.connect(this.workletNode);
      // 不需要连接到 destination，避免回声
      // this.workletNode.connect(this.audioContext.destination);

      this.isRecording = true;
      console.log('[Audio] Recording started (16kHz, 20ms packets)');
    } catch (error) {
      console.error('[Audio] Error starting recording:', error);
      throw error;
    }
  }

  /**
   * 停止录音
   */
  stopRecording() {
    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    console.log('[Audio] Recording stopped');
  }

  /**
   * 播放 PCM 音频数据
   * 豆包返回格式：PCM、单声道、24000Hz、16bit、小端序
   * @param {ArrayBuffer} pcmData - 16-bit PCM 音频数据
   */
  playAudio(pcmData) {
    if (!this.playbackContext) {
      console.warn('[Audio] Playback context not initialized');
      return;
    }

    // 确保播放上下文是运行状态
    if (this.playbackContext.state === 'suspended') {
      this.playbackContext.resume();
    }

    // 将 PCM 数据转换为 Float32 格式
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    // 创建 AudioBuffer (24kHz)
    const audioBuffer = this.playbackContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    // 创建 BufferSource 并播放
    const source = this.playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.playbackContext.destination);

    // 计算播放时间，确保音频连续播放
    const currentTime = this.playbackContext.currentTime;
    const startTime = Math.max(currentTime, this.nextPlayTime);
    
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;
  }

  /**
   * 停止播放并清空队列
   */
  stopPlayback() {
    this.audioQueue = [];
    this.nextPlayTime = 0;
    
    if (this.playbackContext && this.playbackContext.state === 'running') {
      // 创建一个新的 AudioContext 来停止所有播放
      this.playbackContext.close();
      this.playbackContext = new AudioContext({ sampleRate: 24000 });
    }
  }

  /**
   * 释放所有资源
   */
  dispose() {
    this.stopRecording();
    this.stopPlayback();
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
  }
}
