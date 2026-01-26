import type { ReactNode } from "react";

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", padding: 12, width: 420 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ fontSize: 14, margin: 0 }}>{title}</h1>
        <a href="options/" style={{ fontSize: 12 }}>
          Settings
        </a>
      </div>
      {children}
    </div>
  );
}
