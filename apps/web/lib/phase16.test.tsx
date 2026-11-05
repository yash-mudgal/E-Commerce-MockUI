import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseBlocks, RichText } from "@/components/store/rich-text";

describe("store page text", () => {
  it("splits headings, lists and paragraphs", () => {
    expect(parseBlocks("## Returns\nWithin 7 days.\nUnused items only.\n\n- Sarees\n- Kurtas\nThanks")).toEqual([
      { type: "h2", text: "Returns" },
      { type: "p", text: "Within 7 days.\nUnused items only." },
      { type: "ul", items: ["Sarees", "Kurtas"] },
      { type: "p", text: "Thanks" },
    ]);
  });

  it("never renders the merchant's text as HTML", () => {
    const html = renderToStaticMarkup(<RichText source={'<script>alert(1)</script> **bold** <img src=x onerror=alert(1)>'} />);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong");
  });

  it("only links to web and email addresses", () => {
    const html = renderToStaticMarkup(<RichText source={"[Write to us](mailto:help@example.com) [x](javascript:alert(1)) [site](https://example.com)"} />);
    expect(html).toContain('href="mailto:help@example.com"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="javascript:'); // left as plain text
  });
});
