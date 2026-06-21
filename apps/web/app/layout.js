import "./globals.css";
import Navbar from "../components/Navbar.js";
import StyledJsxRegistry from "./registry.js";
import I18nShell from "../components/I18nShell.jsx";

// `metadata` is the SSR-painted default. The client `I18nShell` overwrites
// `document.title` reactively to keep the tab title in sync with the
// active locale (English by default; Chinese after a toggle).
export const metadata = {
  title: "RatePath - Mortgage Strategy Simulator",
  description: "Simulate future interest-rate scenarios, compare split strategies, and optimise your mortgage.",
  applicationName: "RatePath",
  appleWebApp: {
    capable: true,
    title: "RatePath",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

// In Next.js 16, themeColor and colorScheme belong in the `viewport` export
// (not `metadata`). The `width: "device-width"` initial-scale pair is
// **critical for mobile**: without it mobile browsers render the page at
// 980px wide and scale it down, which means our `@media (max-width: 720px)`
// rules never trigger and the desktop 3-column grids squeeze into ~330px
// viewports, mangling the choice cards. See `node_modules/next/dist/docs/
// 01-app/03-api-reference/04-functions/generate-viewport.md`.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e1b4b",
  colorScheme: "dark",
};

/**
 * @param {{ children: any }} props
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en-NZ">
      <body>
        <StyledJsxRegistry>
          <I18nShell initialLocale="en-NZ">
            <div className="app-container">
              <Navbar />
              <main className="main-content">
                {children}
              </main>
            </div>
          </I18nShell>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
