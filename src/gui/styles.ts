/** Styles shared by the manager page and its dialogs, injected once through the `Style` registry. */
export const styles = `
.oem-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.oem-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  line-height: 1.4;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid currentColor;
  opacity: 0.6;
  white-space: nowrap;
}

.oem-badge-local,
.oem-badge-remote {
  opacity: 0.75;
}

.oem-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  opacity: 0.75;
  white-space: nowrap;
}

.oem-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}

.oem-status-connected { color: #3fb950; }
.oem-status-pending { color: #d29922; }
.oem-status-needs_auth { color: #d29922; }
.oem-status-failed { color: #e5484d; }
.oem-status-disabled,
.oem-status-unknown { opacity: 0.55; }

.oem-doctor-error { color: #e5484d; opacity: 0.9; }
.oem-doctor-warning { color: #d29922; opacity: 0.9; }
.oem-doctor-info { opacity: 0.6; }

.oem-description {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.oem-command {
  display: block;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.8;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.oem-path,
.oem-id {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  opacity: 0.65;
  overflow-wrap: anywhere;
}

.oem-id {
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.oem-hint {
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.6;
}

.oem-muted { opacity: 0.6; }

.oem-nowrap { white-space: nowrap; }

.oem-error {
  font-size: 12px;
  line-height: 1.5;
  color: #e5484d;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.oem-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.oem-actions-wide {
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

.oem-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
  max-width: 100%;
  min-width: 0;
}

.oem-input { flex: 1; min-width: 220px; }

.oem-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.oem-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.oem-form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.oem-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.oem-grow { flex: 1; }

.oem-field-label {
  font-size: 12px;
  font-weight: 500;
}

.oem-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  background: transparent;
  color: inherit;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 1.5;
}

.oem-textarea:focus {
  outline: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  outline-offset: 0;
}

.oem-textarea-small { min-height: 68px; }
.oem-textarea-tall { min-height: 320px; }
`
