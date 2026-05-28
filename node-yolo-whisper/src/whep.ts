export type WhepConnection = {
  stream: MediaStream;
  pc: RTCPeerConnection;
  close: () => void;
};

export async function connectToWhepServer(
  url: string,
  bearerToken?: string,
): Promise<WhepConnection> {
  const stream = new MediaStream();
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });

  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.addTransceiver('video', { direction: 'recvonly' });

  const onTrackPromise = new Promise<void>((resolve) => {
    pc.ontrack = (event) => {
      stream.addTrack(event.track);
      if (stream.getAudioTracks().length >= 1 && stream.getVideoTracks().length >= 1) {
        resolve();
      }
    };
  });

  await new Promise<void>((resolve) => {
    pc.addEventListener('negotiationneeded', () => resolve(), { once: true });
  });

  await pc.setLocalDescription(await pc.createOffer());
  const offer = await gatherIceCandidates(pc);
  if (!offer) throw new Error('failed to gather ICE candidates for WHEP offer');

  const { sdp: answerSdp } = await postSdpOffer(url, offer.sdp, bearerToken);
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  await onTrackPromise;

  return {
    stream,
    pc,
    close: () => pc.close(),
  };
}

async function postSdpOffer(
  endpoint: string,
  sdpOffer: string,
  token?: string,
): Promise<{ sdp: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'content-type': 'application/sdp',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: sdpOffer,
  });
  if (res.status !== 201) {
    throw new Error(`WHEP POST failed: ${res.status} ${await res.text()}`);
  }
  return { sdp: await res.text() };
}

async function gatherIceCandidates(pc: RTCPeerConnection): Promise<RTCSessionDescription | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(pc.localDescription), 2000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve(pc.localDescription);
      }
    };
  });
}
