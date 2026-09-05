import { NextResponse } from "next/server";
import { SLEEPER_BASE } from "@/lib/sleeper";

export const dynamic = "force-dynamic";

export async function GET() {
  const response = await fetch(`${SLEEPER_BASE}/players/nfl`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to load Sleeper players" }, { status: 502 });
  }

  const data = await response.json();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
