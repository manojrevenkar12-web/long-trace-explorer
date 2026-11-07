import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { cssVariables } from "@/src/shared/theme";

export const metadata = { title: "Long trace explorer", description: "Open agent traces with hundreds of thousands of spans without waiting." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{cssVariables()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
