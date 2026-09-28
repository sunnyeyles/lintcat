/** The "here is your shipping quote" email. */
import { quoteShipment, type ShipmentRequest } from "../pricing/quote.js";
import { renderTemplate } from "./templates.js";

const QUOTE_BODY = [
  "Hi {{name}},",
  "",
  "{{carrier}} can take your parcel for {{total}}.",
  "Delivery usually takes {{etaDays}} working days.",
  "",
  "— The Parcelry team",
].join("\n");

export interface QuoteEmail {
  subject: string;
  body: string;
}

export async function buildQuoteEmail(
  name: string,
  request: ShipmentRequest,
): Promise<QuoteEmail> {
  const quote = await quoteShipment(request);
  return {
    subject: `Your ${quote.carrier} shipping quote`,
    body: renderTemplate(QUOTE_BODY, {
      name,
      carrier: quote.carrier,
      total: quote.total,
      etaDays: quote.etaDays,
    }),
  };
}
