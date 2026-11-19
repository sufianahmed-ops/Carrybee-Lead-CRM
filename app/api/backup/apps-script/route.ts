import { NextResponse } from 'next/server';
import { z } from 'zod';
import { beginAppsScriptBackup, finishAppsScriptBackup, readAppsScriptBackupChunk } from '@/lib/apps-script-backup';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const completeSchema = z.object({
  action: z.literal('complete'), runId: z.number().int().positive(), success: z.boolean(),
  leads: z.number().int().nonnegative().default(0), logs: z.number().int().nonnegative().default(0),
  message: z.string().max(1500).optional(),
});

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (body?.action === 'begin') return NextResponse.json(await beginAppsScriptBackup());
    const input = completeSchema.parse(body);
    return NextResponse.json(await finishAppsScriptBackup(input));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url);
    return NextResponse.json(await readAppsScriptBackupChunk(
      Number(url.searchParams.get('runId')),
      url.searchParams.get('sheet') || '',
      Number(url.searchParams.get('chunk') || '0'),
    ));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 400 });
  }
}
