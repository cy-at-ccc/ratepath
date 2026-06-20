"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// -----------------------------------------------------------------------------
// Homepage redirect: "/" → "/lab"
//
// The new public homepage is the 6-question Easy Strategy wizard at "/lab".
// This thin page replaces the old Mortgage Dashboard (贷款控制面板) which is
// a planned PREMIUM-tier page; its source is preserved at
// apps/web/app/_legacy/dashboard/page.js so it can be re-wired into the
// nav when the premium system is built.
//
// See apps/web/CLAUDE.md → "Hidden Premium Pages" for context.
// -----------------------------------------------------------------------------

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/lab");
  }, [router]);
  return null;
}
