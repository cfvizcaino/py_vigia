import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIGIA | Centro de monitoreo",
  description: "Consola de operaciones VIGIA: cámaras comunitarias, consultas vehiculares y trayectorias estimadas en Barranquilla.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
