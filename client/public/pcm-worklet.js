class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      this.samples.push(
        sample < 0 ? sample * 32768 : sample * 32767
      );
    }

    while (this.samples.length >= 512) {
      const frame = this.samples.splice(0, 512);
      const pcm = new Int16Array(frame);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);