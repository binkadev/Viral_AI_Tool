# Viral AI Tool — Product Guardrails

These rules are mandatory for every production-facing feature.

## 1. Define the state machine first

Every long-running operation must have explicit states before implementation.

Minimum lifecycle:

```text
idle -> validating -> queued -> processing -> completed
                              -> cancelling -> cancelled
                              -> failed
```

A cancelled operation is not a failed operation.

## 2. Validate before starting

Before creating a processing job, validate all requirements that can be checked up front:

- source still exists;
- source type is supported;
- required settings are present;
- destination is writable;
- sufficient local resources are available when relevant;
- no conflicting duplicate operation is already active;
- operation cannot silently overwrite existing user data.

Validation must exist at both UI and native/service boundaries when bypassing the UI could create an unsafe state.

## 3. No silent destructive actions

Actions that affect a user's real files must be visibly different from actions that only affect Viral AI Tool records.

Examples:

- `Xóa khỏi thư viện` only removes the app record.
- `Chuyển vào Thùng rác` affects the file and requires confirmation.
- Never permanently delete a user file when a recoverable OS trash/recycle action is available.

## 4. Recovery before deletion

When a source is missing:

- keep the library/history record;
- retain the last known thumbnail and metadata;
- mark it as unavailable;
- offer relink/recovery;
- let the user remove the record if they no longer need it.

Do not silently remove missing items.

## 5. Cancellation must be safe

Every long-running local operation must support cancellation when technically possible.

Cancellation requirements:

- keep original source files untouched;
- clean partial generated outputs;
- transition to `cancelled`, not `failed`;
- ignore late progress events after cancellation begins;
- never leave a hidden active reservation/lock.

## 6. Prevent duplicate conflicting work

The UI should prevent accidental duplicate actions, but the service/native layer must enforce the same rule.

Do not rely on disabled buttons alone.

## 7. Commercial error messaging

Customer-facing messages must never expose internal engine/library names, stack traces, shell commands, raw provider errors, or implementation details.

Message structure:

1. What happened.
2. What is affected.
3. What the user can do next.

Raw technical information belongs in internal diagnostics only.

## 8. Preserve original user data

Default processing must be non-destructive:

- input media is read-only;
- generated output uses a new unique path;
- existing output is not overwritten silently;
- incomplete generated files are cleaned after failure/cancellation.

## 9. Resource checks

Before expensive operations, check relevant resources when possible:

- disk space;
- writable output path;
- source availability;
- provider/network availability for cloud features;
- plan/quota where applicable.

If a check cannot be performed reliably, fail safely or clearly warn rather than assuming success.

## 10. App shutdown

If the app is closing while important work is active:

- warn the user;
- explain the consequence;
- default to keeping the app open;
- only stop work after explicit confirmation.

## 11. UI controls

For multiple choices, use explicit selectors with visible current values and option lists.

For destructive actions:

- use clear verbs;
- use confirmation;
- use danger styling;
- never hide the difference between app-only deletion and real-file deletion.

## 12. Localization

Every commercial message must exist in both:

- Vietnamese (`vi`)
- English (`en`)

Vietnamese copy should use familiar Vietnamese product language rather than literal translations.

## 13. Definition of done for a feature

A feature is not complete until all applicable items below are addressed:

- happy path;
- empty state;
- invalid input;
- missing source;
- duplicate request;
- cancellation;
- retry/recovery;
- app close during work;
- safe deletion;
- resource failure;
- friendly VI/EN messages;
- internal error isolation;
- persistence/restart behavior;
- syntax/static checks.
