import "./globals.css";
import Navbar from "../components/Navbar.js";
import StyledJsxRegistry from "./registry.js";

export const metadata = {
  title: "RatePath - 房贷策略模拟 App",
  description: "基于多未来利率情景，对不同固定期限、拆分比例和重新定价风险进行模拟比较的房贷策略实验室。",
};

/**
 * @param {{ children: any }} props
 */
export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <StyledJsxRegistry>
          <div className="app-container">
            <Navbar />
            <main className="main-content">
              {children}
            </main>
          </div>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
