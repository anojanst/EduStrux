import type { DiscountRule, PriceRule, TaxRate } from '@edustrux/shared';
import { BadgePercent, Plus, Receipt, Tag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageError, PageHeader } from '../../components/PageState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { OverflowMenu, type MenuItem } from '../../components/ui/Menu';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { useCourseLabel, useCoursesPath } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { useFormat } from '../../lib/format';
import { orgApiPath, useOrg } from '../../lib/org';
import {
  basisLabel,
  percentLabel,
  useDiscountRules,
  usePriceRules,
  useRefreshPricing,
  useTaxRates,
} from '../../lib/pricing';
import { can } from '../../lib/roles';
import { ConfirmDialog } from '../people/dialogs';
import { EmptyState, SkeletonRows } from '../people/parts';
import {
  DiscountRuleDialog,
  PriceRuleDialog,
  TaxRateDialog,
  useAllClasses,
} from './pricingDialogs';

type Tab = 'prices' | 'discounts' | 'tax';
const TABS: Tab[] = ['prices', 'discounts', 'tax'];

type Open =
  | { kind: 'price'; rule?: PriceRule }
  | { kind: 'deletePrice'; rule: PriceRule }
  | { kind: 'discount'; rule?: DiscountRule }
  | { kind: 'deleteDiscount'; rule: DiscountRule }
  | { kind: 'tax'; rate?: TaxRate }
  | { kind: 'deleteTax'; rate: TaxRate }
  | null;

/**
 * Settings › Pricing (TUI-123): what invoice runs charge. Prices (price rules), discounts and
 * tax rates. The owner changes all of it; branch staff price their own branches' classes (D-111);
 * the accountant and branch staff read the rest (D-140).
 */
export function PricingPage() {
  const { membership } = useOrg();
  if (!can(membership.role, 'billing:read') || membership.role === 'parent') {
    return <PageError error={new ApiError(403, 'forbidden', 'Forbidden')} />;
  }
  return <Pricing />;
}

