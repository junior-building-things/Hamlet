import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/session';

export async function GET(req: Request) {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/login`);
}
