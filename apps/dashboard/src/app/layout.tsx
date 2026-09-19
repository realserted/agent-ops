import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "agent-ops",
  description: "Approval queue and trace viewer for the inbox triage agent",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            agent-ops
          </Link>
          <nav>
            <Link href="/">Runs</Link>
            <Link href="/approvals" data-testid="nav-approvals">
              Approvals
            </Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
