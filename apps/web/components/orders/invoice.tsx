"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { amountInWords } from "@/lib/orders";
import type { Order } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { formatDateTime } from "./order-parts";

const pct = (rate: string) => `${Number(rate).toString()}%`;

/**
 * GST tax invoice for a confirmed order, printable from the browser. Every figure comes from the order's stored
 * snapshot (seller details, addresses, rates and amounts at the time of sale), so later catalogue or settings
 * changes don't alter an issued invoice. Delivery is taxed at the order's highest item rate.
 */
export function Invoice({ order }: { order: Order }) {
  if (!order.invoiceNumber)
    return <Alert tone="info" title="No invoice yet">An invoice is issued once the order is confirmed{order.paymentMethod === "Online" ? " and paid" : ""}.</Alert>;
  const intra = order.seller.stateCode === order.shipTo.stateCode;
  const lineTaxable = order.lines.reduce((s, l) => s + Number(l.taxable), 0);
  const lineTax = order.lines.reduce((s, l) => s + Number(l.cgst) + Number(l.sgst) + Number(l.igst), 0);
  const shipTaxable = Math.round((Number(order.taxable) - lineTaxable) * 100) / 100;
  const shipTax = Math.round((Number(order.cgst) + Number(order.sgst) + Number(order.igst) - lineTax) * 100) / 100;
  // Same split as the API's GstCalculator: SGST is half rounded down to the paisa, CGST takes the remainder.
  const shipSgst = Math.floor((shipTax * 100) / 2) / 100;
  const shipRate = order.lines.reduce((m, l) => Math.max(m, Number(l.gstRate)), 0);
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <Button variant="secondary" onClick={() => window.print()}><Printer />Print or save as PDF</Button>
      </div>
      <article className="rounded-[var(--radius-card)] border border-border bg-white p-6 text-[13px] text-slate-900 print:border-0 print:p-0" aria-label={`Tax invoice ${order.invoiceNumber}`}>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-lg font-bold">Tax invoice</h1>
            <p className="mt-1 font-semibold">{order.seller.legalName || order.seller.name}</p>
            {order.seller.legalName && order.seller.name && order.seller.legalName !== order.seller.name && <p>Trading as {order.seller.name}</p>}
            {order.seller.address && <p className="max-w-xs whitespace-pre-line">{order.seller.address}</p>}
            <p>State: {order.seller.stateName} ({order.seller.stateCode})</p>
            <p>GSTIN: {order.seller.gstin ?? "Not registered"}</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-right">
            <dt className="text-slate-600">Invoice no.</dt><dd className="font-semibold">{order.invoiceNumber}</dd>
            <dt className="text-slate-600">Invoice date</dt><dd>{formatDateTime(order.invoiceIssuedAt)}</dd>
            <dt className="text-slate-600">Order</dt><dd>#{order.number}</dd>
            <dt className="text-slate-600">Payment</dt><dd>{order.paymentMethod === "Cod" ? "Cash on delivery" : "Paid online"}</dd>
          </dl>
        </header>
        <section className="grid gap-4 border-b border-slate-300 py-4 sm:grid-cols-2">
          <div>
            <h2 className="font-semibold">Bill to / ship to</h2>
            <p>{order.shipTo.name}</p>
            <p>{order.shipTo.line1}{order.shipTo.line2 && `, ${order.shipTo.line2}`}</p>
            <p>{order.shipTo.city}, {order.shipTo.stateName} {order.shipTo.pincode}</p>
            <p>{order.shipTo.phone} · {order.email}</p>
          </div>
          <div className="sm:text-right">
            <p><span className="text-slate-600">Place of supply:</span> {order.shipTo.stateName} ({order.shipTo.stateCode})</p>
            <p><span className="text-slate-600">Tax type:</span> {intra ? "CGST + SGST (intra-state)" : "IGST (inter-state)"}</p>
            <p><span className="text-slate-600">Reverse charge:</span> No</p>
          </div>
        </section>
        <div className="overflow-x-auto py-4">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Item</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">HSN/SAC</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Qty</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Rate</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Discount</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Taxable value</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">GST</th>
                {intra ? <><th scope="col" className="py-1.5 pr-2 text-right font-medium">CGST</th><th scope="col" className="py-1.5 pr-2 text-right font-medium">SGST</th></>
                  : <th scope="col" className="py-1.5 pr-2 text-right font-medium">IGST</th>}
                <th scope="col" className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {order.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{l.productTitle}{l.variantLabel && <span className="block text-slate-600">{l.variantLabel}</span>}<span className="block text-slate-600">SKU {l.sku}</span></td>
                  <td className="py-1.5 pr-2">{l.hsnCode ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{l.quantity}</td>
                  <td className="py-1.5 pr-2 text-right">{formatINR(l.unitPrice)}</td>
                  <td className="py-1.5 pr-2 text-right">{Number(l.discount) ? formatINR(l.discount) : "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{formatINR(l.taxable)}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(l.gstRate)}</td>
                  {intra ? <><td className="py-1.5 pr-2 text-right">{formatINR(l.cgst)}</td><td className="py-1.5 pr-2 text-right">{formatINR(l.sgst)}</td></>
                    : <td className="py-1.5 pr-2 text-right">{formatINR(l.igst)}</td>}
                  <td className="py-1.5 text-right">{formatINR(l.lineTotal)}</td>
                </tr>
              ))}
              {Number(order.shipping) > 0 && (
                <tr className="border-b border-slate-200">
                  <td className="py-1.5 pr-2">{order.lines.length + 1}</td>
                  <td className="py-1.5 pr-2">Delivery charges</td>
                  <td className="py-1.5 pr-2">9965</td>
                  <td className="py-1.5 pr-2 text-right">1</td>
                  <td className="py-1.5 pr-2 text-right">{formatINR(order.shipping)}</td>
                  <td className="py-1.5 pr-2 text-right">—</td>
                  <td className="py-1.5 pr-2 text-right">{formatINR(shipTaxable)}</td>
                  <td className="py-1.5 pr-2 text-right">{shipRate}%</td>
                  {intra ? <><td className="py-1.5 pr-2 text-right">{formatINR(shipTax - shipSgst)}</td><td className="py-1.5 pr-2 text-right">{formatINR(shipSgst)}</td></>
                    : <td className="py-1.5 pr-2 text-right">{formatINR(shipTax)}</td>}
                  <td className="py-1.5 text-right">{formatINR(order.shipping)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-6 border-t border-slate-300 pt-4">
          <p className="max-w-sm"><span className="text-slate-600">Amount in words:</span> {amountInWords(order.total)}</p>
          <dl className="grid min-w-56 grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 tabular-nums">
            <dt className="text-slate-600">Taxable value</dt><dd className="text-right">{formatINR(order.taxable)}</dd>
            {intra ? <><dt className="text-slate-600">CGST</dt><dd className="text-right">{formatINR(order.cgst)}</dd><dt className="text-slate-600">SGST</dt><dd className="text-right">{formatINR(order.sgst)}</dd></>
              : <><dt className="text-slate-600">IGST</dt><dd className="text-right">{formatINR(order.igst)}</dd></>}
            <dt className="border-t border-slate-300 pt-1 font-semibold">Invoice total</dt><dd className="border-t border-slate-300 pt-1 text-right font-semibold">{formatINR(order.total)}</dd>
            {/* A gift card is a means of payment, not a discount: the taxable value above is unchanged. */}
            {Number(order.giftCardAmount) > 0 && <><dt className="text-slate-600">Paid by gift card</dt><dd className="text-right">{formatINR(order.giftCardAmount)}</dd></>}
          </dl>
        </div>
        {(order.status === "Cancelled" || Number(order.refundedTotal) > 0) && (
          <p className="mt-4 rounded border border-slate-300 p-2">
            {order.status === "Cancelled" ? `This order was cancelled on ${formatDateTime(order.cancelledAt)}. ` : ""}
            {Number(order.refundedTotal) > 0 ? `${formatINR(order.refundedTotal)} has been refunded against this invoice.` : ""}
          </p>
        )}
        <p className="mt-6 text-slate-600">This is a computer-generated invoice and needs no signature.</p>
      </article>
    </div>
  );
}
