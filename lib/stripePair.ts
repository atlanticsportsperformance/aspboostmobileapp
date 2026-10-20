/**
 * The payment routes return a matched (publishable_key, stripe_account) pair.
 * The two are only valid TOGETHER: never mix the server's account with the
 * baked key, or the server's key with a stale account.
 *
 *  - legacy pair: platform pk + ASP's connected account id
 *  - direct pair: ASP's own pk + stripe_account null
 *
 * stripeAccountId is included only when the server sent a non-empty account.
 * Omitting it is what clears a previously-set account: the native initialise
 * (iOS StripeSdkImpl / Android StripeSdkModule, stripe-react-native 0.50.x)
 * assigns the missing value as nil/null rather than keeping the old one.
 */
export function stripeInitParams(
  serverPk: string | undefined | null,
  serverAccount: string | null | undefined,
  fallbackPk: string
): { publishableKey: string; stripeAccountId?: string } {
  const publishableKey = serverPk || fallbackPk;
  return serverAccount ? { publishableKey, stripeAccountId: serverAccount } : { publishableKey };
}
