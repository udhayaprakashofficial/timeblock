/**
 * Dodo checkout URLs — product IDs come from GET /api/billing/config (server env:
 * DODO_PRO_PRODUCT_ID, DODO_ANNUAL_WELCOME_PRODUCT_ID, DODO_CHECKOUT_BASE).
 * Do not use NEXT_PUBLIC_ for these on Vercel.
 */

export const FALLBACK_PRO_PRODUCT_ID = 'pdt_0NoD66xtWburRIUH8s6AY';

/** Annual welcome — founding $29/yr (limited to first 10). */
export const FALLBACK_ANNUAL_WELCOME_PRODUCT_ID =
  'pdt_0NoLjZzkv1ZVWMngsqIuU';

const TEST_CHECKOUT_BASE = 'https://test.checkout.dodopayments.com/buy';
const LIVE_CHECKOUT_BASE = 'https://checkout.dodopayments.com/buy';

function isCupkeyProductionHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'app.cupkey.io' || host.endsWith('.cupkey.io');
}

/** Prefer live checkout on Cupkey production — never send buyers to test.checkout. */
function resolveCheckoutBase(fromApi?: string | null): string {
  const raw = (fromApi || '').trim().replace(/\/$/, '');
  if (isCupkeyProductionHost()) {
    if (!raw || raw.includes('test.checkout')) return LIVE_CHECKOUT_BASE;
    return raw;
  }
  return raw || TEST_CHECKOUT_BASE;
}

export type BillingCatalog = {
  proProductId: string;
  annualWelcomeProductId: string;
  checkoutBase: string;
};

export const DEFAULT_BILLING_CATALOG: BillingCatalog = {
  proProductId: FALLBACK_PRO_PRODUCT_ID,
  annualWelcomeProductId: FALLBACK_ANNUAL_WELCOME_PRODUCT_ID,
  checkoutBase: TEST_CHECKOUT_BASE,
};

/** Map public /api/billing/config into checkout link builders. */
export function catalogFromApi(data?: {
  proProductId?: string;
  annualWelcomeProductId?: string;
  checkoutBase?: string;
} | null): BillingCatalog {
  if (!data) {
    return {
      ...DEFAULT_BILLING_CATALOG,
      checkoutBase: resolveCheckoutBase(null),
    };
  }
  return {
    proProductId: data.proProductId?.trim() || FALLBACK_PRO_PRODUCT_ID,
    annualWelcomeProductId:
      data.annualWelcomeProductId?.trim() ||
      FALLBACK_ANNUAL_WELCOME_PRODUCT_ID,
    checkoutBase: resolveCheckoutBase(data.checkoutBase),
  };
}

export type ProCheckoutCustomer = {
  id?: string;
  email?: string;
  name?: string;
};

function defaultRedirectUrl(customer?: ProCheckoutCustomer | null): string {
  const path = customer?.id?.trim()
    ? '/settings?panel=subscription'
    : '/pricing';
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.cupkey.io'
  ).replace(/\/$/, '');
  return `${base}${path}`;
}

/**
 * Static Dodo payment link for a product.
 * Prefills email/name when signed in; metadata_userId ties the webhook to the account.
 */
export function buildDodoCheckoutUrl(
  catalog: BillingCatalog,
  productId: string,
  customer?: ProCheckoutCustomer | null,
  redirectUrl?: string,
): string {
  const userId = customer?.id?.trim();
  if (!userId) {
    return '';
  }

  const url = new URL(`${catalog.checkoutBase}/${productId}`);
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
  url.searchParams.set('metadata_userId', userId);

  return url.toString();
}

export function buildProCheckoutUrl(
  catalog: BillingCatalog = DEFAULT_BILLING_CATALOG,
  customer?: ProCheckoutCustomer | null,
  redirectUrl?: string,
): string {
  return buildDodoCheckoutUrl(
    catalog,
    catalog.proProductId,
    customer,
    redirectUrl,
  );
}

export function buildAnnualWelcomeCheckoutUrl(
  catalog: BillingCatalog = DEFAULT_BILLING_CATALOG,
  customer?: ProCheckoutCustomer | null,
  redirectUrl?: string,
): string {
  return buildDodoCheckoutUrl(
    catalog,
    catalog.annualWelcomeProductId,
    customer,
    redirectUrl,
  );
}

/** Send guests to login first; returnTo resumes checkout on /pricing?buy=… */
export function loginPathBeforeCheckout(plan: 'pro' | 'annual'): string {
  const returnTo = encodeURIComponent(`/pricing?buy=${plan}`);
  return `/login?returnTo=${returnTo}`;
}
