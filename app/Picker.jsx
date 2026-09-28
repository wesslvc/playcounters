'use client';

import { useEffect, useState } from 'react';

/**
 * A dropdown built from the same pill vocabulary as the rest of the controls.
 * A native <select> can't be styled to match across platforms, and this list
 * also has to carry a play count beside each option.
 */
export default function Picker({ value, label, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return (
    <>
      {open && (
        <button className="scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
      )}
      <div className="pick" data-open={open}>
        <button
          className="pill"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
        {open && (
          <div className="menu" role="listbox">
            {options.map((o) => (
              <button
                key={String(o.value)}
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.count != null && <em>{Number(o.count).toLocaleString()}</em>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
