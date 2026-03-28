import { NextResponse } from 'next/server';
import { fetchUserStories } from '@/lib/meego';

export async function GET() {
  // TikTok project key
  const projectKey = process.env.MEEGO_PROJECT_KEY ?? '5f105019a8b9a853da64767f';

  try {
    const features = await fetchUserStories(projectKey);
    return NextResponse.json({ features });
  } catch (err) {
    console.error('Failed to fetch Meego features:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch features' },
      { status: 500 }
    );
  }
}
