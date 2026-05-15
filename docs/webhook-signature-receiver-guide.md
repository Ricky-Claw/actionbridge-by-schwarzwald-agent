# Webhook-v1 Signature Receiver Guide

## Headers
Signed Webhook-v1 requests include:

- `X-ActionBridge-Version: actionbridge.webhook.v1`
- `X-ActionBridge-Timestamp: <ISO timestamp>`
- `X-ActionBridge-Event-Id: <execution id>`
- `X-ActionBridge-Idempotency-Digest: sha256:<digest>`
- `X-ActionBridge-Signature: sha256=<hex hmac>`

Unsigned controlled-pilot requests omit `X-ActionBridge-Signature` and should be accepted only when explicitly authorized by the customer/operator.

## Verification Algorithm
Receiver should verify:

1. Request is HTTPS and reaches the expected endpoint.
2. `X-ActionBridge-Version` equals `actionbridge.webhook.v1`.
3. Timestamp is fresh enough for the receiver policy, e.g. ±5 minutes.
4. Body is read exactly as received before parsing.
5. Compute HMAC-SHA256 over:

```text
<timestamp>.<raw JSON body>
```

6. Compare against `X-ActionBridge-Signature` using constant-time comparison.
7. Enforce idempotency using `X-ActionBridge-Event-Id` and/or `X-ActionBridge-Idempotency-Digest`.

## Node Example

```ts
import crypto from 'node:crypto';

function verifyActionBridgeSignature(headers: Headers, rawBody: string, secret: string): boolean {
  const timestamp = headers.get('x-actionbridge-timestamp') || '';
  const signature = headers.get('x-actionbridge-signature') || '';
  if (!timestamp || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

## Receiver Rejection Rules
Reject when:
- signature missing but signed mode is required;
- timestamp missing/stale;
- duplicate event/idempotency digest is already processed;
- version is unexpected;
- payload schema does not match the authorized action.

## Security Note
Never send the shared secret to ActionBridge clients, agents, tool catalogs, browser pages, logs, or support chats. Store it only in the receiver secret store and ActionBridge server-side secret reference mechanism.
