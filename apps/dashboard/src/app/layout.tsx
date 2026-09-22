import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "agent-ops",
  description: "Review what the triage agent did to your mailbox",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;650&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
          rel="stylesheet"
        />
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
