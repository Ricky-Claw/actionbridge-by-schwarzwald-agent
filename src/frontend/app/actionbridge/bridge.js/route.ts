export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createActionBridgeBridgeScript } from '@/lib/actionbridge/bridge-handshake';

export async function GET() {
  return new NextResponse(createActionBridgeBridgeScript(), {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
