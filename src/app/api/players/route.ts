import { NextResponse } from "next/server";
import { SLEEPER_BASE } from "@/lib/sleeper";

export const revalidate = 86400;

export async function GET() {
  const response = await fetch(`${SLEEPER_BASE}/players/nfl`, {
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to load Sleeper players" }, { status: 502 });
  }

  const data = await response.json();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" },
  });
}