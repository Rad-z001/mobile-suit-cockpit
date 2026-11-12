// CR-003 transport: free serverless WebRTC through Trystero (Nostr public relays for matchmaking only;
// game data then flows peer-to-peer over encrypted data channels). Owner: manager.
//
// Transport interface (the only transport; net/index.js drives it):
//   connect(code) -> Promise<void>      selfId: string
//   send(kind, data, to?)               to = peer id for a directed message, else broadcast
//   onMessage(fn(kind, data, from))     onJoin(fn(id))     onLeave(fn(id))
//   leave()
// Messages are reliable and ordered per peer (WebRTC data channel).
import { joinRoom, selfId } from '@trystero-p2p/nostr';

const APP_ID = 'iron-coffin-uc0105-cr003';

export function createP2PTransport() {
  let room = null;
  let sendFn = null;
  const handlers = { message: [], join: [], leave: [] };
  const emit = (k, ...a) => { for (const f of handlers[k]) { try { f(...a); } catch (e) { console.error(e); } } };

  return {
    kind: 'p2p',
    get selfId() { return selfId; },
    async connect(code) {
      room = joinRoom({ appId: APP_ID }, 'ic-' + code, {
        onJoinError: (d) => console.warn('[net] p2p join error', d && d.error),
      });
      const action = room.makeAction('m');
      sendFn = action.send;
      action.onMessage = (msg, meta) => {
        const from = meta && (meta.peerId || meta);
        if (!msg || typeof msg.k !== 'string') return;
        emit('message', msg.k, msg.d, typeof from === 'string' ? from : String(from));
      };
      room.onPeerJoin = (id) => emit('join', id);
      room.onPeerLeave = (id) => emit('leave', id);
    },
    send(kind, data, to) {
      if (!sendFn) return;
      const p = sendFn({ k: kind, d: data }, to ? { target: to } : undefined);
      if (p && p.catch) p.catch(() => {});
    },
    onMessage(fn) { handlers.message.push(fn); },
    onJoin(fn) { handlers.join.push(fn); },
    onLeave(fn) { handlers.leave.push(fn); },
    leave() { try { room && room.leave(); } catch (e) { /* ignore */ } room = null; sendFn = null; },
  };
}
