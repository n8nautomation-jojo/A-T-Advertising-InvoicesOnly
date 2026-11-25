import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

const lastMatchedId = (path: string) => {
  const router = createRouter({ routeTree });
  return router.matchRoutes(path).at(-1)?.routeId;
};

describe("App routing", () => {
  it("renders the agency home page at / instead of falling back to not found", () => {
    expect(lastMatchedId("/")).toBe("/");
  });

  it("renders the dedicated billing workspace at /billing", () => {
    expect(lastMatchedId("/billing")).toBe("/billing");
  });

  it("renders settings, archive and reports pages", () => {
    expect(lastMatchedId("/settings")).toBe("/settings");
    expect(lastMatchedId("/orders")).toBe("/orders");
    expect(lastMatchedId("/reports")).toBe("/reports");
  });

  it("renders the customers workspace at /customers", () => {
    expect(lastMatchedId("/customers")).toBe("/customers");
  });

  it("renders the finance, bank-accounts, suppliers and expenses pages", () => {
    expect(lastMatchedId("/finance")).toBe("/finance");
    expect(lastMatchedId("/bank-accounts")).toBe("/bank-accounts");
    expect(lastMatchedId("/suppliers")).toBe("/suppliers");
    expect(lastMatchedId("/expenses")).toBe("/expenses");
  });

  it("never falls back to the bare root route for valid pages", () => {
    expect(lastMatchedId("/billing")).not.toBe(rootRouteId);
    expect(lastMatchedId("/bank-accounts")).not.toBe(rootRouteId);
    expect(lastMatchedId("/settings")).not.toBe(rootRouteId);
    expect(lastMatchedId("/customers")).not.toBe(rootRouteId);
  });

  it("removes legacy printing press, calculator, and projects routes", () => {
    expect(lastMatchedId("/projects")).not.toBe("/projects");
    expect(lastMatchedId("/calculator")).not.toBe("/calculator");
    expect(lastMatchedId("/materials")).not.toBe("/materials");
    expect(lastMatchedId("/production")).not.toBe("/production");
    expect(lastMatchedId("/proforma-invoices")).not.toBe("/proforma-invoices");
    expect(lastMatchedId("/invoices")).not.toBe("/invoices");
  });
});
