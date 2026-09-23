/** Dodo Payments — Cupkey Pro ($10/mo). Override via env for live mode. */

export const DODO_PRO_PRODUCT_ID =
  process.env.NEXT_PUBLIC_DODO_PRO_PRODUCT_ID?.trim() ||
  'pdt_0NoD66xtWburRIUH8s6AY';

const DEFAULT_CHECKOUT_BASE =
  'https://test.checkout.dodopayments.com/buy';

function checkoutBase(): string {
  return (
    process.env.NEXT_PUBLIC_DODO_CHECKOUT_BASE?.trim() || DEFAULT_CHECKOUT_BASE
  ).replace(/\/$/, '');
}

function defaultRedirectUrl(customer?: ProCheckoutCustomer | null): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    // Signed-in checkout returns to Subscription so we can confirm payment_id
    if (customer?.id?.trim()) {
      return `${window.location.origin}/subscription`;
    }
    return `${window.location.origin}/pricing`;
  }
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.cupkey.io'
  ).replace(/\/$/, '');
  return customer?.id?.trim() ? `${base}/subscription` : `${base}/pricing`;
}

export type ProCheckoutCustomer = {
  id?: string;
  email?: string;
  name?: string;
};

/**
 * Static Dodo payment link for Pro.
 * Prefills email/name when signed in; metadata_userId ties the webhook to the account.
 * @see https://docs.dodopayments.com/developer-resources/integration-guide
 */
export function buildProCheckoutUrl(
  customer?: ProCheckoutCustomer | null,
  redirectUrl?: string,
): string {
  const url = new URL(`${checkoutBase()}/${DODO_PRO_PRODUCT_ID}`);
  url.searchParams.set('quantity', '1');
  url.searchParams.set(
    'redirect_url',
    redirectUrl || defaultRedirectUrl(customer),
  );

  const email = customer?.email?.trim();
  if (email) {
    url.searchParams.set('email', email);
    url.searchParams.set('disableEmail', 'true');
  }
  const name = customer?.name?.trim();
  if (name) {
    url.searchParams.set('fullName', name);
  }
  const userId = customer?.id?.trim();
  if (userId) {
    url.searchParams.set('metadata_userId', userId);
  }

  return url.toString();
}
