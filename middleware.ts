import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';

// Paths that don't require authentication
const PUBLIC = ['/login', '/access-limited', '/api/auth/', '/api/agents/webhook', '/api/digests/run', '/api/digests/refresh', '/api/digests/section/', '/api/meego/ai-node', '/api/lark/card-action', '/api/admin/inspect-prd', '/api/admin/inspect-workitem-fields', '/api/admin/send-ab-concluded', '/api/admin/send-ab-open', '/api/admin/append-cc-to-post', '/api/admin/letjr-draft', '/api/admin/create-prd-doc', '/api/admin/duplicate-prd', '/api/cards/'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const user = await verifySession(token);
    if (user) return NextResponse.next();
  }

  // Logged-out users hitting protected routes see the access-limited page,
  // not the login page (which is still reachable directly at /login).
  return NextResponse.redirect(new URL('/access-limited', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.ico|.*\\.jpg|.*\\.webp).*)'],
};
