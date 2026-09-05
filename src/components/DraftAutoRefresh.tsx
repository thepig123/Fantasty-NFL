"use client";

import { useEffect } from "react";

const POLL_MS = 5000;

function draftTabIsActive() {
  return Array.from(document.querySelectorAll(".nav button")).some(
    (button) => button.classList.contains("active") && button.textContent?.trim() === "Draft",
  );
}

function clickRefreshButton() {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Refresh data",
  ) as HTMLButtonElement | undefined;

  if (button && !button.disabled) button.click();
}

export default function DraftAutoRefresh() {
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!draftTabIsActive()) return;
      clickRefreshButton();
    }, POLL_MS);

    return () => window.clearInterval(interval);
  }, []);

  return null;
}
