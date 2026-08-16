"use client";

import { useEffect, useState } from "react";

type Advice = {
  title: string;
  text: string;
  tone: "good" | "attention" | "neutral";
};

function getAdvice(now: Date): Advice {
  const day = now.getDay();
  const hour = now.getHours() + now.getMinutes() / 60;

  if (day === 0) {
    if (hour < 17.5) {
      return {
        title: "Today: final lineup check later",
        text: "Come back around 18:30 Norway time, refresh, fix injuries and make any recommended lineup changes before the common 19:00 kickoffs.",
        tone: "neutral",
      };
    }
    if (hour < 19) {
      return {
        title: "Do this now: set your lineup",
        text: "Refresh the app, check injuries and make the recommended changes in Sleeper. Many Sunday players lock when their games start around 19:00.",
        tone: "attention",
      };
    }
    if (hour < 22.5) {
      return {
        title: "Some players are already locked",
        text: "Players whose games started cannot normally be moved. Players in the later Sunday games may still be changeable until their own kickoff around 22:05–22:25.",
        tone: "attention",
      };
    }
    return {
      title: "Most of your work for this week is done",
      text: "Late-night games are still running, but there is usually nothing you need to do unless one of your remaining players has not kicked off yet.",
      tone: "good",
    };
  }

  if (day === 1 || day === 2) {
    return {
      title: "Today: check waivers",
      text: "Look for useful free players and submit any add/drop claims in Sleeper. This is the main early-week job.",
      tone: "attention",
    };
  }

  if (day === 3 || day === 4) {
    return {
      title: "Today: quick roster check",
      text: "See whether waivers changed your team and check new injury flags. You usually do not need to do much else yet.",
      tone: "neutral",
    };
  }

  return {
    title: "Today: mostly wait",
    text: "Keep an eye on injury flags. Your important final check is usually Sunday around 18:30 Norway time.",
    tone: "good",
  };
}

export default function SimpleCoach() {
  const [advice, setAdvice] = useState<Advice | null>(null);

  useEffect(() => {
    const update = () => setAdvice(getAdvice(new Date()));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!advice) return null;

  return (
    <aside className={`simpleCoach ${advice.tone}`}>
      <div className="simpleCoachInner">
        <div className="simpleCoachNow">
          <span className="simpleCoachLabel">Simple mode</span>
          <strong>{advice.title}</strong>
          <span>{advice.text}</span>
        </div>
        <div className="simpleCoachRule">
          <strong>Your whole weekly routine</strong>
          <span><b>Tue/Wed:</b> waivers</span>
          <span><b>Sun ~18:30:</b> lineup + injuries</span>
          <span><b>Trades:</b> only when you get/want an offer</span>
        </div>
      </div>
      <div className="simpleCoachTimes">
        <span><b>Typical Norway kickoffs:</b></span>
        <span>Sun 19:00</span>
        <span>Sun ~22:05–22:25</span>
        <span>Overnight ~01:15–02:20</span>
        <span className="simpleCoachFine">Players usually lock individually when their own game starts. Times can shift around daylight-saving weeks.</span>
      </div>
    </aside>
  );
}
