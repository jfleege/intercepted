import { useId, useState } from 'react';
export default function MarketTarget({name, line, onChange, onValidityChange}: {name: string; line: number | null; onChange: (value: string) => void; onValidityChange: (valid: boolean) => void}) {
  const [draft, setDraft] = useState<{line: number | null; value: string} | null>(null);
  const id = useId();
  const value = draft?.line === line ? draft.value : (line === null ? '' : String(line));
  const invalid = value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0;
  return <><input aria-label={`${name} target`} aria-invalid={invalid} aria-describedby={invalid ? id : undefined} type="number" min="0" step="any" value={value}
    onChange={event => {const text = event.target.value;const valid = text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= 0;setDraft({line:valid?Number(text):line,value:text});onValidityChange(valid);if(valid) onChange(text);}}/>
    {invalid && <span className="mb-input-error" id={id}>Enter a target of zero or greater. The previous valid selection is retained.</span>}</>;
}
