import { request } from './api.js';

export const callService = {
  /** STUN (and TURN, when the server has one configured) for this user. */
  iceServers: async () => (await request('/calls/ice')).iceServers,
};
