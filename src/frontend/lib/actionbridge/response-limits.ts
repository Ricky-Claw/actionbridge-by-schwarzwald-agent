export interface ActionBridgeResponseLimitPolicy {
  maxBytes: number;
  maxJsonDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
}

export const defaultActionBridgeResponseLimitPolicy: ActionBridgeResponseLimitPolicy = {
  maxBytes: 64 * 1024,
  maxJsonDepth: 8,
  maxArrayItems: 200,
  maxObjectKeys: 200,
};

export function summarizeActionBridgeResponseLimitPolicy(
  policy: ActionBridgeResponseLimitPolicy = defaultActionBridgeResponseLimitPolicy
): Record<string, number> {
  return {
    maxBytes: policy.maxBytes,
    maxJsonDepth: policy.maxJsonDepth,
    maxArrayItems: policy.maxArrayItems,
    maxObjectKeys: policy.maxObjectKeys,
  };
}

export function enforceActionBridgeResponseByteLimit(
  body: string,
  policy: ActionBridgeResponseLimitPolicy = defaultActionBridgeResponseLimitPolicy
): { ok: boolean; reason?: string; bytes: number } {
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > policy.maxBytes) {
    return { ok: false, reason: 'ActionBridge response exceeds byte limit.', bytes };
  }
  return { ok: true, bytes };
}
