import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "Vega Pharma Plus · ERP",
  description: "Sistema de gestión para botica: ventas, inventario, SUNAT y DIGEMID",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
