import type {
  Class,
  DiscountKind,
  DiscountRule,
  Family,
  PriceBasis,
  PriceRule,
  Student,
  TaxRate,
} from '@edustrux/shared';
import { DISCOUNT_KINDS, PRICE_BASES } from '@edustrux/shared';
import { fromMinorUnits, toMinorUnits } from '@edustrux/shared/money';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Field, SelectField, TextField } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { api, fieldErrors } from '../../lib/api';
import { useCourseLabel, useCourses, useTerms } from '../../lib/classes';
import { cn } from '../../lib/cn';
import { orgApiPath, useOrg } from '../../lib/org';
import type { Page } from '../../lib/people';
import {
  basisLabel,
  parsePercent,
  percentLabel,
  useRefreshPricing,
  useTaxRates,
} from '../../lib/pricing';
import { FormActions, StaleOrError } from '../people/dialogs';
import { Toggle } from '../people/Toggle';

/** Every row of a list the dialogs choose from. */
function useAll<T>(name: string, path: string, enabled = true) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: [name, membership.org.id, { all: true }],
    queryFn: async ({ signal }) => {
      const all: T[] = [];
      let cursor: string | undefined;
      do {
        const page = await api<Page<T>>(
          'GET',
          orgApiPath(membership, `${path}?limit=200${cursor ? `&cursor=${cursor}` : ''}`),
          { signal },
        );
        all.push(...page.data);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
    enabled,
    staleTime: 60_000,
  });
}

export const useAllClasses = (enabled = true) => useAll<Class>('classes', '/classes', enabled);
export const useAllStudents = (enabled = true) => useAll<Student>('students', '/students', enabled);
export const useAllFamilies = (enabled = true) => useAll<Family>('families', '/families', enabled);

/** A money input with the currency in front, as the course price is typed. */
function MoneyField({
  label,
  currency,
  value,
  onChange,
  error,
  helper,
  required,
}: {
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: ReactNode;
  required?: boolean;
}) {
  return (
    <Field label={label} error={error} helper={helper} required={required}>
      {({ className, ...props }) => (
        <div className="flex">
          <span className="flex items-center rounded-l-lg border border-r-0 border-border-strong bg-canvas px-3 text-label font-semibold text-muted">
            {currency}
          </span>
          <input
            {...props}
            inputMode="decimal"
            value={value}
            placeholder="0.00"
            onChange={(e) => onChange(e.target.value)}
            className={cn(className, 'rounded-l-none tabular-nums')}
          />
        </div>
      )}
    </Field>
  );
}

/** Minor units from a typed amount; null when it isn't one. */
function minor(text: string, currency: string): number | null {
  try {
    return toMinorUnits(text.trim().replace(/,/g, ''), currency);
  } catch {
    return null;
  }
}

