/**
 * Buying and selling a plot (RFC 0039), each in a sheet, loaded only when Buy or Sell is tapped.
 * Each runs the action dry first and shows what the server says it moves, then pays on a second
 * tap. The numbers and the note are the server's, never worked out here.
 */
import { PLOT_MARKET_RULES, type PlotMarketResponse, type PlotSaleView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import {
  closeOverlay,
  coinField,
  confirmTwice,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { actProblem, worldApi } from "./api/world";
import { plotMarketProblem, priceProblem, saleRows } from "./plot-market";
import { coins } from "./purse";
import { worldLinkPath } from "./world-link";
import "./plot-sale-sheet.css";

type Rules = PlotMarketResponse["rules"];
type At = { px: number; py: number };

/** The rows a dry run gives back, with its note. When the sale clears a hearth, the note leads. */
function receipt(sale: PlotSaleView, move: "buy" | "list", rules: Rules): HTMLElement[] {
  const rows = itemRows(
    saleRows(sale, move, rules).map((r) =>
      itemRow({
        plain: true,
        name: r.label,
        trail: h("span", { class: "sale-value", text: r.value }),
      }),
    ),
    { className: "plot-sale-receipt" },
  );
  const note = h("p", { class: "hint plot-sale-note", text: sale.note });
  return sale.clearsHearth ? [note, rows] : [rows, note];
}

/**
 * Buy plot `at`, called `title`, for `price`: a dry `buy_plot` as the sheet opens says what it
 * moves, then the buy goes on a second tap. `done` reads the market again once it went through.
 * `rules` are the market's answer's, and the protocol's own where the page has none (the world).
 */
export function openBuySheet(
  at: At,
  title: string,
  price: number,
  done: () => void,
  rules: Rules = PLOT_MARKET_RULES,
) {
  const problem = errorLine("plot-buy-problem");
  const shown = h("div", {
    class: "stack tight plot-sale-shown",
    attrs: { "aria-live": "polite" },
  });
  const buy = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "plot-buy" },
    text: `Buy for ${coins(price)}`,
  });
  const words = (code: string, message: string) => plotMarketProblem(code, message, rules, "buy");
  const s = sheet(
    {
      id: "plot-buy-title",
      title,
      lede: "It's sold as it stands. Nothing on it changes until it sells.",
    },
    shown,
    problem,
    buy,
  );
  confirmTwice(buy, `Tap again to pay ${coins(price)}`, async () => {
    problem.textContent = "";
    await actFromButton(buy, { type: "buy_plot", px: at.px, py: at.py }, "The plot is yours.", {
      words,
      say: (text) => {
        if (text !== "The plot is yours.") {
          problem.textContent = text;
          return;
        }
        closeOverlay(s.dialog);
        toast(text, { href: worldLinkPath({ kind: "plot", ...at }), label: "Go there" });
      },
      after: done,
    });
  });
  openOverlay(s.dialog);
  void (async () => {
    const r = await whileBusy(
      buy,
      () => worldApi.act({ type: "buy_plot", px: at.px, py: at.py, dry: true }),
      "Checking…",
    );
    const why = actProblem(r, words);
    const sale = r.ok && r.data.ok ? r.data.plotSale : undefined;
    if (why || !sale) {
      problem.textContent = why ?? "Couldn't check the sale. Try again.";
      buy.disabled = true;
      return;
    }
    shown.replaceChildren(...receipt(sale, "buy", rules));
  })();
}

/**
 * Put plot `at` up for sale, under the sheet title `title` ("Sell your home"): a price, "Check
 * the sale" (a dry `list_plot`) to see what listing costs and what a sale would bring, then the
 * listing on a second tap. Changing the price clears what was checked. `done` reads the market
 * again once it went through.
 */
export function openListSheet(at: At, title: string, rules: Rules, done: () => void) {
  const problem = errorLine("plot-list-problem");
  const price = coinField({ id: "plot-price", max: rules.priceMax });
  const check = h("button", {
    class: "pill-button",
    attrs: { type: "button", id: "plot-check" },
    text: "Check the sale",
  });
  const shown = h("div", {
    class: "stack tight plot-sale-shown",
    attrs: { "aria-live": "polite" },
  });
  const list = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "plot-list", hidden: true },
    text: `List for ${coins(rules.listingFee)}`,
  });
  const words = (code: string, message: string) => plotMarketProblem(code, message, rules, "list");
  const s = sheet(
    {
      id: "plot-list-title",
      title,
      lede: `A buyer gets everything on it, as it stands. Listing costs ${coins(rules.listingFee)}, which doesn't come back, and nothing on the plot changes until it sells or you take it back.`,
    },
    h("label", {
      class: "field-label plot-price-label",
      attrs: { for: "plot-price" },
      text: "Price for the plot",
    }),
    h("div", { class: "coin-row" }, price, check),
    shown,
    problem,
    list,
  );
  // What was checked was for that price: a new one is checked again.
  price.addEventListener("input", () => {
    shown.replaceChildren();
    list.hidden = true;
    problem.textContent = "";
  });
  check.addEventListener("click", async () => {
    const bad = priceProblem(price.value, rules);
    problem.textContent = bad ?? "";
    if (bad) return price.focus();
    const asked = Number(price.value);
    const r = await whileBusy(
      check,
      () => worldApi.act({ type: "list_plot", px: at.px, py: at.py, price: asked, dry: true }),
      "Checking…",
    );
    const why = actProblem(r, words);
    const sale = r.ok && r.data.ok ? r.data.plotSale : undefined;
    if (why || !sale) {
      problem.textContent = why ?? "Couldn't check the sale. Try again.";
      return;
    }
    shown.replaceChildren(...receipt(sale, "list", rules));
    list.hidden = false;
  });
  confirmTwice(list, `Tap again to pay ${coins(rules.listingFee)}`, async () => {
    problem.textContent = "";
    await actFromButton(
      list,
      { type: "list_plot", px: at.px, py: at.py, price: Number(price.value) },
      "Your plot is for sale.",
      {
        words,
        say: (text) => {
          if (text !== "Your plot is for sale.") {
            problem.textContent = text;
            return;
          }
          closeOverlay(s.dialog);
          toast(text);
        },
        after: done,
      },
    );
  });
  openOverlay(s.dialog);
  price.focus();
}
