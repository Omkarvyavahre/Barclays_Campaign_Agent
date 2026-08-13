/**
 * Minimal strict validator.
 *
 * Deliberately dependency-free: model output is untrusted input, and the
 * validation rules for it are small enough that adding a runtime dependency to
 * the server would widen the supply chain for no benefit.
 *
 * Strictness rules that matter here:
 *  - unknown object keys are rejected, not stripped
 *  - missing required keys are rejected
 *  - wrong primitive types are rejected
 *  - strings have explicit length bounds so a runaway model cannot push
 *    unbounded text into the frozen V19 renderers
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

export interface Validator<T> {
  validate(input: unknown, path: string): ValidationResult<T>;
}

export type Infer<V> = V extends Validator<infer T> ? T : never;

function fail(path: string, message: string): { ok: false; issues: string[] } {
  return { ok: false, issues: [`${path || 'value'}: ${message}`] };
}

export interface StringOptions {
  min?: number;
  max?: number;
}

export function string(options: StringOptions = {}): Validator<string> {
  const { min = 1, max = 4000 } = options;
  return {
    validate(input, path) {
      if (typeof input !== 'string') return fail(path, `expected string, received ${typeof input}`);
      const trimmed = input.trim();
      if (trimmed.length < min) return fail(path, `expected at least ${min} characters`);
      if (trimmed.length > max) return fail(path, `expected at most ${max} characters`);
      return { ok: true, value: trimmed };
    },
  };
}

export function boolean(): Validator<boolean> {
  return {
    validate(input, path) {
      if (typeof input !== 'boolean') return fail(path, `expected boolean, received ${typeof input}`);
      return { ok: true, value: input };
    },
  };
}

export function number(options: { min?: number; max?: number } = {}): Validator<number> {
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = options;
  return {
    validate(input, path) {
      if (typeof input !== 'number' || !Number.isFinite(input)) {
        return fail(path, `expected finite number, received ${typeof input}`);
      }
      if (input < min) return fail(path, `expected >= ${min}`);
      if (input > max) return fail(path, `expected <= ${max}`);
      return { ok: true, value: input };
    },
  };
}

export function literalUnion<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return {
    validate(input, path) {
      if (typeof input !== 'string') return fail(path, `expected string, received ${typeof input}`);
      if (!values.includes(input)) return fail(path, `expected one of ${values.join(' | ')}`);
      return { ok: true, value: input as T[number] };
    },
  };
}

export function array<T>(item: Validator<T>, options: { min?: number; max?: number } = {}): Validator<T[]> {
  const { min = 1, max = 50 } = options;
  return {
    validate(input, path) {
      if (!Array.isArray(input)) return fail(path, 'expected array');
      if (input.length < min) return fail(path, `expected at least ${min} item(s)`);
      if (input.length > max) return fail(path, `expected at most ${max} item(s)`);
      const value: T[] = [];
      const issues: string[] = [];
      input.forEach((entry, index) => {
        const result = item.validate(entry, `${path}[${index}]`);
        if (result.ok) value.push(result.value);
        else issues.push(...result.issues);
      });
      return issues.length ? { ok: false, issues } : { ok: true, value };
    },
  };
}

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return {
    validate(input, path) {
      if (input === undefined || input === null) return { ok: true, value: undefined };
      return inner.validate(input, path);
    },
  };
}

// `any` is required here so that Infer<> can recover each field's concrete
// type; `unknown` would collapse every inferred property to `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValidator = Validator<any>;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

// A validator produced by `optional()` widens to `T | undefined`, which must
// surface as an optional property rather than a required one that may be
// undefined, otherwise every caller has to pass the key explicitly.
type OptionalKeys<S> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type RequiredKeys<S> = Exclude<keyof S, OptionalKeys<S>>;

type ShapeOf<S> = Prettify<
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }
>;

/** Object validator that rejects unknown keys. */
export function strictObject<S extends Record<string, AnyValidator>>(shape: S): Validator<ShapeOf<S>> {
  return {
    validate(input, path) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return fail(path, 'expected object');
      }
      const source = input as Record<string, unknown>;
      const issues: string[] = [];
      const value: Record<string, unknown> = {};

      for (const key of Object.keys(shape)) {
        const result = shape[key].validate(source[key], path ? `${path}.${key}` : key);
        if (result.ok) {
          if (result.value !== undefined) value[key] = result.value;
        } else {
          issues.push(...result.issues);
        }
      }

      for (const key of Object.keys(source)) {
        if (!(key in shape)) issues.push(`${path ? `${path}.${key}` : key}: unexpected property`);
      }

      return issues.length ? { ok: false, issues } : { ok: true, value: value as ShapeOf<S> };
    },
  };
}

/** Object with a fixed required key set, all values validated identically. */
export function strictRecord<K extends string, T>(keys: readonly K[], item: Validator<T>): Validator<Record<K, T>> {
  return {
    validate(input, path) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return fail(path, 'expected object');
      }
      const source = input as Record<string, unknown>;
      const issues: string[] = [];
      const value = {} as Record<K, T>;

      for (const key of keys) {
        const result = item.validate(source[key], path ? `${path}.${key}` : key);
        if (result.ok) value[key] = result.value;
        else issues.push(...result.issues);
      }

      for (const key of Object.keys(source)) {
        if (!keys.includes(key as K)) issues.push(`${path ? `${path}.${key}` : key}: unexpected property`);
      }

      return issues.length ? { ok: false, issues } : { ok: true, value };
    },
  };
}

export function parse<T>(validator: Validator<T>, input: unknown): ValidationResult<T> {
  return validator.validate(input, '');
}