function Pricing() {
  const { membership } = useOrg();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Open>(null);
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'prices';
  const owner = membership.role === 'owner';
  const canPrice = can(membership.role, 'billing:write');
  const canTax = can(membership.role, 'org:write');
  const close = () => setOpen(null);

  const action =
    tab === 'prices' && canPrice ? (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'price' })}>
        {t('pricing.price.add')}
      </Button>
    ) : tab === 'discounts' && owner ? (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'discount' })}>
        {t('pricing.discount.add')}
      </Button>
    ) : tab === 'tax' && canTax ? (
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen({ kind: 'tax' })}>
        {t('pricing.tax.add')}
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        overline={t('pricing.overline')}
        title={t('pricing.title')}
        subtitle={t('pricing.subtitle')}
        action={action}
      />
      <div role="tablist" className="mb-4 flex gap-6 border-b border-border">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setParams(name === 'prices' ? {} : { tab: name }, { replace: true })}
            className={cn(
              '-mb-px h-11 border-b-2 px-0.5 text-body',
              tab === name
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(`pricing.tab.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'prices' ? (
        <PricesTab
          canAdd={canPrice}
          onAdd={() => setOpen({ kind: 'price' })}
          onEdit={(rule) => setOpen({ kind: 'price', rule })}
          onDelete={(rule) => setOpen({ kind: 'deletePrice', rule })}
        />
      ) : tab === 'discounts' ? (
        <DiscountsTab
          canChange={owner}
          onAdd={() => setOpen({ kind: 'discount' })}
          onEdit={(rule) => setOpen({ kind: 'discount', rule })}
          onDelete={(rule) => setOpen({ kind: 'deleteDiscount', rule })}
        />
      ) : (
        <TaxTab
          canChange={canTax}
          onAdd={() => setOpen({ kind: 'tax' })}
          onEdit={(rate) => setOpen({ kind: 'tax', rate })}
          onDelete={(rate) => setOpen({ kind: 'deleteTax', rate })}
        />
      )}

      {open?.kind === 'price' ? <PriceRuleDialog rule={open.rule} onClose={close} /> : null}
      {open?.kind === 'discount' ? <DiscountRuleDialog rule={open.rule} onClose={close} /> : null}
      {open?.kind === 'tax' ? <TaxRateDialog rate={open.rate} onClose={close} /> : null}
      {open?.kind === 'deletePrice' ? (
        <DeleteDialog
          title={t('pricing.price.deleteTitle')}
          body={t('pricing.price.deleteBody')}
          path={`/price-rules/${open.rule.id}`}
          done={t('pricing.price.deleted')}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteDiscount' ? (
        <DeleteDialog
          title={t('pricing.discount.deleteTitle', { name: open.rule.name })}
          body={t('pricing.discount.deleteBody')}
          path={`/discount-rules/${open.rule.id}`}
          done={t('pricing.discount.deleted')}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteTax' ? (
        <DeleteDialog
          title={t('pricing.tax.deleteTitle', { name: open.rate.name })}
          body={t('pricing.tax.deleteBody')}
          path={`/tax-rates/${open.rate.id}`}
          done={t('pricing.tax.deleted')}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** Deletes a rule or rate; a refusal (a rate still in use) shows the API's reason. */
function DeleteDialog({
  title,
  body,
  path,
  done,
  onClose,
}: {
  title: string;
  body: string;
  path: string;
  done: string;
  onClose: () => void;
}) {
  const { membership } = useOrg();
  const refresh = useRefreshPricing();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={title}
      body={body}
      action={t('pricing.delete')}
      onConfirm={async () => {
        await api('DELETE', orgApiPath(membership, path));
        toast(done);
        await refresh();
      }}
    />
  );
}

/** A row: what it is, one meta line, the value on the right, and its menu. */
function Row({
  title,
  meta,
  value,
  badge,
  menu,
}: {
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  menu?: { label: string; items: MenuItem[] };
}) {
  return (
    // On phones the value sits under the name, so a long name isn't cut short: a two-column
    // grid with the menu down the right. From `sm` it is one row.
    <li className="grid min-h-[60px] grid-cols-[1fr_auto] items-center gap-x-3 py-2 pr-2 pl-4 text-body text-text sm:flex">
      <span className="flex min-w-0 flex-col sm:flex-1">
        <b className="truncate font-semibold">{title}</b>
        {meta ? <small className="text-meta text-muted">{meta}</small> : null}
      </span>
      {badge ? <span className="max-sm:col-start-1 max-sm:justify-self-start">{badge}</span> : null}
      {value ? (
        <span className="font-semibold tabular-nums max-sm:col-start-1 sm:shrink-0 sm:text-right">
          {value}
        </span>
      ) : null}
      <span className="max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
        {menu && menu.items.length ? (
          <OverflowMenu label={menu.label} items={menu.items} />
        ) : (
          <span className="block w-2" />
        )}
      </span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="flex h-9 items-center border-b border-border bg-brand-soft/60 px-4 text-meta font-semibold tracking-[0.05em] text-brand uppercase">
        {title}
      </h3>
      <ul className="divide-y divide-border border-b border-border last:border-b-0">{children}</ul>
    </section>
  );
}

// ── Prices ──────────────────────────────────────────────────────────────────

function PricesTab({
  canAdd,
  onAdd,
  onEdit,
  onDelete,
}: {
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (rule: PriceRule) => void;
  onDelete: (rule: PriceRule) => void;
}) {
  const { membership } = useOrg();
  const format = useFormat();
  const rules = usePriceRules();
  const rates = useTaxRates();
  const courseLabel = useCourseLabel();
  const coursesPath = useCoursesPath();
  const classes = useAllClasses(can(membership.role, 'classes:read'));
  const className = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const owner = membership.role === 'owner';

  if (rules.isError) return <PageError error={rules.error} onRetry={() => void rules.refetch()} />;
  const list = rules.data ?? [];
  const rateName = (id: string | null) => {
    const rate = id ? rates.data?.find((r) => r.id === id) : rates.data?.find((r) => r.isDefault);
    return rate
      ? t(id ? 'pricing.price.taxNamed' : 'pricing.price.taxDefaultNamed', {
          rate: `${rate.name} ${percentLabel(rate.rateBps)}`,
        })
      : t('pricing.price.noTax');
  };
  const priceText = (rule: PriceRule) =>
    rule.basis === 'pack'
      ? t('pricing.price.forPack', { price: format.money(rule.price), n: rule.packLessons ?? 0 })
      : t(`pricing.price.per.${rule.basis}`, { price: format.money(rule.price) });
  const row = (rule: PriceRule, title: string) => {
    // Branch staff change their classes' prices; org-wide and course prices are the owner's.
    const mine = owner || (canAdd && rule.classId !== null);
    return (
      <Row
        key={rule.id}
        title={title}
        meta={[
          basisLabel(rule.basis),
          rule.freeTrialLessons
            ? rule.freeTrialLessons === 1
              ? t('pricing.price.trialOne')
              : t('pricing.price.trialCount', { n: rule.freeTrialLessons })
            : null,
          rateName(rule.taxRateId),
        ]
          .filter(Boolean)
          .join(' · ')}
        value={priceText(rule)}
        menu={{
          label: t('pricing.price.actions', { name: title }),
          items: mine
            ? [
                { label: t('pricing.edit'), onSelect: () => onEdit(rule) },
                { label: t('pricing.delete'), onSelect: () => onDelete(rule), danger: true },
              ]
            : [],
        }}
      />
    );
  };
  const orgRules = list.filter((r) => !r.courseId && !r.classId);
  const courseRules = list
    .filter((r) => r.courseId)
    .sort((a, b) => courseLabel(a.courseId!).localeCompare(courseLabel(b.courseId!)));
  const classRules = list
    .filter((r) => r.classId)
    .sort((a, b) =>
      (className.get(a.classId!) ?? '').localeCompare(className.get(b.classId!) ?? ''),
    );

  return (
    <>
      <p className="mb-3 text-body text-muted">
        {t('pricing.price.intro')}{' '}
        <Link to={coursesPath()} className="font-semibold text-brand hover:underline">
          {t('pricing.price.coursePrices')}
        </Link>
      </p>
      <Card flush className="overflow-hidden">
        {rules.isPending ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={Tag}
            title={t('pricing.price.empty')}
            body={t('pricing.price.emptyBody')}
            action={
              canAdd ? (
                <Button icon={<Plus className="size-4" />} onClick={onAdd}>
                  {t('pricing.price.add')}
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {orgRules.length ? (
              <Section title={t('pricing.target.org')}>
                {orgRules.map((r) => row(r, t('pricing.price.everyClass')))}
              </Section>
            ) : null}
            {courseRules.length ? (
              <Section title={t('pricing.group.courses')}>
                {courseRules.map((r) => row(r, courseLabel(r.courseId!)))}
              </Section>
            ) : null}
            {classRules.length ? (
              <Section title={t('pricing.group.classes')}>
                {classRules.map((r) =>
                  row(r, className.get(r.classId!) ?? t('pricing.price.aClass')),
                )}
              </Section>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

// ── Discounts ───────────────────────────────────────────────────────────────

function DiscountsTab({
  canChange,
  onAdd,
  onEdit,
  onDelete,
}: {
  canChange: boolean;
  onAdd: () => void;
  onEdit: (rule: DiscountRule) => void;
  onDelete: (rule: DiscountRule) => void;
}) {
  const format = useFormat();
  const rules = useDiscountRules();
  if (rules.isError) return <PageError error={rules.error} onRetry={() => void rules.refetch()} />;
  const list = rules.data ?? [];

  const value = (rule: DiscountRule) =>
    rule.percentBps
      ? t('pricing.discount.percentOff', { percent: percentLabel(rule.percentBps) })
      : rule.amount
        ? t('pricing.discount.amountOff', { amount: format.money(rule.amount) })
        : rule.fixedPrice
          ? t('pricing.discount.together', { amount: format.money(rule.fixedPrice) })
          : '';
  const who = (rule: DiscountRule) => {
    switch (rule.kind) {
      case 'sibling':
        return t('pricing.who.sibling', { n: rule.minCount ?? 2 });
      case 'multi_class':
        return t('pricing.who.multi_class', { n: rule.minCount ?? 2 });
      case 'early_bird':
        return rule.cutoffDate
          ? t('pricing.who.early_bird', { date: format.date(rule.cutoffDate) })
          : '';
      case 'scholarship':
        return t('pricing.who.scholarship', { n: rule.studentIds?.length ?? 0 });
      case 'manual':
        return t('pricing.who.manual', { n: rule.familyIds?.length ?? 0 });
      case 'bundle':
        return t('pricing.who.bundle', { n: rule.courseIds?.length ?? 0 });
    }
  };
  const when = (rule: DiscountRule) =>
    rule.startsOn && rule.endsOn
      ? t('pricing.when.between', {
          start: format.date(rule.startsOn),
          end: format.date(rule.endsOn),
        })
      : rule.startsOn
        ? t('pricing.when.from', { date: format.date(rule.startsOn) })
        : rule.endsOn
          ? t('pricing.when.until', { date: format.date(rule.endsOn) })
          : null;

  return (
    <>
      <p className="mb-3 text-body text-muted">{t('pricing.discount.intro')}</p>
      <Card flush className="overflow-hidden">
        {rules.isPending ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={BadgePercent}
            title={t('pricing.discount.empty')}
            body={t('pricing.discount.emptyBody')}
            action={
              canChange ? (
                <Button icon={<Plus className="size-4" />} onClick={onAdd}>
                  {t('pricing.discount.add')}
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((rule) => (
              <Row
                key={rule.id}
                title={rule.name}
                meta={[t(`pricing.kind.${rule.kind}`), who(rule), when(rule)]
                  .filter(Boolean)
                  .join(' · ')}
                badge={
                  rule.active ? null : (
                    <Badge tone="neutral">{t('pricing.discount.inactive')}</Badge>
                  )
                }
                value={value(rule)}
                menu={{
                  label: t('pricing.discount.actions', { name: rule.name }),
                  items: canChange
                    ? [
                        { label: t('pricing.edit'), onSelect: () => onEdit(rule) },
                        {
                          label: t('pricing.delete'),
                          onSelect: () => onDelete(rule),
                          danger: true,
                        },
                      ]
                    : [],
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ── Tax rates ───────────────────────────────────────────────────────────────

function TaxTab({
  canChange,
  onAdd,
  onEdit,
  onDelete,
}: {
  canChange: boolean;
  onAdd: () => void;
  onEdit: (rate: TaxRate) => void;
  onDelete: (rate: TaxRate) => void;
}) {
  const rates = useTaxRates();
  if (rates.isError) return <PageError error={rates.error} onRetry={() => void rates.refetch()} />;
  const list = rates.data ?? [];
  return (
    <>
      <p className="mb-3 text-body text-muted">{t('pricing.tax.intro')}</p>
      <Card flush className="overflow-hidden">
        {rates.isPending ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={Receipt}
            title={t('pricing.tax.empty')}
            body={t('pricing.tax.emptyBody')}
            action={
              canChange ? (
                <Button icon={<Plus className="size-4" />} onClick={onAdd}>
                  {t('pricing.tax.add')}
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((rate) => (
              <Row
                key={rate.id}
                title={rate.name}
                meta={rate.inclusive ? t('pricing.tax.included') : t('pricing.tax.onTop')}
                badge={
                  rate.isDefault ? <Badge tone="brand">{t('pricing.tax.isDefault')}</Badge> : null
                }
                value={percentLabel(rate.rateBps)}
                menu={{
                  label: t('pricing.tax.actions', { name: rate.name }),
                  items: canChange
                    ? [
                        { label: t('pricing.edit'), onSelect: () => onEdit(rate) },
                        {
                          label: t('pricing.delete'),
                          onSelect: () => onDelete(rate),
                          danger: true,
                        },
                      ]
                    : [],
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
