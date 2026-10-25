// Shared `@cadence/screen-ui` stub for the bun tests.
//
// `mock.module` is process-wide, so every test file that registers this
// module must expose the same union: `ApiError` for the bridge/domain tests
// and the controls a DOM test renders. Registering it from one helper keeps
// two files from replacing each other's partial stub when `bun test` runs
// them in one process.

import { createElement } from "react";

export class ApiError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    this.code = extra?.code;
  }
}

export function sdkMock() {
  const Button = ({ children, loading, size, variant, ...rest }) => createElement("button", rest, children);
  const Field = ({ label, hint, children }) => {
    const id = `field-${String(label).replace(/[^A-Za-z0-9]+/g, "-")}`;
    return createElement("div", null, createElement("label", { htmlFor: id }, label), hint ?? null, children({ id }));
  };
  const Select = ({ id, value, onChange, options = [], disabled }) => createElement(
    "select",
    { id, value, disabled, onChange: (event) => onChange(event.target.value) },
    options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
  );
  const LocaleTextProvider = ({ children }) => children;
  return { ApiError, Button, Field, Select, LocaleTextProvider };
}
