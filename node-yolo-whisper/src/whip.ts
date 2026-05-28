export function publishWebcamToWhip(url: string, bearerToken?: string): Promise<() => void> {
  return publishToWhip(url, bearerToken, () =>
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    }),
  );
}

export function publishScreenToWhip(url: string, bearerToken?: string): Promise<() => void> {
  return publishToWhip(url, bearerToken, () =>
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
  );
}

async function publishToWhip(
  url: string,
  bearerToken: string | undefined,
  getStream: () => Promise<MediaStream>,
): Promise<() => void> {
  const mediaStream = await getStream();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });

  for (const track of mediaStream.getTracks()) {
    pc.addTransceiver(track, { direction: 'sendonly', streams: [mediaStream] });
  }

  await pc.setLocalDescription(await pc.createOffer());
  const offer = await gatherIceCandidates(pc);
  if (!offer) {
    cleanup();
    throw new Error('failed to gather ICE candidates for WHIP offer');
  }

  let location: string | null = null;
  try {
    const result = await postSdpOffer(url, offer.sdp, bearerToken);
    location = result.location;
    await pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } catch (err) {
    cleanup();
    throw err;
  }

  function cleanup() {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    pc.close();
  }

  return () => {
    cleanup();
    if (location) {
      void fetch(location, { method: 'DELETE' }).catch(() => {});
    }
  };
}

async function postSdpOffer(
  endpoint: string,
  sdpOffer: string,
  token?: string,
): Promise<{ sdp: string; location: string | null }> {
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
    throw new Error(`WHIP POST failed: ${res.status} ${await res.text()}`);
  }
  const locationHeader = res.headers.get('Location');
  const location = locationHeader ? new URL(locationHeader, endpoint).toString() : null;
  return { sdp: await res.text(), location };
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
