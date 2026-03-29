import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/session';

export async function GET() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
    : '/login');
}
