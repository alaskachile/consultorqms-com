import type { ReactNode } from "react";

export const metadata = {
  title: "ConsultorQMS",
  description: "QMS guiado por IA para preparar auditorías ISO.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          margin: 0,
          padding: "2rem",
          background: "#0b1220",
          color: "#e7ecf3",
        }}
      >
        {children}
      </body>
    </html>
  );
}
