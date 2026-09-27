import { redirect } from 'next/navigation';

/** Dodo checkout used to return here; app billing UI lives on /pricing. */
export default async function SubscriptionRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') qs.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
  }
  const tail = qs.toString();
  redirect(tail ? `/pricing?${tail}` : '/pricing');
}
