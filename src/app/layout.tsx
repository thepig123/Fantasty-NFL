import type { Metadata } from "next";
import "./globals.css";
import SimpleCoach from "./SimpleCoach";

export const metadata: Metadata = {
  title: "Fantasy Copilot",
  description: "A simple Sleeper fantasy football decision dashboard with weekly guidance, lineup help, waivers and trades.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SimpleCoach />
        {children}
      </body>
    </html>
  );
}
