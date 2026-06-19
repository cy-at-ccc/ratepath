// @ts-nocheck — React-component tests; JSDoc strict-mode type checks on
// `useState`/`useEffect` initialiser narrowing are out of scope here.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { I18nProvider, LOCALE_STORAGE_KEY } from "../I18nProvider.jsx";
import { useI18n } from "../useI18n.js";
import enNZ from "@/messages/en-NZ.json";
import zhCN from "@/messages/zh-CN.json";

beforeEach(() => {
  // Reset localStorage and document state between tests.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = "";
  }
});

function Probe() {
  const { locale, setLocale, t, formatMoney, formatPercent, productDisplayName } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="t.costLow">{t("opt.pro.costLow")}</span>
      <span data-testid="t.missing">{t("some.missing.key")}</span>
      <span data-testid="t.withVar">{t("strategyDetail.metricExpectedMaxPayment", { freq: "fortnightly" })}</span>
      <span data-testid="money">{formatMoney(450000)}</span>
      <span data-testid="pct">{formatPercent(0.0525, 2)}</span>
      <span data-testid="prod.floating">{productDisplayName("floating")}</span>
      <span data-testid="prod.fixed1y">{productDisplayName("fixed-1y")}</span>
      <button data-testid="switchToZh" onClick={() => setLocale("zh-CN")}>zh</button>
      <button data-testid="switchToEn" onClick={() => setLocale("en-NZ")}>en</button>
    </div>
  );
}

describe("I18nProvider", () => {
  it("defaults to English and renders English translations", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId("locale").textContent).toBe("en-NZ");
    expect(screen.getByTestId("t.costLow").textContent).toBe(enNZ["opt.pro.costLow"]);
    expect(screen.getByTestId("t.withVar").textContent).toBe("Expected max fortnightly payment");
    expect(screen.getByTestId("prod.floating").textContent).toBe("Floating Rate");
    expect(screen.getByTestId("prod.fixed1y").textContent).toBe("1 Year Fixed");
  });

  it("returns the bracketed key for missing translations", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId("t.missing").textContent).toBe("[some.missing.key]");
  });

  it("switches to Chinese and renders the Chinese dictionary", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId("switchToZh"));
    });
    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    expect(screen.getByTestId("t.costLow").textContent).toBe(zhCN["opt.pro.costLow"]);
    expect(screen.getByTestId("prod.floating").textContent).toBe("浮动利率");
  });

  it("formats money with the active locale's group separator", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId("money").textContent).toBe("$450,000");
  });

  it("formats percentages with two default digits", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId("pct").textContent).toBe("5.25%");
  });

  it("persists the active locale to localStorage", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId("switchToZh"));
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("updates document.documentElement.lang on locale change", () => {
    render(
      <I18nProvider initialLocale="en-NZ">
        <Probe />
      </I18nProvider>
    );
    expect(document.documentElement.lang).toBe("en-NZ");
    act(() => {
      fireEvent.click(screen.getByTestId("switchToZh"));
    });
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("ignores unsupported locale values on setLocale", () => {
    function ProbeSet() {
      const { setLocale, t } = useI18n();
      return (
        <div>
          <span data-testid="t.costLow">{t("opt.pro.costLow")}</span>
          <button data-testid="bad" onClick={() => setLocale("xx-YY")}>x</button>
        </div>
      );
    }
    render(
      <I18nProvider initialLocale="en-NZ">
        <ProbeSet />
      </I18nProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId("bad"));
    });
    // Locale didn't change; the English string is still showing.
    expect(screen.getByTestId("t.costLow").textContent).toBe(enNZ["opt.pro.costLow"]);
  });

  it("throws when useI18n is called outside the provider", () => {
    // The provider enforces its boundary: any descendant that calls
    // useI18n outside <I18nProvider> gets a clear error.
    const consoleError = console.error;
    console.error = () => {};
    expect(() => render(<Probe />)).toThrow(/useI18n/);
    console.error = consoleError;
  });
});
