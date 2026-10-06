/**
 * Dodo checkout URLs — product IDs come from GET /api/billing/config (server env:
 * DODO_PRO_PRODUCT_ID, DODO_ANNUAL_WELCOME_PRODUCT_ID, DODO_CHECKOUT_BASE).
 * Do not use NEXT_PUBLIC_ for these on Vercel.
 */

export const FALLBACK_PRO_PRODUCT_ID = 'pdt_0NoD66xtWburRIUH8s6AY';

/** Annual welcome — one-time $12/yr (limited seats). */
export const FALLBACK_ANNUAL_WELCOME_PRODUCT_ID =
  'pdt_0NoLjZzkv1ZVWMngsqIuU';

/** TEMPORARY — ₹1 live smoke test. Remove when told. */
export const FALLBACK_LIVE_TESTING_PRODUCT_ID =
  'pdt_0NpAOr1ey195dTkMgmjik';

const FALLBACK_CHECKOUT_BASE =
  'https://test.checkout.dodopayments.com/buy';

export type BillingCatalog = {
  proProductId: string;
  annualWelcomeProductId: string;
  checkoutBase: string;
  /** TEMPORARY ₹1 live smoke test — remove when told */
  liveTestingPayment?: boolean;
  liveTestingProductId?: string;
};

export const DEFAULT_BILLING_CATALOG: BillingCatalog = {
  proProductId: FALLBACK_PRO_PRODUCT_ID,
  annualWelcomeProductId: FALLBACK_ANNUAL_WELCOME_PRODUCT_ID,
  checkoutBase: FALLBACK_CHECKOUT_BASE,
  liveTestingPayment: true,
  liveTestingProductId: FALLBACK_LIVE_TESTING_PRODUCT_ID,
};

/** Map public /api/billing/config into checkout link builders. */
export function catalogFromApi(data?: {
  proProductId?: string;
  annualWelcomeProductId?: string;
  checkoutBase?: string;
  liveTestingPayment?: boolean;
  liveTestingProductId?: string;
} | null): BillingCatalog {
  if (!data) return DEFAULT_BILLING_CATALOG;
  return {
    proProductId: data.proProductId?.trim() || FALLBACK_PRO_PRODUCT_ID,
    annualWelcomeProductId:
      data.annualWelcomeProductId?.trim() ||
      FALLBACK_ANNUAL_WELCOME_PRODUCT_ID,
    checkoutBase: (
      data.checkoutBase?.trim() || FALLBACK_CHECKOUT_BASE
    ).replace(/\/$/, ''),
    // TEMPORARY — always expose ₹1 test product until removed
    liveTestingPayment: true,
    liveTestingProductId:
      data.liveTestingProductId?.trim() || FALLBACK_LIVE_TESTING_PRODUCT_ID,
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

/** TEMPORARY — ₹1 live payment smoke test. Remove when told. */
const LIVE_TESTING_CHECKOUT_BASE =
  'https://checkout.dodopayments.com/buy';

export function buildLiveTestingCheckoutUrl(
  catalog: BillingCatalog = DEFAULT_BILLING_CATALOG,
  customer?: ProCheckoutCustomer | null,
  redirectUrl?: string,
): string {
  const productId = catalog.liveTestingProductId?.trim();
  if (!productId) return '';
  // ₹1 product is Live-mode in Dodo — never open test.checkout (404 not-found).
  return buildDodoCheckoutUrl(
    { ...catalog, checkoutBase: LIVE_TESTING_CHECKOUT_BASE },
    productId,
    customer,
    redirectUrl,
  );
}

/** Send guests to login first; returnTo resumes checkout on /pricing?buy=… */
export function loginPathBeforeCheckout(plan: 'pro' | 'annual'): string {
  const returnTo = encodeURIComponent(`/pricing?buy=${plan}`);
  return `/login?returnTo=${returnTo}`;
}
