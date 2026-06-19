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
  themeColor: "#1e1b4b",
  colorScheme: "dark",
  appleWebApp: {
    capable: true,
    title: "RatePath",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
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
