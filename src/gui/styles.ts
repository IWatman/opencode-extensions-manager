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

.oem-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 0 0 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.oem-toolbar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.oem-toolbar-label {
  font-size: 11px;
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.oem-toolbar-grow {
  flex: 1;
  min-width: 240px;
}

.oem-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.oem-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-wrap: wrap;
  overflow-x: visible;
  margin: 0 0 16px;
  padding: 4px 0 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.oem-tab-hint {
  display: block;
  margin: -10px 0 14px;
  font-size: 10px;
  opacity: 0.5;
}

.oem-tab {
  appearance: none;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  opacity: 0.6;
  padding: 7px 10px;
  border-radius: 6px 6px 0 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.oem-tab:hover {
  background: color-mix(in srgb, currentColor 6%, transparent);
  opacity: 0.9;
}

.oem-tab:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 35%, transparent);
  outline-offset: -2px;
}

.oem-tab-active {
  opacity: 1;
  border-bottom-color: currentColor;
  font-weight: 500;
}

.oem-tab-count {
  font-size: 10px;
  line-height: 1.4;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  opacity: 0.85;
}

.oem-tab-warning {
  background: #e5484d;
  color: #fff;
  opacity: 1;
}

.oem-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 0 0 18px;
}

.oem-stat {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.oem-stat:hover {
  background: color-mix(in srgb, currentColor 5%, transparent);
  border-color: color-mix(in srgb, currentColor 25%, transparent);
}

.oem-stat:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 35%, transparent);
  outline-offset: 1px;
}

.oem-stat-value {
  font-size: 24px;
  line-height: 1.1;
  font-weight: 600;
}

.oem-stat-label {
  font-size: 12px;
  opacity: 0.7;
}

.oem-stat-hint {
  font-size: 11px;
  opacity: 0.55;
}

.oem-stat-warning .oem-stat-value {
  color: #d29922;
}

/* Global search */
.oem-toolbar-search {
  flex: 1 1 240px;
  min-width: 200px;
}

.oem-search-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}

.oem-search-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.oem-search-count {
  font-size: 12px;
  font-weight: 500;
}

.oem-search-panel-head .ui-select,
.oem-search-panel-head select {
  margin-left: auto;
}

.oem-search-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.oem-search-group-title {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-top: 4px;
}

.oem-search-item {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  min-width: 0;
  text-align: left;
  padding: 5px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.oem-search-item:hover {
  background: color-mix(in srgb, currentColor 7%, transparent);
}

.oem-search-item:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 35%, transparent);
  outline-offset: -2px;
}

.oem-search-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.oem-search-item-title > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oem-search-item-subtitle {
  font-size: 11px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oem-search-empty {
  font-size: 12px;
  opacity: 0.6;
  padding: 4px 0;
}

.oem-search-more {
  padding: 1px 7px 3px;
}

/* Selection, sorting and bulk actions */
.oem-list-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}

.oem-check-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.oem-check {
  width: 14px;
  height: 14px;
  margin: 0;
  flex: none;
  cursor: pointer;
}

.oem-sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.oem-bulkbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
}

.oem-bulk-count {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.oem-bulk-progress,
.oem-bulk-result {
  overflow-wrap: anywhere;
}

/* Loading skeletons */
.oem-skeleton-list {
  display: flex;
  flex-direction: column;
}

.oem-skeleton-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 13px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
}

.oem-skeleton-row:last-child {
  border-bottom: 0;
}

.oem-skeleton {
  display: block;
  height: 9px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, currentColor 7%, transparent) 25%,
    color-mix(in srgb, currentColor 14%, transparent) 37%,
    color-mix(in srgb, currentColor 7%, transparent) 63%
  );
  background-size: 400% 100%;
  animation: oem-shimmer 1.4s ease infinite;
}

.oem-skeleton-title {
  width: 32%;
  height: 11px;
}

.oem-skeleton-line {
  width: 64%;
}

@keyframes oem-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .oem-skeleton {
    animation: none;
  }
}

/* Update progress */
.oem-progress {
  display: block;
  width: 100%;
  max-width: 360px;
  height: 4px;
  margin-top: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  overflow: hidden;
}

.oem-progress-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 55%, transparent);
  transition: width 0.2s ease;
}

/* Temporary highlight when a search result is revealed */
.oem-focus {
  outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
  outline-offset: -2px;
  border-radius: 6px;
}
`
