import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIGIA | Centro de monitoreo",
  description: "Prototipo de vigilancia comunitaria distribuida",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
