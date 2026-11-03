import type { Metadata, Viewport } from "next";
import { DM_Sans, Poppins } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const display = Poppins({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-display", display: "swap" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "VIGÍA | De observaciones aisladas a recorridos posibles",
  description: "VIGÍA convierte las detecciones de cámaras comunitarias en trayectorias estimadas de vehículos. Consola de operaciones del piloto en Barranquilla.",
};

export const viewport: Viewport = { themeColor: "#090119", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es" className={`${display.variable} ${body.variable}`}><body>{children}</body></html>;
}
