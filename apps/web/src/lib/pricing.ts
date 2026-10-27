import type { DiscountRule, PriceBasis, PriceRule, TaxRate } from '@edustrux/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../i18n';
import { api } from './api';
import { orgApiPath, useOrg } from './org';
import type { Page } from './people';
import { can } from './roles';

/** Every row of a settings list: they are short, so all pages are read. */
async function readAll<T>(fetchPage: (cursor?: string) => Promise<Page<T>>) {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    all.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

function useSettingsList<T>(name: string, path: string, enabled = true) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: [name, membership.org.id],
    queryFn: ({ signal }) =>
      readAll<T>((cursor) =>
        api<Page<T>>(
          'GET',
          orgApiPath(membership, `${path}?limit=200${cursor ? `&cursor=${cursor}` : ''}`),
          { signal },
        ),
      ),
    enabled,
    staleTime: 30_000,
  });
}

export const useTaxRates = () => useSettingsList<TaxRate>('tax-rates', '/tax-rates');
export const usePriceRules = () => useSettingsList<PriceRule>('price-rules', '/price-rules');
export function useDiscountRules() {
  const { membership } = useOrg();
  // Teachers and parents can't read discounts (D-140).
  const reads = can(membership.role, 'billing:read') && membership.role !== 'parent';
  return useSettingsList<DiscountRule>('discount-rules', '/discount-rules', reads);
}

/** After a change on the pricing settings: the lists, and what is priced from them. */
export function useRefreshPricing() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  return () =>
    Promise.all(
      ['tax-rates', 'price-rules', 'discount-rules', 'courses'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, orgId] }),
      ),
    );
}

/** 1500 → "15%", 1250 → "12.5%". */
export function percentLabel(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** "12.5" → 1250 basis points; null when it isn't a percentage with up to two decimals. */
export function parsePercent(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** "Per term", "Per lesson"… */
export function basisLabel(basis: PriceBasis) {
  return t(`pricing.basis.${basis}`);
}