/** A searchable list of checkboxes, for the students, families or courses a discount names. */
export function PickList({
  label,
  options,
  selected,
  onChange,
  error,
  helper,
}: {
  label: string;
  options: { id: string; label: string; meta?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  helper?: string;
}) {
  const [typed, setTyped] = useState('');
  const q = typed.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => `${o.label} ${o.meta ?? ''}`.toLowerCase().includes(q))
    : options;
  const chosen = new Set(selected);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label font-medium text-text">
        {label}{' '}
        <span className="font-normal text-muted">
          {t('pricing.pick.chosen', { n: selected.length })}
        </span>
      </legend>
      <div
        className={cn(
          'overflow-hidden rounded-lg border',
          error ? 'border-danger' : 'border-border-strong',
        )}
      >
        <label className="flex h-10 items-center gap-2 border-b border-border px-3 text-subtle">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('pricing.pick.search')}
            aria-label={t('pricing.pick.searchIn', { label })}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-subtle"
          />
        </label>
        <ul className="max-h-48 divide-y divide-border overflow-y-auto">
          {shown.length === 0 ? (
            <li className="px-3 py-2.5 text-body text-muted">{t('pricing.pick.none')}</li>
          ) : (
            shown.map((option) => (
              <li key={option.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-canvas md:min-h-10">
                  <input
                    type="checkbox"
                    checked={chosen.has(option.id)}
                    onChange={() =>
                      onChange(
                        chosen.has(option.id)
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id],
                      )
                    }
                    className="size-4 accent-brand"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-text">{option.label}</span>
                    {option.meta ? (
                      <small className="truncate text-meta text-muted">{option.meta}</small>
                    ) : null}
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
      </div>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {helper ? <p className="text-meta text-muted">{helper}</p> : null}
    </fieldset>
  );
}

// ── Tax rates ───────────────────────────────────────────────────────────────

/** Add or change a tax rate (owner only). */
export function TaxRateDialog({ rate, onClose }: { rate?: TaxRate; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={rate ? t('pricing.tax.edit') : t('pricing.tax.add')}
      subtitle={t('pricing.tax.subtitle')}
    >
      <TaxRateForm rate={rate} onClose={onClose} />
    </Dialog>
  );
}

function TaxRateForm({ rate, onClose }: { rate?: TaxRate; onClose: () => void }) {
  const { membership } = useOrg();
  const refresh = useRefreshPricing();
  const toast = useToast();
  const rates = useTaxRates();
  const [name, setName] = useState(rate?.name ?? '');
  const [percent, setPercent] = useState(rate ? String(rate.rateBps / 100) : '');
  const [inclusive, setInclusive] = useState(rate?.inclusive ?? true);
  // The first rate an org adds is its default unless they say otherwise.
  const [isDefault, setIsDefault] = useState(rate?.isDefault ?? (rates.data?.length ?? 0) === 0);
  const [local, setLocal] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (rateBps: number) =>
      rate
        ? api<TaxRate>('PATCH', orgApiPath(membership, `/tax-rates/${rate.id}`), {
            body: { updatedAt: rate.updatedAt, name: name.trim(), rateBps, inclusive, isDefault },
          })
        : api<TaxRate>('POST', orgApiPath(membership, '/tax-rates'), {
            body: { name: name.trim(), rateBps, inclusive, isDefault },
          }),
    onSuccess: async () => {
      onClose();
      toast(rate ? t('pricing.tax.saved') : t('pricing.tax.added'));
      await refresh();
    },
  });
  const errors = { ...fieldErrors(save.error), ...local };

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('billing.error.required');
    const bps = parsePercent(percent);
    if (bps === null) next.rateBps = t('pricing.error.percent');
    setLocal(next);
    if (Object.keys(next).length === 0) save.mutate(bps!);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label={t('pricing.tax.name')}
        required
        value={name}
        maxLength={120}
        placeholder={t('pricing.tax.namePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <TextField
        label={t('pricing.tax.rate')}
        required
        inputMode="decimal"
        value={percent}
        placeholder="15"
        onChange={(e) => setPercent(e.target.value)}
        helper={t('pricing.tax.rateHelp')}
        error={errors.rateBps}
      />
      <Toggle
        label={t('pricing.tax.inclusive')}
        hint={t('pricing.tax.inclusiveHelp')}
        checked={inclusive}
        onChange={setInclusive}
      />
      <Toggle
        label={t('pricing.tax.default')}
        hint={t('pricing.tax.defaultHelp')}
        checked={isDefault}
        onChange={setIsDefault}
      />
      <StaleOrError error={save.error} onReload={onClose} />
      <FormActions
        onClose={onClose}
        saving={save.isPending}
        label={rate ? t('pricing.save') : t('pricing.tax.add')}
      />
    </form>
  );
}

// ── Price rules ─────────────────────────────────────────────────────────────

type Target = 'org' | 'course' | 'class';

/**
 * Add or change a price rule. A new one chooses what it prices and how it is charged; those
 * are fixed after, so an edit changes only the price, the pack size, the free trial and the
 * tax. Only the owner prices every class or a course (D-111); branch staff price their classes.
 */
export function PriceRuleDialog({ rule, onClose }: { rule?: PriceRule; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={rule ? t('pricing.price.edit') : t('pricing.price.add')}
      subtitle={t('pricing.price.subtitle')}
    >
      <PriceRuleForm rule={rule} onClose={onClose} />
    </Dialog>
  );
}

function PriceRuleForm({ rule, onClose }: { rule?: PriceRule; onClose: () => void }) {
  const { membership, org } = useOrg();
  const refresh = useRefreshPricing();
  const toast = useToast();
  const owner = membership.role === 'owner';
  const courses = useCourses();
  const courseLabel = useCourseLabel();
  const classes = useAllClasses();
  const rates = useTaxRates();
  const currency = rule?.price.currency ?? org?.currency ?? 'NZD';

  const [target, setTarget] = useState<Target>(
    rule ? (rule.classId ? 'class' : rule.courseId ? 'course' : 'org') : owner ? 'course' : 'class',
  );
  const [courseId, setCourseId] = useState(rule?.courseId ?? '');
  const [classId, setClassId] = useState(rule?.classId ?? '');
  const [basis, setBasis] = useState<PriceBasis>(rule?.basis ?? 'per_term');
  const [price, setPrice] = useState(rule ? fromMinorUnits(rule.price.amount, currency) : '');
  const [packLessons, setPackLessons] = useState(
    rule?.packLessons ? String(rule.packLessons) : '10',
  );
  const [trial, setTrial] = useState(String(rule?.freeTrialLessons ?? 0));
  const [taxRateId, setTaxRateId] = useState(rule?.taxRateId ?? '');
  const [local, setLocal] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      rule
        ? api<PriceRule>('PATCH', orgApiPath(membership, `/price-rules/${rule.id}`), {
            body: { updatedAt: rule.updatedAt, ...body },
          })
        : api<PriceRule>('POST', orgApiPath(membership, '/price-rules'), { body }),
    onSuccess: async () => {
      onClose();
      toast(rule ? t('pricing.price.saved') : t('pricing.price.added'));
      await refresh();
    },
  });
  const errors = { ...fieldErrors(save.error), ...local };

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const amount = minor(price, currency);
    if (amount === null || amount < 0) next.price = t('pricing.error.amount');
    if (!rule && target === 'course' && !courseId) next.courseId = t('billing.error.required');
    if (!rule && target === 'class' && !classId) next.classId = t('billing.error.required');
    const pack = Number(packLessons);
    if (basis === 'pack' && !(Number.isInteger(pack) && pack >= 2 && pack <= 200)) {
      next.packLessons = t('pricing.error.pack');
    }
    const free = Number(trial);
    if (!(Number.isInteger(free) && free >= 0 && free <= 20)) {
      next.freeTrialLessons = t('pricing.error.trial');
    }
    setLocal(next);
    if (Object.keys(next).length > 0) return;
    const fields = {
      price: { amount, currency },
      ...(basis === 'pack' ? { packLessons: pack } : {}),
      freeTrialLessons: free,
      taxRateId: taxRateId || null,
    };
    save.mutate(
      rule
        ? fields
        : {
            ...(target === 'course' ? { courseId } : {}),
            ...(target === 'class' ? { classId } : {}),
            basis,
            ...fields,
          },
    );
  }

  const targets: Target[] = owner ? ['org', 'course', 'class'] : ['class'];
  const courseOptions = (courses.data?.data ?? [])
    .map((c) => ({ value: c.id, label: courseLabel(c.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const classOptions = [...(classes.data ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: `${c.name} · ${courseLabel(c.courseId)}` }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {rule ? (
        <p className="rounded-lg bg-canvas px-3 py-2.5 text-body text-muted">
          {t('pricing.price.fixed', { basis: basisLabel(rule.basis) })}
        </p>
      ) : (
        <>
          {targets.length > 1 ? (
            <fieldset>
              <legend className="mb-1.5 text-label font-medium text-text">
                {t('pricing.price.appliesTo')}
              </legend>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-strong p-1">
                {targets.map((value) => (
                  <label
                    key={value}
                    className={cn(
                      'flex h-10 cursor-pointer items-center justify-center rounded-md px-2 text-center text-label has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand sm:h-9',
                      target === value
                        ? 'bg-brand-soft font-semibold text-brand'
                        : 'text-secondary-text hover:bg-canvas',
                    )}
                  >
                    <input
                      type="radio"
                      name="target"
                      checked={target === value}
                      onChange={() => setTarget(value)}
                      className="sr-only"
                    />
                    {t(`pricing.target.${value}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {target === 'course' ? (
            <SelectField
              label={t('pricing.price.course')}
              required
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              error={errors.courseId}
              options={[{ value: '', label: t('pricing.choose') }, ...courseOptions]}
            />
          ) : target === 'class' ? (
            <SelectField
              label={t('pricing.price.class')}
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              error={errors.classId}
              helper={owner ? undefined : t('pricing.price.classHelp')}
              options={[{ value: '', label: t('pricing.choose') }, ...classOptions]}
            />
          ) : (
            <p className="text-meta text-muted">{t('pricing.price.orgHelp')}</p>
          )}
          <SelectField
            label={t('pricing.price.basis')}
            required
            value={basis}
            onChange={(e) => setBasis(e.target.value as PriceBasis)}
            error={errors.basis}
            helper={t(`pricing.basisHelp.${basis}`)}
            options={PRICE_BASES.map((b) => ({ value: b, label: basisLabel(b) }))}
          />
        </>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MoneyField
          label={t('pricing.price.price')}
          required
          currency={currency}
          value={price}
          onChange={setPrice}
          error={errors.price ?? errors['price.amount']}
          helper={t('pricing.price.priceHelp')}
        />
        {basis === 'pack' ? (
          <TextField
            label={t('pricing.price.pack')}
            required
            inputMode="numeric"
            value={packLessons}
            onChange={(e) => setPackLessons(e.target.value)}
            error={errors.packLessons}
            helper={t('pricing.price.packHelp')}
          />
        ) : null}
        <TextField
          label={t('pricing.price.trial')}
          inputMode="numeric"
          value={trial}
          onChange={(e) => setTrial(e.target.value)}
          error={errors.freeTrialLessons}
          helper={t('pricing.price.trialHelp')}
        />
        <SelectField
          label={t('pricing.price.tax')}
          value={taxRateId}
          onChange={(e) => setTaxRateId(e.target.value)}
          error={errors.taxRateId}
          options={[
            { value: '', label: t('pricing.price.taxDefault') },
            ...(rates.data ?? []).map((r) => ({
              value: r.id,
              label: `${r.name} ${percentLabel(r.rateBps)}`,
            })),
          ]}
        />
      </div>
      <StaleOrError error={save.error} onReload={onClose} />
      <FormActions
        onClose={onClose}
        saving={save.isPending}
        label={rule ? t('pricing.save') : t('pricing.price.add')}
      />
    </form>
  );
}

// ── Discount rules ──────────────────────────────────────────────────────────

type Off = 'percent' | 'amount' | 'fixed';

/** Add or change a discount rule (owner only, D-140). The kind is fixed once made. */
export function DiscountRuleDialog({
  rule,
  onClose,
}: {
  rule?: DiscountRule;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={rule ? t('pricing.discount.edit') : t('pricing.discount.add')}
      subtitle={t('pricing.discount.subtitle')}
    >
      <DiscountRuleForm rule={rule} onClose={onClose} />
    </Dialog>
  );
}

function DiscountRuleForm({ rule, onClose }: { rule?: DiscountRule; onClose: () => void }) {
  const { membership, org } = useOrg();
  const refresh = useRefreshPricing();
  const toast = useToast();
  const currency = rule?.amount?.currency ?? rule?.fixedPrice?.currency ?? org?.currency ?? 'NZD';
  const [kind, setKind] = useState<DiscountKind>(rule?.kind ?? 'sibling');
  const [name, setName] = useState(rule?.name ?? '');
  const [off, setOff] = useState<Off>(
    rule?.fixedPrice ? 'fixed' : rule?.amount ? 'amount' : 'percent',
  );
  const [value, setValue] = useState(
    rule?.percentBps
      ? String(rule.percentBps / 100)
      : rule?.amount
        ? fromMinorUnits(rule.amount.amount, currency)
        : rule?.fixedPrice
          ? fromMinorUnits(rule.fixedPrice.amount, currency)
          : '',
  );
  const [minCount, setMinCount] = useState(String(rule?.minCount ?? 2));
  const [cutoffDate, setCutoffDate] = useState(rule?.cutoffDate ?? '');
  const [termId, setTermId] = useState(rule?.termId ?? '');
  const [studentIds, setStudentIds] = useState<string[]>(rule?.studentIds ?? []);
  const [familyIds, setFamilyIds] = useState<string[]>(rule?.familyIds ?? []);
  const [courseIds, setCourseIds] = useState<string[]>(rule?.courseIds ?? []);
  const [startsOn, setStartsOn] = useState(rule?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(rule?.endsOn ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [local, setLocal] = useState<Record<string, string>>({});

  const terms = useTerms();
  const courses = useCourses();
  const courseLabel = useCourseLabel();
  const students = useAllStudents(kind === 'scholarship');
  const families = useAllFamilies(kind === 'manual' || kind === 'scholarship');
  const familyName = new Map((families.data ?? []).map((f) => [f.id, f.name]));
  const offs: Off[] = kind === 'bundle' ? ['percent', 'amount', 'fixed'] : ['percent', 'amount'];

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      rule
        ? api<DiscountRule>('PATCH', orgApiPath(membership, `/discount-rules/${rule.id}`), {
            body: { updatedAt: rule.updatedAt, ...body },
          })
        : api<DiscountRule>('POST', orgApiPath(membership, '/discount-rules'), {
            body: { kind, ...body },
          }),
    onSuccess: async () => {
      onClose();
      toast(rule ? t('pricing.discount.saved') : t('pricing.discount.added'));
      await refresh();
    },
  });
  const errors = { ...fieldErrors(save.error), ...local };

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('billing.error.required');
    let amounts: Record<string, unknown> = {};
    if (off === 'percent') {
      const bps = parsePercent(value);
      if (bps === null || bps < 1) next.value = t('pricing.error.percent');
      else amounts = { percentBps: bps, amount: null, fixedPrice: null };
    } else {
      const amount = minor(value, currency);
      if (amount === null || amount < (off === 'fixed' ? 0 : 1)) {
        next.value = t('pricing.error.amount');
      } else {
        amounts =
          off === 'amount'
            ? { percentBps: null, amount: { amount, currency }, fixedPrice: null }
            : { percentBps: null, amount: null, fixedPrice: { amount, currency } };
      }
    }
    const count = Number(minCount);
    const counts = kind === 'sibling' || kind === 'multi_class';
    if (counts && !(Number.isInteger(count) && count >= 2 && count <= 20)) {
      next.minCount = t('pricing.error.minCount');
    }
    if (kind === 'early_bird' && !cutoffDate) next.cutoffDate = t('billing.error.required');
    if (kind === 'scholarship' && studentIds.length === 0) {
      next.studentIds = t('pricing.error.pickOne');
    }
    if (kind === 'manual' && familyIds.length === 0) next.familyIds = t('pricing.error.pickOne');
    if (kind === 'bundle' && courseIds.length < 2) next.courseIds = t('pricing.error.pickTwo');
    if (startsOn && endsOn && endsOn < startsOn) next.endsOn = t('pricing.error.endsOn');
    setLocal(next);
    if (Object.keys(next).length > 0) return;
    save.mutate({
      name: name.trim(),
      ...amounts,
      ...(counts ? { minCount: count } : {}),
      ...(kind === 'early_bird' ? { cutoffDate, termId: termId || null } : {}),
      ...(kind === 'scholarship' ? { studentIds } : {}),
      ...(kind === 'manual' ? { familyIds } : {}),
      ...(kind === 'bundle' ? { courseIds } : {}),
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      active,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {rule ? null : (
        <SelectField
          label={t('pricing.discount.kind')}
          required
          value={kind}
          onChange={(e) => {
            const next = e.target.value as DiscountKind;
            setKind(next);
            if (next !== 'bundle' && off === 'fixed') setOff('percent');
          }}
          helper={t(`pricing.kindHelp.${kind}`)}
          options={DISCOUNT_KINDS.map((k) => ({ value: k, label: t(`pricing.kind.${k}`) }))}
        />
      )}
      <TextField
        label={t('pricing.discount.name')}
        required
        value={name}
        maxLength={120}
        placeholder={t(`pricing.kind.${kind}`)}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        helper={t('pricing.discount.nameHelp')}
      />
      <fieldset>
        <legend className="mb-1.5 text-label font-medium text-text">
          {t('pricing.discount.off')}
        </legend>
        <div
          className={cn(
            'grid gap-1 rounded-lg border border-border-strong p-1',
            offs.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
          )}
        >
          {offs.map((o) => (
            <label
              key={o}
              className={cn(
                'flex h-10 cursor-pointer items-center justify-center rounded-md px-2 text-center text-label has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand sm:h-9',
                off === o
                  ? 'bg-brand-soft font-semibold text-brand'
                  : 'text-secondary-text hover:bg-canvas',
              )}
            >
              <input
                type="radio"
                name="off"
                checked={off === o}
                onChange={() => setOff(o)}
                className="sr-only"
              />
              {t(`pricing.off.${o}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {off === 'percent' ? (
        <TextField
          label={t('pricing.discount.percent')}
          required
          inputMode="decimal"
          value={value}
          placeholder="10"
          onChange={(e) => setValue(e.target.value)}
          error={errors.value ?? errors.percentBps}
          helper={t('pricing.discount.percentHelp')}
        />
      ) : (
        <MoneyField
          label={off === 'fixed' ? t('pricing.discount.fixed') : t('pricing.discount.amount')}
          required
          currency={currency}
          value={value}
          onChange={setValue}
          error={errors.value ?? errors['amount.amount'] ?? errors['fixedPrice.amount']}
          helper={
            off === 'fixed' ? t('pricing.discount.fixedHelp') : t('pricing.discount.amountHelp')
          }
        />
      )}

      {kind === 'sibling' || kind === 'multi_class' ? (
        <TextField
          label={t(`pricing.discount.minCount.${kind}`)}
          required
          inputMode="numeric"
          value={minCount}
          onChange={(e) => setMinCount(e.target.value)}
          error={errors.minCount}
        />
      ) : null}
      {kind === 'early_bird' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('pricing.discount.cutoff')}
            required
            type="date"
            value={cutoffDate}
            onChange={(e) => setCutoffDate(e.target.value)}
            error={errors.cutoffDate}
            helper={t('pricing.discount.cutoffHelp')}
          />
          <SelectField
            label={t('pricing.discount.term')}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            error={errors.termId}
            options={[
              { value: '', label: t('pricing.discount.anyTerm') },
              ...(terms.data?.data ?? []).map((term) => ({ value: term.id, label: term.name })),
            ]}
          />
        </div>
      ) : null}
      {kind === 'scholarship' ? (
        <PickList
          label={t('pricing.discount.students')}
          selected={studentIds}
          onChange={setStudentIds}
          error={errors.studentIds}
          options={[...(students.data ?? [])]
            .sort(
              (a, b) =>
                a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
            )
            .map((s) => ({
              id: s.id,
              label: `${s.firstName} ${s.lastName}`,
              meta: familyName.get(s.familyId)
                ? t('people.familyName', { name: familyName.get(s.familyId)! })
                : undefined,
            }))}
        />
      ) : null}
      {kind === 'manual' ? (
        <PickList
          label={t('pricing.discount.families')}
          selected={familyIds}
          onChange={setFamilyIds}
          error={errors.familyIds}
          options={[...(families.data ?? [])]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) => ({ id: f.id, label: t('people.familyName', { name: f.name }) }))}
        />
      ) : null}
      {kind === 'bundle' ? (
        <PickList
          label={t('pricing.discount.courses')}
          selected={courseIds}
          onChange={setCourseIds}
          error={errors.courseIds}
          helper={t('pricing.discount.coursesHelp')}
          options={(courses.data?.data ?? [])
            .map((c) => ({ id: c.id, label: courseLabel(c.id) }))
            .sort((a, b) => a.label.localeCompare(b.label))}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('pricing.discount.startsOn')}
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          error={errors.startsOn}
          helper={t('pricing.discount.datesHelp')}
        />
        <TextField
          label={t('pricing.discount.endsOn')}
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          error={errors.endsOn}
        />
      </div>
      <Toggle
        label={t('pricing.discount.active')}
        hint={t('pricing.discount.activeHelp')}
        checked={active}
        onChange={setActive}
      />
      {errors._ ? <p className="text-meta text-danger">{errors._}</p> : null}
      <StaleOrError error={save.error} onReload={onClose} />
      <FormActions
        onClose={onClose}
        saving={save.isPending}
        label={rule ? t('pricing.save') : t('pricing.discount.add')}
      />
    </form>
  );
}
