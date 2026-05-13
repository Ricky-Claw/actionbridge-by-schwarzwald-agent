import 'server-only';

import { digestActionBridgeSetupLinkToken } from './setup-links';
import { isPrivateActionBridgeHost } from './http-connector';

export interface ActionBridgeBridgeHandshakeInput {
  token: unknown;
  origin: unknown;
  bridgeVersion?: unknown;
}

export interface ActionBridgeBridgeHandshakeDraft {
  tokenDigest: string;
  origin: string;
  bridgeVersion: string;
}

export function normalizeActionBridgeHandshakeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsedUrl: URL;
  try { parsedUrl = new URL(value); } catch { return null; }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl.origin;
}

export function parseActionBridgeBridgeHandshake(input: ActionBridgeBridgeHandshakeInput): ActionBridgeBridgeHandshakeDraft | null {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token.startsWith('absl_') || token.length < 12 || token.length > 160) return null;
  const origin = normalizeActionBridgeHandshakeOrigin(input.origin);
  if (!origin) return null;
  const bridgeVersion = typeof input.bridgeVersion === 'string' && input.bridgeVersion.length <= 40
    ? input.bridgeVersion.trim() || 'bridge.v1'
    : 'bridge.v1';
  return { tokenDigest: digestActionBridgeSetupLinkToken(token), origin, bridgeVersion };
}

export function createActionBridgeBridgeScript(): string {
  return `(function(){
  var script=document.currentScript;
  var token=script&&script.getAttribute('data-setup-token');
  var endpoint=(script&&script.getAttribute('data-endpoint'))||'/api/actionbridge/bridge/handshake';
  window.ActionBridge=window.ActionBridge||{status:'loading',version:'bridge.v1'};
  if(!token){window.ActionBridge.status='missing_setup_token';return;}
  fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({token:token,origin:window.location.origin,bridgeVersion:'bridge.v1'})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,json:j};});})
    .then(function(res){window.ActionBridge.status=res.ok?'connected':'blocked';window.ActionBridge.lastResult=res.json;})
    .catch(function(){window.ActionBridge.status='failed';});
})();`;
}
