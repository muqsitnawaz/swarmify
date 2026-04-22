// WebRTC client for OpenAI Realtime API.
//
// Minimal surface:
//   - connect(ephemeralKey, model, sessionUpdate, handlers) -> ForemanSession
//   - session.sendToolResult(callId, result)
//   - session.close()
//
// Handlers fire for the events we care about: transcripts (user + assistant),
// tool calls from the model, and session lifecycle.

export interface ForemanTranscriptEvent {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export interface ForemanToolCallEvent {
  callId: string;
  name: string;
  args: unknown;
}

export interface ForemanHandlers {
  onTranscript?: (e: ForemanTranscriptEvent) => void;
  onToolCall?: (e: ForemanToolCallEvent) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'closed' | 'error', detail?: string) => void;
}

export interface ForemanSession {
  sendToolResult: (callId: string, result: unknown) => void;
  close: () => void;
  isOpen: () => boolean;
}

const REALTIME_URL = 'https://api.openai.com/v1/realtime';

export async function connectForeman(
  ephemeralKey: string,
  model: string,
  sessionUpdate: Record<string, unknown>,
  handlers: ForemanHandlers
): Promise<ForemanSession> {
  handlers.onStatus?.('connecting');

  const pc = new RTCPeerConnection();
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.style.display = 'none';
  document.body.appendChild(audioEl);

  pc.ontrack = (ev) => {
    audioEl.srcObject = ev.streams[0];
  };

  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mic.getAudioTracks()) {
    pc.addTrack(track, mic);
  }

  const dc = pc.createDataChannel('oai-events');
  let open = false;

  dc.addEventListener('open', () => {
    open = true;
    dc.send(JSON.stringify(sessionUpdate));
    handlers.onStatus?.('connected');
  });

  dc.addEventListener('close', () => {
    open = false;
    handlers.onStatus?.('closed');
    audioEl.remove();
    mic.getTracks().forEach((t) => t.stop());
  });

  dc.addEventListener('message', (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    route(msg, handlers);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(`${REALTIME_URL}?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      'Content-Type': 'application/sdp',
    },
    body: offer.sdp ?? '',
  });

  if (!sdpRes.ok) {
    handlers.onStatus?.('error', `SDP handshake failed: ${sdpRes.status}`);
    pc.close();
    audioEl.remove();
    mic.getTracks().forEach((t) => t.stop());
    throw new Error(`SDP exchange failed with status ${sdpRes.status}`);
  }

  const answerSdp = await sdpRes.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  return {
    sendToolResult(callId: string, result: unknown) {
      if (!open) return;
      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          },
        })
      );
      dc.send(JSON.stringify({ type: 'response.create' }));
    },
    close() {
      if (dc.readyState === 'open' || dc.readyState === 'connecting') dc.close();
      pc.close();
      audioEl.remove();
      mic.getTracks().forEach((t) => t.stop());
    },
    isOpen() {
      return open;
    },
  };
}

function route(msg: any, h: ForemanHandlers) {
  const type: string = msg?.type ?? '';

  // User speech transcribed locally by Whisper-1.
  if (type === 'conversation.item.input_audio_transcription.completed') {
    h.onTranscript?.({ role: 'user', text: msg.transcript ?? '', final: true });
    return;
  }

  // Assistant text deltas (if text modality) and full items.
  if (type === 'response.audio_transcript.delta') {
    h.onTranscript?.({ role: 'assistant', text: msg.delta ?? '', final: false });
    return;
  }
  if (type === 'response.audio_transcript.done') {
    h.onTranscript?.({ role: 'assistant', text: msg.transcript ?? '', final: true });
    return;
  }

  // Tool call: model finished emitting arguments for a function call.
  if (type === 'response.function_call_arguments.done') {
    const callId: string = msg.call_id ?? msg.id ?? '';
    const name: string = msg.name ?? '';
    let args: unknown = {};
    try {
      args = msg.arguments ? JSON.parse(msg.arguments) : {};
    } catch {
      args = {};
    }
    h.onToolCall?.({ callId, name, args });
    return;
  }

  if (type === 'error') {
    h.onStatus?.('error', msg.error?.message ?? 'unknown');
  }
}
