import { cleanup, render, screen } from "@testing-library/react";
import { Package } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { EmptyState } from "./display";
import { Field, Input } from "./form";

afterEach(cleanup);

describe("Field", () => {
  it("links label, hint and control", () => {
    render(<Field label="SKU" hint="Letters and numbers"><Input /></Field>);
    const input = screen.getByLabelText("SKU");
    expect(input).toHaveProperty("tagName", "INPUT");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe("Letters and numbers");
  });

  it("marks the control invalid and announces the error instead of the hint", () => {
    render(<Field label="Price" hint="Incl. GST" error="Must be more than 0"><Input /></Field>);
    const input = screen.getByLabelText("Price");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Must be more than 0");
    expect(screen.queryByText("Incl. GST")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
  });
});

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveProperty("disabled", true);
    expect(b.getAttribute("aria-busy")).toBe("true");
  });
});

describe("EmptyState", () => {
  it("renders a heading, explanation and action", () => {
    render(<EmptyState icon={Package} title="No products yet" description="Add one to start selling." action={<Button>Add product</Button>} />);
    expect(screen.getByRole("heading", { name: "No products yet" })).toBeTruthy();
    expect(screen.getByText("Add one to start selling.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add product" })).toBeTruthy();
  });
});
