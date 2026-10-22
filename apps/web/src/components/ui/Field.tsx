import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';

const control =
  'block h-11 sm:h-10 w-full rounded-lg border bg-surface px-3 text-body text-text placeholder:text-subtle transition-colors duration-150 focus:outline-2 focus:outline-offset-0 focus:outline-brand disabled:bg-canvas disabled:text-subtle';

type FieldProps = {
  label: string;
  required?: boolean;
  helper?: ReactNode;
  error?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    className: string;
  }) => ReactNode;
};

/**
 * ui-design.md §6 Forms: label above, helper below, "(required)" in the label, and the API's
 * error for the field in danger under it.
 */
export function Field({ label, required, helper, error, children }: FieldProps) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium text-text">
        {label}
        {required ? <span className="font-normal text-muted"> {t('form.required')}</span> : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        className: cn(control, error ? 'border-danger' : 'border-border-strong'),
      })}
      {error ? (
        <p id={errorId} className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="text-meta text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

type InputFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> &
  Omit<FieldProps, 'children'>;

export function TextField({ label, required, helper, error, ...input }: InputFieldProps) {
  return (
    <Field label={label} required={required} helper={helper} error={error}>
      {(props) => <input required={required} {...input} {...props} />}
    </Field>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> &
  Omit<FieldProps, 'children'> & { options: { value: string; label: string }[] };

export function SelectField({
  label,
  required,
  helper,
  error,
  options,
  ...select
}: SelectFieldProps) {
  return (
    <Field label={label} required={required} helper={helper} error={error}>
      {(props) => (
        <select required={required} {...select} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
