import { useEffect, useState } from 'react';
import { CallSession } from '../calls/CallSession.js';
import { callService } from '../services/call.service.js';
import { useCallStore } from '../store/callStore.js';

/** Creates the call controller for the open board. Returns null until the board session exists or when the browser has no WebRTC. */
export const callsSupported = () => typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export function useCall(session, boardId) {
  const [call, setCall] = useState(null);

  useEffect(() => {
    if (!session) return undefined;
    const { apply, setCount, reset } = useCallStore.getState();
    const offCount = session.on('callcount', setCount);
    let c = null;
    if (callsSupported()) {
      c = new CallSession({
        session, boardId,
        getIceServers: callService.iceServers,
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        PeerConnection: RTCPeerConnection,
        onChange: apply,
      });
      if (import.meta.env.DEV) window.__call = c; // handle for browser tests; absent in production builds
      setCall(c);
    }
    return () => {
      offCount();
      c?.destroy(); // leaving the board page ends the call and releases camera and microphone
      setCall(null);
      reset();
    };
  }, [session, boardId]);

  return call;
}
