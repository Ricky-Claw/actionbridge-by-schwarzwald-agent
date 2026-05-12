export type ActionBridgeResolvedAddressFamily = 4 | 6;

export interface ActionBridgeResolvedAddress {
  address: string;
  family: ActionBridgeResolvedAddressFamily;
}

export interface ActionBridgeDnsResolutionSnapshot {
  hostname: string;
  addresses: ActionBridgeResolvedAddress[];
  networkExecution: false;
}

export interface ActionBridgeDnsPinningDecision {
  ok: boolean;
  reason?: string;
  hostname: string;
  addresses: ActionBridgeResolvedAddress[];
  networkExecution: false;
}

const PRIVATE_HOST_PREFIXES = ['127.', '10.', '172.', '192.168', '169.254'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::', '::1']);

function normalizeActionBridgeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isValidIpv4Part(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) return false;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 255;
}

export function isActionBridgePrivateIpAddress(address: string): boolean {
  const normalized = normalizeActionBridgeHost(address);
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (PRIVATE_HOST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized.includes('::ffff:')) return true;

  const ipv4Parts = normalized.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every(isValidIpv4Part)) {
    const [a, b] = ipv4Parts.map((part) => Number(part));
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }

  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

export function isActionBridgeBlockedHost(hostname: string): boolean {
  const normalized = normalizeActionBridgeHost(hostname);
  if (isActionBridgePrivateIpAddress(normalized)) return true;
  return normalized.endsWith('.local') || normalized.endsWith('.internal');
}

export function decideActionBridgeDnsPinning(snapshot: ActionBridgeDnsResolutionSnapshot): ActionBridgeDnsPinningDecision {
  const hostname = normalizeActionBridgeHost(snapshot.hostname);
  if (isActionBridgeBlockedHost(hostname)) {
    return { ok: false, hostname, addresses: snapshot.addresses, reason: 'Blocked connector hostname.', networkExecution: false };
  }
  if (!snapshot.addresses.length) {
    return { ok: false, hostname, addresses: [], reason: 'DNS resolution returned no addresses.', networkExecution: false };
  }
  const blockedAddress = snapshot.addresses.find((entry) => isActionBridgePrivateIpAddress(entry.address));
  if (blockedAddress) {
    return { ok: false, hostname, addresses: snapshot.addresses, reason: 'DNS resolution included private or link-local address.', networkExecution: false };
  }
  return { ok: true, hostname, addresses: snapshot.addresses, networkExecution: false };
}
